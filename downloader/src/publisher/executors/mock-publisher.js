import crypto from "node:crypto";
import { PublishConfig } from "../models/publish-config.js";
import { PublishReceipt } from "../models/publish-receipt.js";

/**
 * 模拟发布执行器 (MockPublisher)
 * 用于开发测试、网络异常与未决状态模拟
 */
export class MockPublisher {
  constructor(options = {}) {
    this.failureMode = options.failureMode || null; // null | "DETERMINISTIC_FAIL" | "TIMEOUT_UNKNOWN"
    this.failMessage = options.failMessage || "模拟闲管家网络超时";
  }

  async publish(adaptedPayload, publishMode = "DRAFT") {
    // 1. 模拟确定性失败
    if (this.failureMode === "DETERMINISTIC_FAIL") {
      return PublishReceipt.create({
        packageId: adaptedPayload.package_id,
        packageHash: adaptedPayload.raw_package_hash,
        versionId: adaptedPayload.version_id,
        outerId: adaptedPayload.outer_id,
        publishMode: publishMode,
        status: PublishConfig.STATUS.FAILED_CONFIRMED,
        errorMessage: this.failMessage
      });
    }

    // 2. 模拟网络超时/结果未知 (UNKNOWN / NEEDS_RECONCILIATION)
    if (this.failureMode === "TIMEOUT_UNKNOWN") {
      return PublishReceipt.create({
        packageId: adaptedPayload.package_id,
        packageHash: adaptedPayload.raw_package_hash,
        versionId: adaptedPayload.version_id,
        outerId: adaptedPayload.outer_id,
        publishMode: publishMode,
        status: PublishConfig.STATUS.UNKNOWN,
        needsReconciliation: true,
        errorMessage: "提交请求已发出但连接超时，尚未收到闲管家确认回执。已生成商家编码用于列表对账，禁止自动重试！"
      });
    }

    // 3. 正常成功
    const pseudoRandomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const isDraft = publishMode === "DRAFT";
    const status = isDraft ? PublishConfig.STATUS.DRAFT_SAVED : PublishConfig.STATUS.PUBLISHED_CONFIRMED;

    return PublishReceipt.create({
      packageId: adaptedPayload.package_id,
      packageHash: adaptedPayload.raw_package_hash,
      versionId: adaptedPayload.version_id,
      outerId: adaptedPayload.outer_id,
      publishMode: publishMode,
      status: status,
      platformItemId: !isDraft ? `xgj_item_${pseudoRandomId}` : null,
      platformDraftId: isDraft ? `xgj_draft_${pseudoRandomId}` : null,
      meta: {
        submitted_title: adaptedPayload.form_data.title,
        submitted_price: adaptedPayload.form_data.price,
        submitted_stock: adaptedPayload.form_data.stock,
        location: adaptedPayload.form_data.location,
        outer_id: adaptedPayload.outer_id,
        is_virtual: adaptedPayload.form_data.is_virtual
      }
    });
  }
}
