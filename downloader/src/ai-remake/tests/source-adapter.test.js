import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFileHash,
  generateDirectoryManifest,
  adaptSourceProduct
} from '../adapters/source-adapter.js';
import { validateData } from '../validators/schema-validator.js';

test('SourceAdapter - 1. 递归清单扫描与根哈希生成确定性', () => {
  const targetDir = '商品素材/下载器/1063279814277-拆开了，算是没用过，大疆pocket3/2026-09-13T13-41-32-859Z-3067';
  const manifest1 = generateDirectoryManifest(targetDir);
  const manifest2 = generateDirectoryManifest(targetDir);

  assert.ok(manifest1.files.length >= 4, '文件总数应至少包含商品信息.json、文案.txt及图片');
  assert.equal(manifest1.manifestHash, manifest2.manifestHash, '相同目录的清单根哈希必须完全一致（确定性保证）');
  assert.match(manifest1.manifestHash, /^[a-f0-9]{64}$/, '根哈希必须是64位十六进制SHA-256');

  // 验证每个文件的哈希格式
  for (const f of manifest1.files) {
    assert.match(f.sha256, /^[a-f0-9]{64}$/);
    assert.ok(f.size > 0);
  }
});

test('SourceAdapter - 2. 单文件哈希计算与只读安全性', () => {
  const filePath = '商品素材/下载器/1063279814277-拆开了，算是没用过，大疆pocket3/2026-09-13T13-41-32-859Z-3067/商品信息.json';
  const hash = calculateFileHash(filePath);
  assert.match(hash, /^[a-f0-9]{64}$/);

  // 验证对不存在路径抛错
  assert.throws(() => {
    generateDirectoryManifest('商品素材/不存在的目录');
  }, /商品素材目录不存在/);
});

test('SourceAdapter - 3. 适配真实标准采集包并满足 SourceProduct Schema', () => {
  const sampleDir = '商品素材/下载器/1063279814277-拆开了，算是没用过，大疆pocket3/2026-09-13T13-41-32-859Z-3067';
  const { sourceProduct, manifest } = adaptSourceProduct(sampleDir, { price: 2999 });

  // 基础字段核验
  assert.equal(sourceProduct.source_product_id, '1063279814277');
  assert.equal(sourceProduct.source_url, 'https://www.goofish.com/item?id=1063279814277');
  assert.equal(sourceProduct.source_title, '拆开了，算是没用过，大疆pocket3');
  assert.ok(sourceProduct.source_description.includes('大疆pocket3'));
  assert.equal(sourceProduct.source_price.amount, 2999);
  assert.equal(sourceProduct.source_price.currency, 'CNY');
  assert.equal(sourceProduct.archive_manifest_hash, manifest.manifestHash);

  // 图片数量与真实哈希校验
  assert.equal(sourceProduct.source_images.length, 3);
  for (const img of sourceProduct.source_images) {
    assert.ok(img.position >= 1);
    assert.match(img.file_name, /0[1-3]\.webp/);
    assert.match(img.sha256, /^[a-f0-9]{64}$/);
    assert.notEqual(img.sha256, '0'.repeat(64), '真实图片SHA-256不可为全0占位');
    assert.ok(img.width > 0);
    assert.ok(img.height > 0);
  }

  // Schema 严格自洽性核验
  const validation = validateData('source-product.schema.json', sourceProduct);
  assert.equal(validation.valid, true, `Schema 校验失败: ${validation.formattedErrors}`);
});

test('SourceAdapter - 4. 适配旧版来源.json采集包并满足 SourceProduct Schema', () => {
  const legacyDir = '商品素材/1064285821878-162节审美课程';
  const { sourceProduct, manifest } = adaptSourceProduct(legacyDir);

  assert.equal(sourceProduct.source_product_id, '1064285821878');
  assert.equal(sourceProduct.source_title, '162节审美课程');
  assert.equal(sourceProduct.source_images.length, 4);
  assert.equal(sourceProduct.archive_manifest_hash, manifest.manifestHash);

  // 确保图片哈希正确从物理文件对齐
  for (const img of sourceProduct.source_images) {
    assert.match(img.sha256, /^[a-f0-9]{64}$/);
    assert.notEqual(img.sha256, '0'.repeat(64));
  }

  const validation = validateData('source-product.schema.json', sourceProduct);
  assert.equal(validation.valid, true, `旧版 Schema 校验失败: ${validation.formattedErrors}`);
});
