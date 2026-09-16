import crypto from "node:crypto";

/**
 * 递归规范化对象键排序，生成确定性 JSON 字符串
 */
export function canonicalStringify(data) {
  if (data === undefined) {
    return "null";
  }
  if (data === null || typeof data !== "object") {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return "[" + data.map(item => canonicalStringify(item)).join(",") + "]";
  }
  const keys = Object.keys(data).sort();
  const pairs = keys
    .filter(k => data[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalStringify(data[k])}`);
  return "{" + pairs.join(",") + "}";
}

/**
 * 计算字符串、Buffer 或对象的 SHA-256 哈希值
 */
export function sha256(input) {
  if (input === undefined) {
    input = "null";
  }
  const content = typeof input === "string" || Buffer.isBuffer(input) ? input : canonicalStringify(input);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * 对任意数据结构生成确定性的规范哈希
 */
export function computeCanonicalHash(data) {
  return sha256(canonicalStringify(data));
}

export default {
  canonicalStringify,
  sha256,
  computeCanonicalHash
};
