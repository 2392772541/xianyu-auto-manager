import {
  ClaimNature,
  EvidenceScope,
  DeliveryType
} from "../constants/enums.js";
import { validateData } from "../validators/schema-validator.js";
import { InvariantsGuard } from "../validators/invariants-guard.js";
import { EvidenceValidator } from "../validators/evidence-validator.js";

/**
 * ProductAnalyst - 商品分析器
 * 核心契约：
 * 1. 严格只回答“同行页面表达的商品是什么？”，绝不推断“我们实际拥有或能卖什么”；
 * 2. 严禁主观商业打分（不包含 demand_score 等，解耦至 ProductScorecard）；
 * 3. 提取的事实声明其 EvidenceScope 强制锁定为 REFERENCE_SOURCE；
 * 4. 严禁脑补不存在的赠品、规格、配件，必须将其列入 missing_information 或 unsupported_claims。
 */
export class ProductAnalyst {
  constructor(modelProvider, options = {}) {
    if (!modelProvider) {
      throw new Error("ProductAnalyst 必须注入 ModelProvider 实例");
    }
    this.modelProvider = modelProvider;
    this.promptVersion = options.promptVersion || "v1.0.0";
    this.schemaVersion = "product-dna.schema.json#v1.0.0";
  }

  /**
   * 构造系统提示词
   */
  buildSystemPrompt() {
    return `你是一个客观、极度严谨的闲鱼商品事实分析器。
你的唯一职责是：全面审视同行采集商品的标题、描述与图片素材，提炼出客观、精准的【商品事实理解】(Product DNA)。

【绝对禁止事项】
1. 严禁主观臆断我方库存：你只能分析同行页面“声称”是什么，绝不能推断“我方实际拥有这些文件或实物”；
2. 严禁主观商业打分：不要给出任何市场前景评分、需求分或推荐动作（这些由下游 Scorecard 负责）；
3. 严禁擅自补全未知事实：若原标题与文案未明确提及赠品、包装、课时、发票、授权证书等，严禁脑补，必须如实放入 missing_information 或 unsupported_claims；
4. 事实与推断严格分离：客观参数、件数、型号属于 FACT；适用人群、痛点场景属于 INFERENCE；宣传形容词属于 MARKETING_EXPRESSION。

【输出要求】
必须输出严格符合 ProductDNA JSON Schema 格式的 JSON 对象，包含字段：
- source_product_id (字符串)
- product_type: "VIRTUAL_RESOURCE" | "PHYSICAL_GOODS" | "SERVICE" | "HYBRID" | "UNKNOWN"
- product_category: string
- target_customer: string
- customer_problem: string
- purchase_motivation: string
- usage_scenario: string
- core_content: string[]
- core_benefits: string[]
- selling_points: string[]
- keywords: string[]
- delivery_type: "NETDISK" | "CARD_KEY" | "AUTO_SHIP" | "MANUAL_SERVICE" | "OTHER"
- risk_flags: Array<{ type, severity, reason, remediation_suggestion }>
- unsupported_claims: string[]
- missing_information: string[]
- need_human_review: boolean`;
  }

  /**
   * 构造用户提示词
   */
  buildUserPrompt(sourceProduct) {
    const imagesMeta = (sourceProduct.source_images || []).map(img =>
      `- [${img.position}] 文件名: ${img.file_name} (${img.width}x${img.height}, sha256: ${img.sha256.slice(0, 10)}...)`
    ).join("\n");

    return `请分析以下采集商品：

【商品ID】: ${sourceProduct.source_product_id}
【原始标题】: ${sourceProduct.source_title}
【原始描述】:
${sourceProduct.source_description}

【参考价格】: ${sourceProduct.source_price?.amount || 0} ${sourceProduct.source_price?.currency || "CNY"}
【图片素材列表】:
${imagesMeta || "无图片素材"}

请严格基于上述提供的事实进行结构化分析，不要添加未经证实的额外信息，输出合法的 JSON 对象。`;
  }

