import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PublishConfig } from "./publish-config.js";

/**
 * 发布回执与账本管理 (PublishReceipt)
 * 采用 .jsonl (JSON Lines) 格式原子追加保存，防止大文件全量重写损坏
 */
export class PublishReceipt {
  /**
   * 创建新回执
   */
  static create({
    packageId,
    packageHash,
    versionId,
    outerId = null,
    publishMode = PublishConfig.DEFAULT_PUBLISH_MODE,
    status = PublishConfig.STATUS.DRAFT_SAVED,
    platformItemId = null,
    platformDraftId = null,
    errorMessage = null,
    needsReconciliation = false,
    meta = {}
  }) {
    const receiptId = `rcpt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    return {
      receipt_id: receiptId,
      package_id: packageId,
      package_hash: packageHash,
      version_id: versionId,
      outer_id: outerId,
      platform: "XIANGUANJIA",
      publish_mode: publishMode,
      status: status,
      needs_reconciliation: needsReconciliation,
      platform_item_id: platformItemId,
      platform_draft_id: platformDraftId,
      error_message: errorMessage,
      published_at: new Date().toISOString(),
      meta: meta
    };
  }

  /**
   * 将回执追加写入本地账本文件 (publish_receipts.jsonl)
   */
  static appendToLedger(receipt, ledgerFilePath = PublishConfig.DEFAULT_LEDGER_PATH) {
    const resolvedPath = path.resolve(process.cwd(), ledgerFilePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const line = JSON.stringify(receipt) + "\n";
    fs.appendFileSync(resolvedPath, line, "utf8");
    return receipt;
  }

  /**
   * 读取账本 (支持 .jsonl 或旧版 .json 兼容)
   */
  static loadLedger(ledgerFilePath = PublishConfig.DEFAULT_LEDGER_PATH) {
    const resolvedPath = path.resolve(process.cwd(), ledgerFilePath);
    if (!fs.existsSync(resolvedPath)) return [];
    try {
      const content = fs.readFileSync(resolvedPath, "utf8").trim();
      if (!content) return [];
      
      if (resolvedPath.endsWith(".jsonl")) {
        return content.split("\n")
          .map(l => l.trim())
          .filter(Boolean)
          .map(l => {
            try { return JSON.parse(l); } catch { return null; }
          })
          .filter(Boolean);
      } else {
        const data = JSON.parse(content);
        return Array.isArray(data) ? data : [];
      }
    } catch {
      return [];
    }
  }
}
