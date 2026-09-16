import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateData } from '../validators/schema-validator.js';
import { InvariantsGuard } from '../validators/invariants-guard.js';

/**
 * 计算文件的 SHA-256 哈希
 * @param {string} filePath
 * @returns {string} 64位十六进制哈希
 */
export function calculateFileHash(filePath) {
  // 严格只读方式打开并读取
  InvariantsGuard.assertSourceReadOnly(false, filePath);
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * 递归扫描目录，生成只读文件清单与根哈希
 * @param {string} dirPath
 * @returns {{ files: Array<{ relativePath: string, sha256: string, size: number }>, manifestHash: string }}
 */
export function generateDirectoryManifest(dirPath) {
  InvariantsGuard.assertSourceReadOnly(false, dirPath);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`商品素材目录不存在或不是文件夹: ${dirPath}`);
  }

  const files = [];

  function walk(currentDir, baseDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, baseDir);
      } else if (entry.isFile()) {
        // 排除系统临时隐藏文件
        if (entry.name.startsWith('.') || entry.name.endsWith('.tmp')) continue;
        const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const hash = calculateFileHash(fullPath);
        const stat = fs.statSync(fullPath);
        files.push({
          relativePath: rel,
          sha256: hash,
          size: stat.size
        });
      }
    }
  }

  walk(dirPath, dirPath);

  // 排序以确保哈希确定性
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const combined = files.map(f => `${f.relativePath}:${f.sha256}`).join('\n');
  const manifestHash = crypto.createHash('sha256').update(combined).digest('hex');

  return {
    files,
    manifestHash
  };
}

/**
 * 适配并转换原始采集目录为标准的 SourceProduct 实体
 * @param {string} productDirPath 原始采集商品目录绝对或相对路径
 * @param {object} [options] 覆盖选项（如手动补录价格等）
 * @returns {{ sourceProduct: object, manifest: object }}
 */
export function adaptSourceProduct(productDirPath, options = {}) {
  InvariantsGuard.assertSourceReadOnly(false, productDirPath);
  const resolvedDir = path.resolve(productDirPath);
  const manifest = generateDirectoryManifest(resolvedDir);

  let sourceProductId = '';
  let sourceUrl = '';
  let sourceTitle = '';
  let sourceDescription = '';
  let sourceImages = [];
  let sourcePrice = { amount: 0, currency: 'CNY' };
  let capturedAt = new Date().toISOString();

  // 1. 检测标准商品信息.json
  const infoJsonPath = path.join(resolvedDir, '商品信息.json');
  const textTxtPath = path.join(resolvedDir, '文案.txt');
  const legacySourceJsonPath = path.join(resolvedDir, '来源.json');

  if (fs.existsSync(infoJsonPath)) {
    const rawInfo = JSON.parse(fs.readFileSync(infoJsonPath, 'utf-8'));
    sourceProductId = String(rawInfo.id || '').trim();
    sourceUrl = rawInfo.url || (sourceProductId ? `https://www.goofish.com/item?id=${sourceProductId}` : '');
    sourceTitle = (rawInfo.title || '').trim();
    sourceDescription = (rawInfo.description || '').trim();
    capturedAt = rawInfo.capturedAt || capturedAt;

    if (Array.isArray(rawInfo.images)) {
      sourceImages = rawInfo.images.map((img, idx) => ({
        position: img.position || (idx + 1),
        file_name: path.basename(img.file || `0${idx + 1}.webp`),
        sha256: img.sha256 || '0'.repeat(64),
        width: img.width || 800,
        height: img.height || 800,
        original_url: img.url || ''
      }));
    }
  } else if (fs.existsSync(legacySourceJsonPath)) {
    // 兼容来源.json平铺格式
    const dirBase = path.basename(resolvedDir);
    const m = dirBase.match(/^([0-9a-zA-Z_-]+)-(.*)$/);
    if (m) {
      sourceProductId = m[1];
      sourceTitle = m[2];
    } else {
      sourceProductId = dirBase;
      sourceTitle = dirBase;
    }
    sourceUrl = `https://www.goofish.com/item?id=${sourceProductId}`;
    sourceDescription = sourceTitle;

    const rawSource = JSON.parse(fs.readFileSync(legacySourceJsonPath, 'utf-8'));
    if (Array.isArray(rawSource.assets)) {
      sourceImages = rawSource.assets.map((ast, idx) => ({
        position: idx + 1,
        file_name: path.basename(ast.name || `0${idx + 1}-商品图.webp`),
        sha256: '0'.repeat(64),
        width: 800,
        height: 800,
        original_url: ast.url || ''
      }));
    }
  } else {
    // 兜底从目录名解析
    const dirBase = path.basename(resolvedDir);
    const m = dirBase.match(/^([0-9a-zA-Z_-]+)-(.*)$/);
    sourceProductId = m ? m[1] : dirBase;
    sourceTitle = m ? m[2] : dirBase;
    sourceUrl = `https://www.goofish.com/item?id=${sourceProductId}`;
    sourceDescription = sourceTitle;
  }

  // 2. 若文案.txt存在且描述较空，补充文案
  if (fs.existsSync(textTxtPath)) {
    const txt = fs.readFileSync(textTxtPath, 'utf-8').trim();
    if (txt && (!sourceDescription || txt.length > sourceDescription.length)) {
      sourceDescription = txt;
    }
  }

  // 3. 校验并校正图片的实际 SHA-256
  const physicalImages = manifest.files.filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f.relativePath));
  for (let i = 0; i < sourceImages.length; i++) {
    const img = sourceImages[i];
    let matchedFile = manifest.files.find(f => path.basename(f.relativePath) === img.file_name);
    if (!matchedFile && physicalImages[i]) {
      // 容错：当元数据中的文件名与磁盘物理文件名不同时（例如来源.json中为远程哈希名），按顺序对齐物理文件
      matchedFile = physicalImages[i];
      img.file_name = path.basename(matchedFile.relativePath);
    }
    if (matchedFile) {
      img.sha256 = matchedFile.sha256;
    }
  }

  // 如果没有从 json 读到图片，从 manifest 中的图片文件自动构造
  if (sourceImages.length === 0) {
    const imgFiles = manifest.files.filter(f => /\.(webp|jpg|jpeg|png|gif)$/i.test(f.relativePath));
    sourceImages = imgFiles.map((f, idx) => ({
      position: idx + 1,
      file_name: path.basename(f.relativePath),
      sha256: f.sha256,
      width: 800,
      height: 800
    }));
  }

  // 价格从 options 注入或保持默认
  if (options.price !== undefined) {
    sourcePrice.amount = Number(options.price);
  }

  const sourceProduct = {
    source_product_id: sourceProductId || 'prod_unknown',
    source_url: sourceUrl || 'https://www.goofish.com/',
    source_title: sourceTitle || '未知商品标题',
    source_description: sourceDescription || '无商品描述',
    source_images: sourceImages,
    source_price: sourcePrice,
    captured_at: capturedAt,
    archive_manifest_hash: manifest.manifestHash
  };

  // 4. 进行严格的 Schema 校验
  const validation = validateData('source-product.schema.json', sourceProduct);
  if (!validation.valid) {
    throw new Error(`生成的 SourceProduct 未通过 Schema 验证: ${validation.formattedErrors}`);
  }

  return {
    sourceProduct,
    manifest
  };
}

export default {
  calculateFileHash,
  generateDirectoryManifest,
  adaptSourceProduct
};
