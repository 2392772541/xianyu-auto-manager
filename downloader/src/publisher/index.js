import path from "node:path";
import { PublishPreflightGuard } from "./validators/publish-preflight-guard.js";
import { XianguanjiaPayloadAdapter } from "./adapters/xianguanjia-payload-adapter.js";
import { PublishReceipt } from "./models/publish-receipt.js";
import { MockPublisher } from "./executors/mock-publisher.js";
import { BrowserPublisher } from "./executors/browser-publisher.js";
import { PublishConfig } from "./models/publish-config.js";

/**
 * 闲鱼自动铺货发布协调器 (PublishCoordinator)
 * 职责：作为商品发布执行层的顶层门面，编排前置门禁、表单适配、发布执行与不可变账本留档
 */
export class PublishCoordinator {
  constructor(options = {}) {
    this.ledgerPath = options.ledgerPath || PublishConfig.DEFAULT_LEDGER_PATH;
    this.executor = options.executor || new MockPublisher();
    this.defaultMode = options.defaultMode || PublishConfig.DEFAULT_PUBLISH_MODE;
  }

  /**
   * 发布单个 PendingListingPackage
   */
  async publishPackage(pkg, options = {}) {
    // 1. 前置守卫校验（拦截 STALE、DROP、缺失字段、标题超长、发货地缺失等）
    PublishPreflightGuard.validatePackage(pkg, options);

    // 2. 幂等性与未决对账检查（读取本地账本，防止线上重复发布或对账中断）
    const ledger = PublishReceipt.loadLedger(this.ledgerPath);
    const mode = options.publishMode || this.defaultMode;
    PublishPreflightGuard.assertNotDuplicatePublish(pkg, ledger, {
      allowDraftRepeat: options.allowDraftRepeat ?? true
    });

    // 3. 表单规范适配（保持原汁原味标题、规范详情排版、挂载发货地与 outer_id）
    const adaptedPayload = XianguanjiaPayloadAdapter.adapt(pkg, options);

    // 4. 执行发布（通过 Mock 或 Playwright 浏览器实例）
    let receipt;
    if (options.page && this.executor instanceof BrowserPublisher) {
      receipt = await this.executor.publishOnPage(options.page, adaptedPayload, mode);
    } else {
      receipt = await this.executor.publish(adaptedPayload, mode);
    }

    // 5. 写入不可变发布回执账本 (.jsonl)
    PublishReceipt.appendToLedger(receipt, this.ledgerPath);

    return {
      success: receipt.status === PublishConfig.STATUS.DRAFT_SAVED || receipt.status === PublishConfig.STATUS.PUBLISHED_CONFIRMED,
      status: receipt.status,
      receipt: receipt,
      adapted_payload: adaptedPayload
    };
  }
}

export {
  PublishPreflightGuard,
  XianguanjiaPayloadAdapter,
  PublishReceipt,
  MockPublisher,
  BrowserPublisher,
  PublishConfig
};
