import {
  ClaimNature,
  EvidenceScope
} from "../constants/enums.js";
import { validateData } from "./schema-validator.js";
import { InvariantsGuard, InvariantViolationError } from "./invariants-guard.js";

/**
 * 证据链校验器 (EvidenceValidator)
 * 职责：严格对齐 claim_nature 分级与 evidence_scope 边界，阻断证据虚构与越界升级
 */
export class EvidenceValidator {
  /**
   * 校验整套 EvidenceSet
   * @param {object} evidenceSet 证据链集合对象
   * @param {object} sourceProduct 只读参考商品
   * @param {object} [options]
   * @returns {{ valid: boolean, violations: Array<{ claim_id: string, code: string, message: string }> }}
   */
  static validate(evidenceSet, sourceProduct, options = {}) {
    const violations = [];

    // 1. Schema 结构性校验
    const schemaValidation = validateData("evidence.schema.json", evidenceSet);
    if (!schemaValidation.valid) {
      throw new Error(`EvidenceSet 未通过 Schema 校验: ${schemaValidation.formattedErrors}`);
    }

    if (evidenceSet.source_product_id !== sourceProduct.source_product_id) {
      violations.push({
        claim_id: "root",
        code: "SOURCE_ID_MISMATCH",
        message: `证据集 source_product_id (${evidenceSet.source_product_id}) 与商品 (${sourceProduct.source_product_id}) 不符`
      });
    }

    const description = sourceProduct.source_description || "";
    const title = sourceProduct.source_title || "";
    const imageFileNames = new Set((sourceProduct.source_images || []).map(img => img.file_name));

    // 2. 逐条声明深度审计
    for (const claim of evidenceSet.claims) {
      // 2a. 守卫检查：同行事实严禁篡改为 SELLABLE_OFFER
      try {
        InvariantsGuard.assertEvidenceScopeIntegrity(claim);
      } catch (err) {
        if (err instanceof InvariantViolationError) {
          violations.push({
            claim_id: claim.claim_id,
            code: err.code,
            message: err.message
          });
          continue;
        }
        throw err;
      }

      // 2b. 来源引用真实性核对 (反幻觉引用)
      if (!Array.isArray(claim.sources) || claim.sources.length === 0) {
        if (claim.claim_nature === ClaimNature.FACT) {
          violations.push({
            claim_id: claim.claim_id,
            code: "FACT_WITHOUT_SOURCES",
            message: `FACT 声明 [${claim.claim_id}: "${claim.claim_text}"] 没有任何来源支撑`
          });
        }
        continue;
      }

      for (const src of claim.sources) {
        if (src.source_type === "SOURCE_DESCRIPTION") {
          // 如果提供了 char_range，验证文字切片
          if (src.char_range) {
            const slice = description.slice(src.char_range.start, src.char_range.end);
            if (slice !== src.source_ref) {
              violations.push({
                claim_id: claim.claim_id,
                code: "CHAR_RANGE_MISMATCH",
                message: `声明 [${claim.claim_id}] char_range 切片 ["${slice}"] 与 source_ref ["${src.source_ref}"] 不匹配`
              });
            }
          } else if (src.source_ref && !description.includes(src.source_ref) && !title.includes(src.source_ref)) {
            // 声明的文本引用完全不存在于文案和标题中
            violations.push({
              claim_id: claim.claim_id,
              code: "PHANTOM_SOURCE_REFERENCE",
              message: `声明 [${claim.claim_id}] 标注的文案引用 ["${src.source_ref}"] 在原始文案中不存在（虚构引用）`
            });
          }
        } else if (src.source_type === "SOURCE_IMAGE") {
          if (src.source_ref && !imageFileNames.has(src.source_ref)) {
            violations.push({
              claim_id: claim.claim_id,
              code: "NONEXISTENT_IMAGE_REFERENCE",
              message: `声明 [${claim.claim_id}] 引用的图片文件 ["${src.source_ref}"] 不存在于采集图片素材库中`
            });
          }
        }
      }

      // 2c. FACT 事实声明必须为 DIRECT_MATCH
      if (claim.claim_nature === ClaimNature.FACT) {
        if (claim.verification_status !== "DIRECT_MATCH") {
          violations.push({
            claim_id: claim.claim_id,
            code: "FACT_NOT_DIRECT_MATCH",
            message: `客观事实声明 [${claim.claim_id}] 必须为 DIRECT_MATCH（当前: ${claim.verification_status}）`
          });
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations
    };
  }
}

export default EvidenceValidator;
