import {
  RecommendedAction,
  RightsStatus,
  FulfillmentStatus,
  RiskFlag
} from "../constants/enums.js";
import { validateData } from "../validators/schema-validator.js";
import { InvariantsGuard } from "../validators/invariants-guard.js";

/**
 * ProductScorer - 商品价值与重制可行性评价器
 * 核心契约与语义定义 (遵循 P3 终审准则)：
 * 1. 绝不伪充全网市场测量：评分指标仅反映当前单品上下文及履约资产的信号强度，不代表真实市场销量或大盘需求；
 * 2. 严格输出 limitations 局限说明与 scoring_basis 打分依据；
 * 3. 严格定义 recommended_action 语义：
 *    - KEEP: 当前表达已基本适合继续加工，只需微调优化；
 *    - REMAKE: 商品事实和交付成立，但当前定位/表达值得重构；
 *    - DROP: 当前证据、权利、履约或信息条件下，不适合继续自动重制 (DROP != 市场上卖不动，而是当前系统不应继续往下加工)；
 * 4. 独立于 ProductDNA，改变打分规则时不污染底层商品事实模型。
 */
export class ProductScorer {
  constructor(modelProvider = null, options = {}) {
    this.modelProvider = modelProvider;
    this.schemaVersion = "product-scorecard.schema.json#v1.0.0";
    this.options = options;
  }

  /**
   * 构造启发式系统打分提示词 (用于 AI 辅助打分模式)
   */
  buildSystemPrompt() {
    return `你是一个严谨客观的闲鱼商品重制可行性评价器。
你的职责是评估基于已有【ProductDNA】与我方【SellableOffer】，该商品是否具备清晰的重制价值与可行性。

【评分维度 (严格 1-5 分整数)】
1. demand_signal_strength (1-5): 当前商品表达与交付物中是否含有明确的痛点/刚需/高频线索 (注意：仅代表单品信号强度，不代表全网真实市场规模)；
2. positioning_clarity (1-5): 原商品当前定位是否清晰明确 (1: 极其混乱模糊，5: 精准聚焦特定场景)；
3. differentiation_potential (1-5): 该商品能否通过重新提炼卖点或更换人群做出显著差异化；
4. remake_feasibility (1-5): 结合素材丰富度、版权与履约准备度，重制落地的容易程度。

【决策动作 recommended_action 判定标准】
- DROP: 存在不可调和风险 (如侵权、违法违禁、履约资源缺失不可用、核心信息严重缺失)；
- KEEP: 原定位与文案极为优秀清晰 (positioning_clarity >= 4 且 differentiation_potential <= 2)，无需颠覆重制，微调即可；
- REMAKE: 事实与交付成立，但当前定位模糊或存在明显更好的重构切入点。

必须输出严格符合 ProductScorecard JSON Schema 的 JSON 对象。`;
  }

  /**
   * 执行评价打分
   * @param {object} productDna 商品 DNA
   * @param {object} [sellableOffer] 我方实际可售商品实体
   * @param {object} [sourceProduct] 原始参考商品
   * @returns {Promise<object>} ProductScorecard 实例
   */
  async score(productDna, sellableOffer = null, sourceProduct = null) {
    if (!productDna || !productDna.source_product_id) {
      throw new Error("ProductScorer: 无效的 productDna 输入");
    }

    const sourceProductId = productDna.source_product_id;

    // 优先采用规则引擎与启发式评估矩阵，若注入 modelProvider 且配置使用 AI 则走模型
    let scorecardData;
    if (this.modelProvider && this.options.useAiEvaluation) {
      scorecardData = await this._evaluateViaModel(productDna, sellableOffer, sourceProduct);
    } else {
      scorecardData = this._evaluateViaHeuristics(productDna, sellableOffer, sourceProduct);
    }

    // 强制绑定 ID
    scorecardData.source_product_id = sourceProductId;

    // Ajv 运行期 Schema 严格校验
    const validation = validateData("product-scorecard.schema.json", scorecardData);
    if (!validation.valid) {
      throw new Error(`ProductScorer 评估结果未通过 ProductScorecard Schema 校验: ${validation.formattedErrors}`);
    }

    return scorecardData;
  }

