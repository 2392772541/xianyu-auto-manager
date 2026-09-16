import { InvariantViolationError } from "./invariants-guard.js";

/**
 * ContentGuard - 发布文案内容质量与事实合规守卫
 * 遵循 P4 终审准则：
 * - Invariant 12: 最终商品 FACT 声明不得仅由 REFERENCE_SOURCE 支撑；
 * - 拦截未核验交付物增加与承诺；
 * - 防范 "Claim Nature Laundering"（声明性质洗白：将数量、规格、保修等事实故意包装成营销修辞规避证据校验）；
 * - 拦截夸大承诺与违禁绝对化用词。
 */

function extractActualContentsText(actualContents) {
  if (!Array.isArray(actualContents)) return "";
  return actualContents.map(item => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const parts = [
        item.item_name,
        item.format,
        item.count ? item.count + "节" : "",
        item.count ? item.count + "套" : "",
        item.count ? item.count + "条" : "",
        item.count ? item.count + "个" : "",
        item.count ? item.count + "张" : "",
        item.count ? item.count + "款" : "",
        item.count ? item.count + "页" : "",
        item.count ? item.count + "件" : "",
        item.count != null ? String(item.count) : "",
        item.remarks
      ];
      return parts.filter(Boolean).join(" ");
    }
    return String(item || "");
  }).join(" ");
}

export const ContentGuard = {
  /**
   * 核心校验方法
   * @param {object} listingContent 文案草稿
   * @param {object} listingFactView 可发布事实视图
   * @param {object} selectedStrategy 人工选定的重制策略
   * @param {object} [evidenceSet]
   */
  validateContent(listingContent, listingFactView, selectedStrategy, evidenceSet = { claims: [] }) {
    if (!listingContent) {
      throw new InvariantViolationError("MISSING_LISTING_CONTENT", "文案内容对象为空");
    }

    const title = listingContent.title || "";
    const description = listingContent.description || "";
    const fullText = `${title} ${description} ${(listingContent.bullet_points || []).join(" ")} ${listingContent.cover_copy?.headline || ""} ${listingContent.cover_copy?.subheadline || ""}`;

    // 1. 策略对齐校验：必须严格绑定选定的策略 ID
    if (listingContent.selected_strategy_id !== selectedStrategy.strategy_id) {
      throw new InvariantViolationError(
        "STRATEGY_ALIGNMENT_MISMATCH",
        `文案策略ID (${listingContent.selected_strategy_id}) 与人工选定的策略ID (${selectedStrategy.strategy_id}) 不一致！`
      );
    }

    // 2. 交付物扩展越界拦截 (检查是否凭空虚构赠品或服务)
    const actualContents = listingFactView.actual_contents || [];
    const actualText = extractActualContentsText(actualContents);
    const prohibitedInventions = ["送源码","附送模板","一对一指导","社群答疑","永久包更新","全网独家","秒发","自动秒发","在保","官方在保","全国联保","无暗病划痕","保价验机","箱说齐全","配件全家福"];

    for (const phrase of prohibitedInventions) {
      if (fullText.includes(phrase) && !actualText.includes(phrase)) {
        throw new InvariantViolationError(
          "UNAUTHORIZED_DELIVERABLE_INVENTION",
          `文案中包含了未在 SellableOffer 中核验的交付承诺: "${phrase}"，严禁虚构商品资产！`
        );
      }
    }

    // 3. 广告法与夸大绝对化用词拦截
    const absolutePhrases = ["国家级", "全网第一", "保百分百过", "药到病除", "稳赚不赔"];
    for (const badWord of absolutePhrases) {
      if (fullText.includes(badWord)) {
        throw new InvariantViolationError(
          "PROHIBITED_MARKETING_PROMISE",
          `文案触犯绝对化违禁词或夸大承诺: "${badWord}"`
        );
      }
    }

    // 4. Invariant 12 与防洗白 (Anti-Claim Nature Laundering) 校验
    // 自动扫描文案中出现的数字/数量指标 (如 "162节", "5000套", "300页", "99新")
    this._assertNoLaunderedOrUnverifiedQuantity(fullText, listingFactView, evidenceSet);
  },

  /**
   * 数量与规格事实防洗白校验
   * 确保文案中声称的明确数量事实，必须在 ListingFactView 中有真实核验证据，绝不能凭同行声称直接出库
   */
  _assertNoLaunderedOrUnverifiedQuantity(fullText, listingFactView, evidenceSet) {
    // 匹配如 162节、5000条、20套、99新 等明确度量特征
    const quantityPattern = /([0-9]+[+]?(?:节|套|条|个|张|款|页|G|GB|MB|件))/g;
    const matches = fullText.match(quantityPattern) || [];

    const actualText = extractActualContentsText(listingFactView.actual_contents || []);

    for (const match of matches) {
      // 检查该数量是否在我方实际交付资产中得到真实核验 (SellableOffer 包含)
      const isPresentInMyOffer = actualText.includes(match);

      // 检查证据链中是否存在针对该声明的 SELLABLE_OFFER 或 HUMAN_CONFIRMED 级别的 DIRECT_MATCH
      const hasVerifiedClaim = (evidenceSet.claims || []).some(c =>
        c.claim_text.includes(match) &&
        (c.evidence_scope === "SELLABLE_OFFER" || c.evidence_scope === "HUMAN_CONFIRMED") &&
        c.verification_status === "DIRECT_MATCH"
      );

      // 若我方实际资产未涵盖该数量，且无已核验事实支撑，哪怕模型自称这是"修辞/营销词"，必须硬性拦截！
      if (!isPresentInMyOffer && !hasVerifiedClaim) {
        throw new InvariantViolationError(
          "UNVERIFIED_QUANTITY_FACT_BREACH",
          `文案中声称了数量/规格事实 "${match}"，但我方可售资产 (SellableOffer) 中未核验此数量，且缺乏 SELLABLE_OFFER 证据支撑！(不变量 12 拦截，严禁利用同行参考事实直接出库)`
        );
      }
    }
  }
};

export default ContentGuard;
