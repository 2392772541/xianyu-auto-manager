import crypto from "node:crypto";

/**
 * 模型调用与审计跟踪基类 (BaseModelProvider)
 * 遵循不可变审计要求：每次推理必须完整沉淀 input_hash, output_hash, prompt_version 等元数据
 */
export class BaseModelProvider {
  constructor({ modelId = "mock-analyst-v1", promptVersion = "v1.0.0", schemaVersion = "v1.0.0" } = {}) {
    this.modelId = modelId;
    this.promptVersion = promptVersion;
    this.schemaVersion = schemaVersion;
  }

  /**
   * 计算 SHA-256 哈希
   */
  hashString(str) {
    return crypto.createHash("sha256").update(String(str || "")).digest("hex");
  }

  /**
   * 创建调用审计快照
   */
  createAuditTrail({ systemPrompt, prompt, context, rawOutput, startTime }) {
    const inputContent = JSON.stringify({
      system: systemPrompt,
      prompt,
      context
    });

    return {
      audit_id: `aud_${crypto.randomBytes(8).toString("hex")}`,
      model_id: this.modelId,
      prompt_version: this.promptVersion,
      schema_version: this.schemaVersion,
      source_manifest_hash: context?.source_manifest_hash || "manifest_not_provided",
      input_hash: this.hashString(inputContent),
      output_hash: this.hashString(rawOutput),
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startTime
    };
  }

  /**
   * 核心调用接口，子类必须实现
   * @param {object} params { systemPrompt, prompt, context, responseSchema }
   * @returns {Promise<{ rawOutput: string, parsedData: object, auditTrail: object }>}
   */
  async invoke(params) {
    throw new Error("BaseModelProvider.invoke 必须由具体子类实现");
  }
}

/**
 * 确定性 Mock 模型提供者 (MockModelProvider)
 * 用于高可靠单元测试、离线测试与五大负面用例拦截验证
 */
export class MockModelProvider extends BaseModelProvider {
  constructor(options = {}) {
    super(options);
    this.mockResponses = new Map();
    this.customHandler = null;
    this.corruptionMode = null;
  }

  /**
   * 注册指定商品 ID 或关键字的静态预设响应
   */
  registerResponse(key, responseObj) {
    this.mockResponses.set(key, responseObj);
  }

  /**
   * 设置动态推理拦截器
   */
  setHandler(handlerFn) {
    this.customHandler = handlerFn;
  }

  /**
   * 设置异常模拟模式：JSON_SYNTAX_ERROR, SCHEMA_MISMATCH, HALLUCINATION
   */
  setCorruptionMode(mode) {
    this.corruptionMode = mode;
  }

  async invoke({ systemPrompt, prompt, context, responseSchema }) {
    const startTime = Date.now();

    // 1. 模拟异常破坏模式
    if (this.corruptionMode === "JSON_SYNTAX_ERROR") {
      const rawOutput = "{ bad_json: undefined, missing_quote: ";
      const auditTrail = this.createAuditTrail({ systemPrompt, prompt, context, rawOutput, startTime });
      return { rawOutput, parsedData: null, auditTrail };
    }

    if (this.corruptionMode === "SCHEMA_MISMATCH") {
      const rawOutput = JSON.stringify({
        invalid_root_key: "this does not match product-dna schema"
      });
      const auditTrail = this.createAuditTrail({ systemPrompt, prompt, context, rawOutput, startTime });
      return { rawOutput, parsedData: JSON.parse(rawOutput), auditTrail };
    }

    // 2. 自定义 Handler 优先
    let outputData = null;
    if (typeof this.customHandler === "function") {
      outputData = await this.customHandler({ systemPrompt, prompt, context, responseSchema });
    } else {
      // 3. 基于 source_product_id 匹配
      const prodId = context?.sourceProduct?.source_product_id;
      if (prodId && this.mockResponses.has(prodId)) {
        outputData = this.mockResponses.get(prodId);
      } else {
        // 兜底默认结构
        outputData = {
          source_product_id: prodId || "prod_mock_default",
          product_type: "VIRTUAL_RESOURCE",
          product_category: "资料教程",
          target_customer: "自学群体",
          customer_problem: "缺乏系统资料",
          purchase_motivation: "快速获取现成素材",
          usage_scenario: "本地查看与学习",
          core_content: ["默认模拟学习文档"],
          core_benefits: ["现成即用", "整理归纳"],
          selling_points: ["即买即发", "内容完整"],
          keywords: ["教程", "资料", "自学"],
          delivery_type: "NETDISK",
          risk_flags: [],
          unsupported_claims: [],
          missing_information: [],
          need_human_review: false
        };
      }
    }

    const rawOutput = typeof outputData === "string" ? outputData : JSON.stringify(outputData, null, 2);
    const parsedData = typeof outputData === "string" ? JSON.parse(outputData) : outputData;
    const auditTrail = this.createAuditTrail({ systemPrompt, prompt, context, rawOutput, startTime });

    return {
      rawOutput,
      parsedData,
      auditTrail
    };
  }
}

export default {
  BaseModelProvider,
  MockModelProvider
};
