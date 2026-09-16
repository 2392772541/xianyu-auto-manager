import crypto from "node:crypto";
import { PublishConfig } from "../models/publish-config.js";
import { PublishReceipt } from "../models/publish-receipt.js";

/**
 * 闲管家浏览器网页自动化执行器 (BrowserPublisher)
 * 使用 Playwright 页面实例，操作 goofish.pro 页面填报表单并安全存草稿
 */
export class BrowserPublisher {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
  }

  /**
   * 在给定的 Playwright Page 上填报并提交
   */
  async publishOnPage(page, adaptedPayload, publishMode = "DRAFT") {
    if (!page) {
      throw new Error("[BROWSER_PUBLISHER_ERROR] page 实例不能为空");
    }

    const formData = adaptedPayload.form_data;
    const outerId = adaptedPayload.outer_id;

    try {
      // 1. 填写标题 (闲管家标题输入框)
      const titleSelector = "input[placeholder*='标题'], input[name='title'], #product-title, .product-title-input input";
      await page.waitForSelector(titleSelector, { timeout: 10000 });
      await page.fill(titleSelector, formData.title);

      // 2. 填写商品详情描述
      const descSelector = "textarea[placeholder*='描述'], textarea[name='description'], #product-desc, .el-textarea__inner";
      if (await page.$(descSelector)) {
        await page.fill(descSelector, formData.description);
      }

      // 3. 填写售价
      const priceSelector = "input[placeholder*='价格'], input[name='price'], #product-price";
      if (await page.$(priceSelector)) {
        await page.fill(priceSelector, String(formData.price));
      }

      // 4. 显式填写库存 (防止继承上一次页面残留)
      const stockSelector = "input[placeholder*='库存'], input[name='stock'], #product-stock";
      if (await page.$(stockSelector)) {
        await page.fill(stockSelector, String(formData.stock));
      }

      // 5. 显式填写/重置发货地 (防止闲管家黏性记忆上一件商品的发货地)
      const locationSelector = "input[placeholder*='发货地'], input[name='location'], #product-location";
      if (await page.$(locationSelector)) {
        await page.fill(locationSelector, formData.location);
      }

      // 6. 填写商家编码 outer_id (用于闲管家商品列表管理与对账)
      const outerIdSelector = "input[placeholder*='商家编码'], input[name='outer_id'], #outer-id, input[placeholder*='货号']";
      if (await page.$(outerIdSelector)) {
        await page.fill(outerIdSelector, outerId);
      }

      // 7. 点击提交按钮 (存草稿 vs 立即发布)
      let submitButtonSelector = "";
      if (publishMode === "DRAFT") {
        submitButtonSelector = "button:has-text('存草稿'), button:has-text('保存为草稿'), .btn-save-draft";
      } else {
        submitButtonSelector = "button:has-text('立即发布'), button:has-text('确认上架'), .btn-publish-now";
      }

      const submitBtn = await page.$(submitButtonSelector);
      if (!submitBtn) {
        throw new Error(`[SELECTOR_NOT_FOUND] 未找到提交按钮: ${submitButtonSelector}`);
      }

      await submitBtn.click();

      // 8. 等待成功反馈与回执ID提取
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      const generatedId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      const status = publishMode === "DRAFT" ? PublishConfig.STATUS.DRAFT_SAVED : PublishConfig.STATUS.PUBLISHED_CONFIRMED;

      return PublishReceipt.create({
        packageId: adaptedPayload.package_id,
        packageHash: adaptedPayload.raw_package_hash,
        versionId: adaptedPayload.version_id,
        outerId: outerId,
        publishMode: publishMode,
        status: status,
        platformItemId: publishMode === "IMMEDIATE" ? `xgj_${generatedId}` : null,
        platformDraftId: publishMode === "DRAFT" ? `xgj_draft_${generatedId}` : null,
        meta: {
          submitted_title: formData.title,
          submitted_price: formData.price,
          location: formData.location,
          target_url: currentUrl
        }
      });
    } catch (err) {
      // 区分超时网络异常 (UNKNOWN) 与本地错误
      const isTimeout = err.message && (err.message.includes("timeout") || err.message.includes("Navigation") || err.message.includes("Target closed"));
      const status = isTimeout ? PublishConfig.STATUS.UNKNOWN : PublishConfig.STATUS.FAILED_CONFIRMED;

      return PublishReceipt.create({
        packageId: adaptedPayload.package_id,
        packageHash: adaptedPayload.raw_package_hash,
        versionId: adaptedPayload.version_id,
        outerId: outerId,
        publishMode: publishMode,
        status: status,
        needsReconciliation: isTimeout,
        errorMessage: err.message
      });
    }
  }
}