  /**
   * 基于启发式规则矩阵评估（具备 100% 确定性与强防御性）
   */
  _evaluateViaHeuristics(productDna, sellableOffer, sourceProduct) {
    const riskFlags = productDna.risk_flags || [];
    const missingInfo = productDna.missing_information || [];
    const coreContent = productDna.core_content || [];
    const images = sourceProduct?.source_images || [];

    // 1. 检查致命阻断条件 (硬性 DROP 判定)
    const hasFatalRisk = riskFlags.some(r =>
      r.type === RiskFlag.ILLEGAL_OR_PROHIBITED ||
      (r.severity === "CRITICAL" && r.type === RiskFlag.COPYRIGHT_OR_LICENSE)
    );
    const isRightsNotAuthorized = sellableOffer && sellableOffer.rights_status === RightsStatus.NOT_AUTHORIZED;
    const isFulfillmentUnavailable = sellableOffer && sellableOffer.fulfillment_status === FulfillmentStatus.UNAVAILABLE;
    const isMissingCriticalCore = coreContent.length === 0;

    let recommendedAction = RecommendedAction.REMAKE;
    let decisionReason = "";
    let demandSignal = 3;
    let positioningClarity = 3;
    let diffPotential = 4;
    let remakeFeasibility = 4;

    if (hasFatalRisk) {
      recommendedAction = RecommendedAction.DROP;
      demandSignal = 1;
      remakeFeasibility = 1;
      decisionReason = "商品存在严重合规或知识产权违规风险，系统中止自动重制加工。";
    } else if (isRightsNotAuthorized) {
      recommendedAction = RecommendedAction.DROP;
      remakeFeasibility = 1;
      decisionReason = "该商品素材明确标记为无授权 (NOT_AUTHORIZED)，当前系统无法合法履约，中止重制。";
    } else if (isFulfillmentUnavailable) {
      recommendedAction = RecommendedAction.DROP;
      remakeFeasibility = 1;
      decisionReason = "我方可售资产履约状态为不可用 (UNAVAILABLE)，无法形成真实闭环交付，中止重制。";
    } else if (isMissingCriticalCore) {
      recommendedAction = RecommendedAction.DROP;
      positioningClarity = 1;
      remakeFeasibility = 1;
      decisionReason = "原商品核心交付内容为空或无法识别，在补充基础信息前系统中止重制。";
    } else {
      // 正常评估打分
      // a. 需求信号强度: 依据核心痛点、场景与卖点丰富度
      const signalPoints = (productDna.core_benefits?.length || 0) + (productDna.selling_points?.length || 0);
      if (signalPoints >= 4) demandSignal = 4;
      if (signalPoints >= 6) demandSignal = 5;
      if (signalPoints <= 1) demandSignal = 2;

      // b. 定位清晰度: 检查 target_customer 与 customer_problem 是否泛化
      const isTargetGeneric = !productDna.target_customer || productDna.target_customer.includes("所有人") || productDna.target_customer.includes("未知");
      positioningClarity = isTargetGeneric ? 2 : 4;

      // c. 差异化潜力: 若定位模糊但有实在内容，重新包装潜力极高
      diffPotential = positioningClarity <= 2 ? 5 : 3;

      // d. 重制可行性: 素材丰富度与履约就绪度
      let feasibilityScore = 3;
      if (images.length >= 3) feasibilityScore += 1;
      if (sellableOffer?.fulfillment_status === FulfillmentStatus.READY) feasibilityScore += 1;
      if (missingInfo.length > 3) feasibilityScore -= 1;
      remakeFeasibility = Math.max(1, Math.min(5, feasibilityScore));

      // 决定动作: 若原定位已达 5 分且差异化空间极小且素材完备，可建议 KEEP；否则一律 REMAKE
      if (positioningClarity >= 5 && diffPotential <= 2 && remakeFeasibility >= 4) {
        recommendedAction = RecommendedAction.KEEP;
        decisionReason = "原商品定位聚焦度极高，卖点与履约证据明确，建议保持现有方向仅做素材润色。";
      } else {
        recommendedAction = RecommendedAction.REMAKE;
        decisionReason = `商品核心事实与交付基础成立，当前定位清晰度为 ${positioningClarity} 分，存在通过人群重构与场景重塑实现差异化销售的良好空间。`;
      }
    }

    return {
      source_product_id: productDna.source_product_id,
      demand_signal_strength: demandSignal,
      positioning_clarity: positioningClarity,
      differentiation_potential: diffPotential,
      remake_feasibility: remakeFeasibility,
      recommended_action: recommendedAction,
      decision_reason: decisionReason,
      limitations: "本评分仅基于单商品当前文本、图片与交付物信号评估，未联网获取闲鱼全网销量、搜索热度或竞品大盘数据，属于启发式代理指标。",
      scoring_basis: {
        text_richness: `核心利益 ${productDna.core_benefits?.length || 0} 条，卖点 ${productDna.selling_points?.length || 0} 条`,
        image_count: images.length,
        has_concrete_facts: coreContent.length > 0
      },
      evidence_ids: []
    };
  }

  /**
   * 模型辅助打分路径
   */
  async _evaluateViaModel(productDna, sellableOffer, sourceProduct) {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = `请根据以下数据为商品重制可行性打分：
【ProductDNA】:
${JSON.stringify(productDna, null, 2)}

【SellableOffer (我方实际可售商品)】:
${sellableOffer ? JSON.stringify(sellableOffer, null, 2) : "尚未建立核验交付包"}

请输出合法的 ProductScorecard JSON。`;

    const { parsedData } = await this.modelProvider.invoke({
      systemPrompt,
      prompt,
      context: { source_product_id: productDna.source_product_id },
      responseSchema: "product-scorecard.schema.json"
    });

    return parsedData;
  }
}

export default ProductScorer;
