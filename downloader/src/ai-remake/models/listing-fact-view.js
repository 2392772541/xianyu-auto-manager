import { EvidenceScope, ClaimNature } from "../constants/enums.js";

/**
 * ListingFactView - 可发布事实视图
 * 遵循 P4 终审核心架构：
 * 1. 它是连接“内部核验事实”与“对外文案生成”的唯一权威只读事实视图；
 * 2. 最终发布商品中的我方 FACT 声明，必须由 SELLABLE_OFFER 或 HUMAN_CONFIRMED 支撑；
 * 3. REFERENCE_SOURCE 仅能作为定位、关键词、受众推断和表达启发，绝不能单独证明我方真实可售事实。
 */
export class ListingFactView {
  /**
   * 构造只读的可发布事实视图
   * @param {object} params
   */
  constructor({
    source_product_id,
    actual_contents,
    fulfillment_type,
    rights_status,
    deliverable_verified,
    verified_facts,
    permissible_inferences,
    reference_inspirations
  }) {
    this.source_product_id = source_product_id;
    this.actual_contents = Object.freeze([...(actual_contents || [])]);
    this.fulfillment_type = fulfillment_type;
    this.rights_status = rights_status;
    this.deliverable_verified = !!deliverable_verified;
    this.verified_facts = Object.freeze([...(verified_facts || [])]);
    this.permissible_inferences = Object.freeze([...(permissible_inferences || [])]);
    this.reference_inspirations = Object.freeze({ ...(reference_inspirations || {}) });

    Object.freeze(this);
  }

  /**
   * 从 SellableOffer、EvidenceSet 与 ProductDNA 确定性计算构建视图
   * @param {object} sellableOffer 我方真实可售商品
   * @param {object} evidenceSet 证据集
   * @param {object} productDna 客观商品理解
   * @returns {ListingFactView}
   */
  static build(sellableOffer, evidenceSet = { claims: [] }, productDna = {}) {
    return this.from(sellableOffer, evidenceSet, productDna);
  }

  static from(sellableOffer, evidenceSet = { claims: [] }, productDna = {}) {
    if (!sellableOffer || !sellableOffer.source_product_id) {
      throw new Error("ListingFactView: 必须提供有效的 sellableOffer 实例");
    }

    const claims = evidenceSet.claims || [];

    // 1. 严格筛选可用于发布的事实 (只能来源于 SELLABLE_OFFER 或 HUMAN_CONFIRMED)
    const verifiedFacts = claims.filter(c =>
      c.claim_nature === ClaimNature.FACT &&
      (c.evidence_scope === EvidenceScope.SELLABLE_OFFER || c.evidence_scope === EvidenceScope.HUMAN_CONFIRMED) &&
      c.verification_status === "DIRECT_MATCH"
    );

    // 2. 允许用于表达修饰的推断与修辞
    const permissibleInferences = claims.filter(c =>
      c.claim_nature === ClaimNature.INFERENCE ||
      c.claim_nature === ClaimNature.MARKETING_EXPRESSION
    );

    // 3. 仅作为营销启发的同行参考信息
    const referenceInspirations = {
      target_customer_hint: productDna.target_customer || "",
      customer_problem_hint: productDna.customer_problem || "",
      suggested_keywords: productDna.keywords || [],
      selling_points_hints: productDna.selling_points || []
    };

    return new ListingFactView({
      source_product_id: sellableOffer.source_product_id,
      actual_contents: sellableOffer.actual_contents,
      fulfillment_type: sellableOffer.fulfillment_type,
      rights_status: sellableOffer.rights_status,
      deliverable_verified: sellableOffer.deliverable_verified,
      verified_facts: verifiedFacts,
      permissible_inferences: permissibleInferences,
      reference_inspirations: referenceInspirations
    });
  }

  /**
   * 检查某个声明是否属于可发布事实
   * @param {string} claimText
   * @returns {boolean}
   */
  isFactPublishable(claimText) {
    if (!claimText) return false;
    const cleanText = claimText.trim();

    // 检查是否在实际交付清单中
    if (this.actual_contents.some(item => {
      const text = typeof item === "string" ? item : [item?.item_name, item?.format, item?.count != null ? String(item.count) : "", item?.remarks].filter(Boolean).join(" ");
      return text.includes(cleanText) || cleanText.includes(text);
    })) {
      return true;
    }

    // 检查是否在已核验我方事实列表中
    return this.verified_facts.some(f => f.claim_text.includes(cleanText) || cleanText.includes(f.claim_text));
  }
}

export default ListingFactView;