  /**
   * 执行分析流程
   * @param {object} sourceProduct 只读参考商品
   * @param {object} [options]
   * @returns {Promise<{ productDna: object, evidenceSet: object, auditTrail: object }>}
   */
  async analyze(sourceProduct, options = {}) {
    InvariantsGuard.assertSourceReadOnly(false, sourceProduct?.source_product_id);

    if (!sourceProduct || !sourceProduct.source_product_id) {
      throw new Error("无效的 sourceProduct");
    }

    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildUserPrompt(sourceProduct);

    const context = {
      sourceProduct,
      source_manifest_hash: sourceProduct.archive_manifest_hash,
      options
    };

    // 1. 调用模型层（通过 ModelProvider）
    const { rawOutput, parsedData, auditTrail } = await this.modelProvider.invoke({
      systemPrompt,
      prompt,
      context,
      responseSchema: "product-dna.schema.json"
    });

    if (!parsedData || typeof parsedData !== "object") {
      throw new Error(`模型返回的不是有效的 JSON 对象: ${rawOutput}`);
    }

    // 强制确保 source_product_id 对齐
    parsedData.source_product_id = sourceProduct.source_product_id;

    // 2. Schema 校验
    const validation = validateData("product-dna.schema.json", parsedData);
    if (!validation.valid) {
      throw new Error(`ProductAnalyst 输出未通过 ProductDNA Schema 校验: ${validation.formattedErrors}`);
    }

    // 3. 构建对应的 EvidenceSet
    const evidenceSet = this.buildEvidenceSet(parsedData, sourceProduct);

    // 4. 执行严密证据链校验
    const evidenceValidation = EvidenceValidator.validate(evidenceSet, sourceProduct);
    if (!evidenceValidation.valid) {
      const errMsgs = evidenceValidation.violations.map(v => `[${v.code}] ${v.message}`).join("; ");
      throw new Error(`ProductAnalyst 证据链校验失败: ${errMsgs}`);
    }

    return {
      productDna: parsedData,
      productDNA: parsedData,
      evidenceSet,
      auditTrail
    };
  }

  /**
   * 依据分析出的客观事实构建 EvidenceSet
   * 确保同行页面事实的 EvidenceScope 永远锁定为 REFERENCE_SOURCE
   */
  buildEvidenceSet(productDna, sourceProduct) {
    const claims = [];
    const desc = sourceProduct.source_description || "";
    const title = sourceProduct.source_title || "";
    let claimCounter = 1;

    // 辅助生成 Claim ID
    const nextClaimId = () => `clm_${String(claimCounter++).padStart(4, "0")}`;

    // 1. 核心内容条目 -> 对应为 FACT 声明
    for (const item of productDna.core_content) {
      const isDirectInText = desc.includes(item) || title.includes(item);
      const isDirectInImage = (sourceProduct.source_images || []).some(img => img.file_name && img.file_name.includes(item));

      let sources = [];
      let verificationStatus = "UNVERIFIED";

      if (isDirectInText) {
        sources.push({
          source_type: desc.includes(item) ? "SOURCE_DESCRIPTION" : "SOURCE_TITLE",
          source_ref: item
        });
        verificationStatus = "DIRECT_MATCH";
      } else if (isDirectInImage) {
        const matchedImg = sourceProduct.source_images.find(img => img.file_name.includes(item));
        sources.push({
          source_type: "SOURCE_IMAGE",
          source_ref: matchedImg.file_name
        });
        verificationStatus = "DIRECT_MATCH";
      } else {
        // 如果不在原文中直接出现，作为推断性或待核对项
        sources.push({
          source_type: "SOURCE_DESCRIPTION",
          source_ref: desc.slice(0, Math.min(30, desc.length)) || title
        });
        verificationStatus = "INDIRECT_INFERRED";
      }

      claims.push({
        claim_id: nextClaimId(),
        claim_text: item,
        claim_nature: verificationStatus === "DIRECT_MATCH" ? ClaimNature.FACT : ClaimNature.INFERENCE,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE, // 严格锁定为同行参考，绝不升级为我方事实
        sources,
        verification_status: verificationStatus,
        confidence: verificationStatus === "DIRECT_MATCH" ? 0.95 : 0.65
      });
    }

    // 2. 核心卖点 -> 对应为 MARKETING_EXPRESSION 或 INFERENCE
    for (const point of productDna.selling_points) {
      claims.push({
        claim_id: nextClaimId(),
        claim_text: point,
        claim_nature: ClaimNature.MARKETING_EXPRESSION,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE,
        sources: [
          {
            source_type: "SOURCE_DESCRIPTION",
            source_ref: desc.slice(0, Math.min(20, desc.length)) || title
          }
        ],
        verification_status: "INDIRECT_INFERRED",
        confidence: 0.8
      });
    }

    // 3. 核心价值利益 -> 对应为 INFERENCE
    for (const benefit of productDna.core_benefits) {
      claims.push({
        claim_id: nextClaimId(),
        claim_text: benefit,
        claim_nature: ClaimNature.INFERENCE,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE,
        sources: [
          {
            source_type: "SOURCE_DESCRIPTION",
            source_ref: desc.slice(0, Math.min(20, desc.length)) || title
          }
        ],
        verification_status: "INDIRECT_INFERRED",
        confidence: 0.85
      });
    }

    return {
      source_product_id: sourceProduct.source_product_id,
      claims
    };
  }
}

export default ProductAnalyst;
