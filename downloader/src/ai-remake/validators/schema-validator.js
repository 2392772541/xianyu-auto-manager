import Ajv from '../../../node_modules/ajv/dist/ajv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemasDir = path.resolve(__dirname, '../schemas');

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  validateFormats: false
});

// 优先注册基础枚举 Schema
const enumsPath = path.join(schemasDir, 'enums.schema.json');
if (fs.existsSync(enumsPath)) {
  const enumsSchema = JSON.parse(fs.readFileSync(enumsPath, 'utf-8'));
  ajv.addSchema(enumsSchema, 'enums.schema.json');
}

// 加载全部 schemas
const schemaFiles = fs.readdirSync(schemasDir).filter(f => f.endsWith('.schema.json') && f !== 'enums.schema.json');
for (const file of schemaFiles) {
  const schemaContent = JSON.parse(fs.readFileSync(path.join(schemasDir, file), 'utf-8'));
  const schemaId = schemaContent[''] || file;
  if (!ajv.getSchema(schemaId)) {
    ajv.addSchema(schemaContent, schemaId);
  }
}

/**
 * 校验数据是否符合指定的 Schema
 * @param {string} schemaName Schema 文件名或 ID，如 'source-product.schema.json'
 * @param {any} data 待校验数据对象
 * @returns {{ valid: boolean, errors: Array<object> | null, formattedErrors: string }}
 */
export function validateData(schemaName, data) {
  let validator = ajv.getSchema(schemaName);
  if (!validator) {
    if (!schemaName.endsWith('.schema.json')) {
      validator = ajv.getSchema(schemaName + '.schema.json');
    }
  }
  if (!validator) {
    throw new Error('未找到名为 ' + schemaName + ' 的 JSON Schema');
  }

  const valid = validator(data);
  const errors = valid ? null : (validator.errors || []);
  const formattedErrors = errors
    ? errors.map(e => '[' + (e.instancePath || 'root') + '] ' + e.message).join('; ')
    : '';

  return {
    valid: Boolean(valid),
    errors,
    formattedErrors
  };
}

export function getLoadedSchemas() {
  return [
    'enums.schema.json',
    ...schemaFiles
  ];
}

export default {
  validateData,
  getLoadedSchemas
};