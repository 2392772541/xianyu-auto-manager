import {
  RecommendedAction,
  StrategyChangeScope
} from "../constants/enums.js";
import { validateData } from "../validators/schema-validator.js";
import { InvariantsGuard } from "../validators/invariants-guard.js";
import { StrategyGuard } from "../validators/strategy-guard.js";

/**
 * StrategyGenerator - 重制策略生成器
 * 核心契约与安全准则：
 * 1. 严格基于 ProductDNA 与已核验的 SellableOffer 生成 1~3 个差异化重制方向；
 * 2. 禁止策略擅自改变我方客观交付事实（若提议变动，必须标为 PRODUCT_CHANGE_REQUIRED 并转 HUMAN_INPUT）；
 * 3. 每个策略必须基于证据阐明 why_this_strategy_is_plausible，杜绝空想获胜；
 * 4. 给出建议推荐 proposed_strategy_id，但下游 selected_strategy_id 必须由人工显式确定；
 * 5. 若商品已被 Scorer 评定为 DROP，彻底阻断生成。
 */
export class StrategyGenerator {
  constructor(modelProvider, options = {}) {
    if (!modelProvider) {
      throw new Error("StrategyGenerator 必须注入 ModelProvider 实例");
    }
    this.modelProvider = modelProvider;
    this.promptVersion = options.promptVersion || "v1.0.0";
    this.schemaVersion = "remake-strategy.schema.json#v1.0.0";
  }

  buildSystemPrompt() {
    return `你是一个极具商业敏锐度的闲鱼商品包装与重制策略专家。
你的职责是：基于客观的【ProductDNA】以及我方实际拥有的【SellableOffer】，制定 1~3 个定位清晰、切入点不同的全新重制销售策略。

【核心原则与红线】
1. 严禁改变我方实际可交付资产：策略只能改变【目标人群、应用场景、痛点包装、卖点排序、视觉调性】，绝不能凭空增加我方没有的文件、实物或赠品；
2. 若确实认为有必要新增赠品或重组产品形态，该策略的 strategy_change_scope 必须标为 "PRODUCT_CHANGE_REQUIRED"，以便转交人工审核；
3. 实质性差异要求：生成的多个策略之间必须有显著不同的人群或切入场景（例如：考公考研人群 vs 职场升职汇报 vs 自媒体创作），禁止简单同义换皮；
4. 合理性论证：必须在 why_this_strategy_is_plausible 字段中说明为什么基于当前证据该策略是合理可行的。

【输出结构】
输出合法的 ProductRemakeStrategySet JSON，包含：
- source_product_id: 字符串
- proposed_strategy_id: 推荐的首选策略 ID
- strategies: 1~3 个策略对象，每个包含：
  * strategy_id: 形如 "strat_xxxx"
  * positioning: 整体市场定位
  * target_customer: 明确目标人群
  * main_selling_angle: 核心打动力与主卖点角度
  * title_direction: 标题撰写方向指导
  * content_direction: 详情文案组织重点
  * image_direction: 封面与配图视觉调性建议
  * price_strategy: { recommended_price, price_rationale }
  * why_this_strategy_is_plausible: 证据与逻辑论证
  * confidence_score: 0-1 数值
  * strategy_change_scope: "POSITIONING_ONLY" | "MESSAGING_ONLY" | "AUDIENCE_REFRAME" | "PACKAGING_REFRAME" | "PRODUCT_CHANGE_REQUIRED"
  * evidence_ids: 字符串数组`;
  }

  buildUserPrompt(productDna, sellableOffer) {
    return `请为以下商品生成重制策略：

【来源商品ID】: ${productDna.source_product_id}
【客观商品理解 ProductDNA】:
- 商品类别: ${productDna.product_type} / ${productDna.product_category}
- 核心内容: ${JSON.stringify(productDna.core_content)}
- 原定位人群与痛点: ${productDna.target_customer} / ${productDna.customer_problem}
- 核心利益与卖点: ${JSON.stringify(productDna.selling_points)}

【我方实际可售资产 SellableOffer】:
- 实际交付形态: ${sellableOffer?.fulfillment_type || "未指定"}
- 实际交付资产清单: ${JSON.stringify(sellableOffer?.actual_contents || [])}
- 权利状态: ${sellableOffer?.rights_status || "UNKNOWN"}
- 可交付状态: ${sellableOffer?.fulfillment_status || "NOT_CHECKED"}

请生成 1 到 3 个具有实质差异化的商品重制策略。`;
  }

  /**
   * 生成候选重制策略集合
   * @param {object} productDna
   * @param {object} sellableOffer
   * @param {object} scorecard 评价卡
   * @param {object} [options]
   * @returns {Promise<{ strategySet: object, auditTrail: object }>}
   */
  async generate(productDna, sellableOffer, scorecard, options = {}) {
    return this.generateStrategies(productDna, sellableOffer, scorecard, options);
  }

  async generateStrategies(productDna, sellableOffer, scorecard, options = {}) {
    InvariantsGuard.assertSourceReadOnly(false, productDna?.source_product_id);

    // 1. 不变量 5 守卫：DROP 评定商品严禁触发后续营销策略与文案生成
    InvariantsGuard.assertNotDroppedForContentGen(scorecard);

    if (!productDna || !productDna.source_product_id) {
      throw new Error("StrategyGenerator: 无效的 productDna 输入");
    }

    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildUserPrompt(productDna, sellableOffer);

    const context = {
      source_product_id: productDna.source_product_id,
      scorecard,
      options
    };

    // 2. 调用模型推理
    const { rawOutput, parsedData, auditTrail } = await this.modelProvider.invoke({
      systemPrompt,
      prompt,
      context,
      responseSchema: "remake-strategy.schema.json"
    });

    if (!parsedData || typeof parsedData !== "object") {
      throw new Error(`StrategyGenerator: 模型返回无效 JSON: ${rawOutput}`);
    }

    parsedData.source_product_id = productDna.source_product_id;
    if (!parsedData.proposed_strategy_id && Array.isArray(parsedData.strategies) && parsedData.strategies[0]) {
      parsedData.proposed_strategy_id = parsedData.strategies[0].strategy_id;
    }

    // 3. Schema 校验
    const validation = validateData("remake-strategy.schema.json", parsedData);
    if (!validation.valid) {
      throw new Error(`StrategyGenerator: 输出未通过 RemakeStrategy Schema 校验: ${validation.formattedErrors}`);
    }

    // 4. StrategyGuard 守卫检查：不变量 8 (严禁篡改实际资产事实) & 不变量 9 (实质性差异)
    StrategyGuard.assertStrategyDoesNotMutateOfferFacts(parsedData, sellableOffer);
    StrategyGuard.assertStrategyDiversity(parsedData);

    return {
      strategySet: parsedData,
      auditTrail
    };
  }
}

export default StrategyGenerator;
