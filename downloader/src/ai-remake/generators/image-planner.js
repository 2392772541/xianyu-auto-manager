import { ImageAction, AssetAllowedUsage, RightsStatus } from "../constants/enums.js";
import { validateData } from "../validators/schema-validator.js";
import { InvariantsGuard } from "../validators/invariants-guard.js";

/**
 * ImagePlanner - 图片视觉规划器 (出方案不作图)
 * 遵循 P4 终审准则：
 * 1. 紧密对齐选定策略的视觉调性指导；
 * 2. 严格执行资产级权利门禁 (Asset-level Rights Gate)；
 * 3. REFERENCE_ONLY 素材严禁直接沿用 (KEEP)，必须规划为 REBUILD 重制；
 * 4. 输出首图版式规划与 1~8 张详情页分解方案，并受 image-plan.schema.json 约束。
 */
export class ImagePlanner {
  constructor(modelProvider, options = {}) {
    if (!modelProvider) {
      throw new Error("ImagePlanner: 必须注入 ModelProvider 实例");
    }
    this.modelProvider = modelProvider;
    this.promptVersion = options.promptVersion || "v1.0.0";
    this.schemaVersion = "image-plan.schema.json#v1.0.0";
  }

  buildSystemPrompt() {
    return `你是一个资深的电商图片视觉策划师。
你的唯一任务是输出精准、专业的商品图片制作【方案规划图纸】（出方案不作图），明确每一张图片的视觉目标、版式构图、核心文案与重制动作。

【权利门禁硬约束】
1. 素材级权利准则：
   - DIRECT_USE 允许 KEEP (原样沿用) 或 OPTIMIZE (润色调优)；
   - EDIT_ALLOWED 允许 OPTIMIZE 或 REBUILD (重新制作)；
   - REFERENCE_ONLY (同行原图且无授权) 绝对禁止 KEEP，动作必须为 REBUILD 或从零规划！
   - PROHIBITED 绝对禁止在方案中使用。
2. 首图必须具备强视觉冲击力与核心卖点直击；
3. 详情页图片必须结构化递进：规格细节、品质证明、使用场景、交付说明。

【输出结构】
输出符合 ImagePlan Schema 的 JSON 对象：
- source_product_id: 字符串
- selected_strategy_id: 字符串
- rights_status: 全局权利状态
- main_image: { action, layout_description, headline_text, subheadline_text, source_image_ref, rebuild_prompt, asset_id, allowed_usage, claim_ids }
- detail_images: 1~8 张图规划列表，每张包含 { page_number, action, focus, content_summary, source_image_ref, rebuild_prompt, asset_id, allowed_usage, claim_ids }
- visual_theme: { color_tone, style_name }`;
  }

  buildUserPrompt(selectedStrategy, sellableOffer, listingContent, assetRecords = []) {
    const assetsDesc = assetRecords.map(a =>
      `- 资产ID: ${a.asset_id}, 文件: ${a.file_name}, 权利状态: ${a.rights_status}, 允许用途: ${a.allowed_usage}`
    ).join("\n");

    return `请为以下商品制定图片方案：

【商品ID】: ${sellableOffer.source_product_id}
【选定策略】: ${selectedStrategy.strategy_id} - ${selectedStrategy.positioning}
【视觉调性要求】: ${selectedStrategy.image_direction}
【文案信息】:
- 标题: ${listingContent.title}
- 封面文案: ${listingContent.cover_copy?.headline} / ${listingContent.cover_copy?.subheadline}
- 交付说明: ${listingContent.delivery_note}

【现有素材资产及使用权】:
${assetsDesc || "无可用原始图片资产，必须从零 REBUILD 制作"}

请制定出严格遵守素材权利限制的图片方案。`;
  }

  /**
   * 生成图片规划方案
   * @param {object} selectedStrategy
   * @param {object} sellableOffer
   * @param {object} listingContent
   * @param {Array<object>} assetRecords
   * @param {object} [options]
   * @returns {Promise<{ imagePlan: object, auditTrail: object }>}
   */
  async planImages(selectedStrategy, sellableOffer, listingContent, assetRecords = [], options = {}) {
    const systemPrompt = this.buildSystemPrompt();
    const prompt = this.buildUserPrompt(selectedStrategy, sellableOffer, listingContent, assetRecords);

    const context = {
      source_product_id: sellableOffer.source_product_id,
      selected_strategy_id: selectedStrategy.strategy_id,
      options
    };

    const { rawOutput, parsedData, auditTrail } = await this.modelProvider.invoke({
      systemPrompt,
      prompt,
      context,
      responseSchema: "image-plan.schema.json"
    });

    if (!parsedData || typeof parsedData !== "object") {
      throw new Error(`ImagePlanner: 模型返回无效 JSON: ${rawOutput}`);
    }

    parsedData.source_product_id = sellableOffer.source_product_id;
    parsedData.selected_strategy_id = selectedStrategy.strategy_id;
    parsedData.rights_status = sellableOffer.rights_status || RightsStatus.UNKNOWN;

    // 1. Schema 校验
    const validation = validateData("image-plan.schema.json", parsedData);
    if (!validation.valid) {
      throw new Error(`ImagePlanner: 输出未通过 ImagePlan Schema 校验: ${validation.formattedErrors}`);
    }

    // 2. 素材级权利与用途校验 (Asset-level Rights Check)
    this._assertAssetRightsCompliant(parsedData, assetRecords);

    // 3. 全局不变量 3 守卫
    InvariantsGuard.assertImageRightsCompliant(sellableOffer.rights_status, parsedData);

    return {
      imagePlan: parsedData,
      auditTrail
    };
  }

  /**
   * 检查每个图片规划动作是否突破了对应素材的 allowed_usage
   */
  _assertAssetRightsCompliant(imagePlan, assetRecords) {
    const assetMap = new Map(assetRecords.map(a => [a.asset_id || a.file_name, a]));

    const checkImage = (img, label) => {
      const asset = assetMap.get(img.asset_id) || assetMap.get(img.source_image_ref);
      if (asset) {
        if (asset.allowed_usage === AssetAllowedUsage.REFERENCE_ONLY && img.action === ImageAction.KEEP) {
          throw new Error(`[${label}] 素材 ${asset.asset_id} 为 REFERENCE_ONLY（仅供构图参考），严禁使用 KEEP 原样沿用动作，必须使用 REBUILD 重制方案！`);
        }
        if (asset.allowed_usage === AssetAllowedUsage.PROHIBITED) {
          throw new Error(`[${label}] 素材 ${asset.asset_id} 为 PROHIBITED（严禁使用），不能出现在图片方案中！`);
        }
      }
    };

    if (imagePlan.main_image) {
      checkImage(imagePlan.main_image, "主图");
    }

    if (Array.isArray(imagePlan.detail_images)) {
      imagePlan.detail_images.forEach(detail => {
        checkImage(detail, `详情图第 ${detail.page_number} 张`);
      });
    }
  }
}

export default ImagePlanner;
