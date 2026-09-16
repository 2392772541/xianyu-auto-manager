import { validateData } from "../validators/schema-validator.js";
import { ContentGuard } from "../validators/content-guard.js";

/**
 * ContentGenerator - 转化导向商品文案生成器
 * 核心契约：
 * 1. 严格消费已人工确认的单一 selectedStrategy；
 * 2. 严格受控于 ListingFactView，只能在允许的可发布事实交集内组织文案；
 * 3. 产出标题、结构化详情、核心卖点、SEO关键词、封面配图核心文案与发货说明；
 * 4. 交付物与事实经过 ContentGuard 强力拦截保护。
 */
export class ContentGenerator {
  constructor(modelProvider, options = {}) {
    if (!modelProvider) {
      throw new Error("ContentGenerator: 必须注入 ModelProvider 实例");
    }
    this.modelProvider = modelProvider;
    this.promptVersion = options.promptVersion || "v1.0.0";
    this.schemaVersion = "listing-content.schema.json#v1.0.0";
  }

  buildSystemPrompt() {
    return `你是一个精通闲鱼平台生态的商品文案策划专家。
你的任务是：根据选定的【重制策略】与我方【可发布事实视图】，撰写高吸引力、事实严谨的闲鱼商品候选文案。

【核心事实铁律】
1. 只能在【可发布事实视图】允许的范围内表达：绝不能凭空捏造未核验的附赠软件、模板库、售后答疑或保证；
2. 数量与规格必须真实：若我方实际交付为 120 节，绝不能照抄同行的 162 节；
3. 严格遵循选定策略：标题、卖点和描述必须围绕该策略指定的目标客户与核心角度展开；
4. 语言风格：符合闲鱼二手/个人转让的真实口吻，真诚、结构清晰、排版易读，杜绝虚假浮夸词汇。

【输出结构】
输出符合 ListingContent Schema 的 JSON 对象：
- source_product_id: 字符串
- selected_strategy_id: 字符串 (必须与选定策略严格一致)
- title: 标题 (5-60字)
- description: 详情文案 (20-3000字，包含场景、亮点、交付说明)
- bullet_points: 核心卖点清单 (3-8条)
- keywords: 搜索关键词 (3-15个)
- cover_copy: { headline (20字内), subheadline (30字内), tag (可选10字内) }
- delivery_note: 发货与履约提示 (500字内)
- claim_ids: 关联事实声明 ID 列表`;
  }

  buildUserPrompt(selectedStrategy, listingFactView) {
    return `请为以下商品生成重制文案：

【商品ID】: ${listingFactView.source_product_id}
【选定重制策略】:
- 策略ID: ${selectedStrategy.strategy_id}
- 定位方向: ${selectedStrategy.positioning}
- 目标受众: ${selectedStrategy.target_customer}
- 主卖点切入点: ${selectedStrategy.main_selling_angle}
- 标题指引: ${selectedStrategy.title_direction}
- 文案重点: ${selectedStrategy.content_direction}
- 价格策略: ${JSON.stringify(selectedStrategy.price_strategy || {})}

【我方可发布事实 ListingFactView】:
- 真实拥有内容清单: ${JSON.stringify(listingFactView.actual_contents)}
- 履约交付方式: ${listingFactView.fulfillment_type}
- 权利状态: ${listingFactView.rights_status}
- 已核验可发布事实: ${JSON.stringify(listingFactView.verified_facts.map(f => f.claim_text))}

请生成完整、真实、符合闲鱼语境的发布文案。`;
  }

  /**
   * 生成发布文案
   * @param {object} selectedStrategy 选定的重制策略
   * @param {object} listingFactView 可发布事实视图
   * @param {object} [evidenceSet]
   * @param {object} [options]
   * @returns {Promise<{ listingContent: object, auditTrail: object }>}
   */
  async generate(selectedStrategy, sellableOfferOrFactView, factViewOrEvidenceSet, options = {}) {
    const factView = (sellableOfferOrFactView && sellableOfferOrFactView.verified_facts)
      ? sellableOfferOrFactView
      : (factViewOrEvidenceSet && factViewOrEvidenceSet.verified_facts ? factViewOrEvidenceSet : { source_product_id: selectedStrategy.source_product_id, actual_contents: [], fulfillment_type: "OTHER", rights_status: "UNKNOWN", verified_facts: [] });
    const evSet = (factViewOrEvidenceSet && Array.isArray(factViewOrEvidenceSet.claims))
      ? factViewOrEvidenceSet
      : { claims: [] };
    return this.generateContent(selectedStrategy, factView, evSet, options);
  }

  async generateContent(selectedStrategy, listingFactView, evidenceSet = { claims: [] }, options = {}) {
    if (!selectedStrategy || !selectedStrategy.strategy_id) {
      throw new Error("ContentGenerator: 必须提供有效的 selectedStrategy");
    }
    if (!listingFactView || !listingFactView.source_product_id) {
      throw new Error("ContentGenerator: 必须提供有效的 listingFactView");
    }

    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildUserPrompt(selectedStrategy, listingFactView);

    const context = {
      source_product_id: listingFactView.source_product_id,
      selected_strategy_id: selectedStrategy.strategy_id,
      options
    };

    // 1. 调用模型层
    const { rawOutput, parsedData, auditTrail } = await this.modelProvider.invoke({
      systemPrompt,
      prompt,
      context,
      responseSchema: "listing-content.schema.json"
    });

    if (!parsedData || typeof parsedData !== "object") {
      throw new Error(`ContentGenerator: 模型返回无效 JSON: ${rawOutput}`);
    }

    parsedData.source_product_id = listingFactView.source_product_id;
    parsedData.selected_strategy_id = selectedStrategy.strategy_id;

    // 2. Schema 严格校验
    const validation = validateData("listing-content.schema.json", parsedData);
    if (!validation.valid) {
      throw new Error(`ContentGenerator: 输出未通过 ListingContent Schema 校验: ${validation.formattedErrors}`);
    }

    // 3. ContentGuard 确定性安全与事实合规守卫
    ContentGuard.validateContent(parsedData, listingFactView, selectedStrategy, evidenceSet);

    return {
      listingContent: parsedData,
      auditTrail
    };
  }
}

export default ContentGenerator;
