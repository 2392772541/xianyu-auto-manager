import path from "node:path";
import fs from "node:fs";
import {
  RightsStatus,
  FulfillmentStatus,
  ClaimNature,
  RecommendedAction,
  ImageAction,
  EvidenceScope
} from "../constants/enums.js";

export class InvariantViolationError extends Error {
  constructor(code, message) {
    super(`[INVARIANT_VIOLATION:${code}] ${message}`);
    this.name = "InvariantViolationError";
    this.code = code;
  }
}

/**
 * 核心不变量守卫 (Core Invariants Guard)
 * 遵循 P0-P5 阶段 Freeze Gate 要求
 */
export const InvariantsGuard = {
  /**
   * 1. 原始目录只读保护 - 拦截针对原始素材目录的写/删调用
   */
  assertSourceReadOnly(isWriteAttempt, targetPath = "") {
    if (isWriteAttempt) {
      throw new InvariantViolationError(
        "READONLY_SOURCE_MUTATION",
        `严禁对原始商品采集归档执行写/删操作：${targetPath}`
      );
    }
  },

  /**
   * 1b. 路径隔离保护 - 严禁将输出写入或直接覆盖原始素材目录
   */
  assertSourcePathIsolated(outputPath, sourceRootPaths = []) {
    if (!outputPath) return;
    const resolvedOut = path.resolve(outputPath);
    const roots = Array.isArray(sourceRootPaths) ? sourceRootPaths : [sourceRootPaths];
    for (const root of roots) {
      if (!root) continue;
      const resolvedRoot = path.resolve(root);
      if (resolvedOut === resolvedRoot || resolvedOut.startsWith(resolvedRoot + path.sep)) {
        throw new InvariantViolationError(
          "SOURCE_DIRECTORY_MUTATION_BREACH",
          `输出路径处于受保护的原始商品素材目录内部，已物理拦截：${resolvedOut}`
        );
      }
    }
  },

  /**
   * 2. 非 READY 履约状态严禁导出待发布包
   */
  assertFulfillmentReadyForExport(offer, packageStatus) {
    if (packageStatus === "READY_FOR_EXPORT") {
      if (!offer || offer.fulfillment_status !== FulfillmentStatus.READY) {
        throw new InvariantViolationError(
          "FULFILLMENT_NOT_READY",
          `履约准备度未达 READY（当前状态: ${offer?.fulfillment_status || "NULL"}），严禁出库为 READY_FOR_EXPORT`
        );
      }
      if (!offer.deliverable_verified || !offer.human_confirmed) {
        throw new InvariantViolationError(
          "DELIVERY_NOT_CONFIRMED",
          "履约资产尚未经过人工与可交付双重核验，严禁出库"
        );
      }
    }
  },

  /**
   * 3. 无合法版权状态的来源图严禁沿用 (KEEP)
   */
  assertImageRightsCompliant(rightsStatus, imagePlan) {
    const isRightsAuthorized =
      rightsStatus === RightsStatus.USER_OWNED || rightsStatus === RightsStatus.LICENSED;

    if (!isRightsAuthorized) {
      if (imagePlan.main_image?.action === ImageAction.KEEP) {
        throw new InvariantViolationError(
          "UNAUTHORIZED_IMAGE_KEEP",
          `素材版权状态为 ${rightsStatus}，严禁在主图使用 KEEP 动作，必须使用 REBUILD 或从零制作`
        );
      }
      if (Array.isArray(imagePlan.detail_images)) {
        for (const img of imagePlan.detail_images) {
          if (img.action === ImageAction.KEEP) {
            throw new InvariantViolationError(
              "UNAUTHORIZED_IMAGE_KEEP",
              `素材版权状态为 ${rightsStatus}，详情页第 ${img.page_number} 张严禁使用 KEEP 动作`
            );
          }
        }
      }
    }
  },

  /**
   * 4. FACT 事实声明无证据严禁出库或生成 Version
   */
  assertFactClaimsCovered(evidenceSet) {
    if (!evidenceSet || !Array.isArray(evidenceSet.claims)) {
      throw new InvariantViolationError("INVALID_EVIDENCE_SET", "证据链集合缺失或格式错误");
    }

    const unverifiedFacts = evidenceSet.claims.filter(
      c => c.claim_nature === ClaimNature.FACT &&
           (c.verification_status !== "DIRECT_MATCH" || !c.sources || c.sources.length === 0)
    );

    if (unverifiedFacts.length > 0) {
      const details = unverifiedFacts.map(f => `[${f.claim_id}] ${f.claim_text}`).join("; ");
      throw new InvariantViolationError(
        "UNVERIFIED_FACT_CLAIMS",
        `存在 ${unverifiedFacts.length} 项具体事实声明缺乏直接证据支撑，严禁批准正式版本：${details}`
      );
    }
  },

  /**
   * 4b. 证据链作用域与声明性质对应保护
   * 同行页面提取的声明其 EvidenceScope 严禁篡改为 SELLABLE_OFFER
   */
  assertEvidenceScopeIntegrity(claim) {
    if (!claim) return;
    const hasSourceProductOrigin = (claim.sources || []).some(s =>
      ["SOURCE_DESCRIPTION", "SOURCE_IMAGE", "SOURCE_TITLE"].includes(s.source_type)
    );
    const hasMyAssetOrigin = (claim.sources || []).some(s =>
      ["SELLABLE_OFFER_ASSET", "HUMAN_CONFIRMATION"].includes(s.source_type)
    );

    if (hasSourceProductOrigin && !hasMyAssetOrigin && claim.evidence_scope === EvidenceScope.SELLABLE_OFFER) {
      throw new InvariantViolationError(
        "EVIDENCE_SCOPE_ESCALATION_PROHIBITED",
        `声明 [${claim.claim_id}: "${claim.claim_text}"] 仅来源于同行商品页面，严禁擅自升级为 SELLABLE_OFFER（我方实际可售事实）！`
      );
    }
  },

  /**
   * 5. DROP 商品严禁流转至内容营销生成
   */
  assertNotDroppedForContentGen(scorecard) {
    if (!scorecard || scorecard.recommended_action === RecommendedAction.DROP) {
      throw new InvariantViolationError(
        "DROP_ACTION_BLOCKED",
        `商品已被评定为 DROP（放弃/淘汰），决策原因：${scorecard?.decision_reason || "未知"}，严禁触发后续营销文案生成`
      );
    }
  },

  /**
   * 6. 正式 Version 只能来源于已 APPROVED 的 Revision
   */
  assertVersionFromApprovedRevision(revision, targetVersionId) {
    if (!revision || revision.status !== "APPROVED") {
      throw new InvariantViolationError(
        "VERSION_FROM_UNAPPROVED_REVISION",
        `版本 ${targetVersionId} 只能从已审核批准（APPROVED）的草稿生成，当前 Revision 状态为：${revision?.status || "NULL"}`
      );
    }
  },

  /**
   * 7. 历史 Revision 只读不可变约束
   */
  assertRevisionImmutable(revision) {
    if (revision && revision.is_read_only) {
      return new Proxy(revision, {
        set(target, prop) {
          throw new InvariantViolationError(
            "IMMUTABLE_REVISION_MUTATION",
            `已锁定的历史 Revision (${target.revision_id}) 严禁原地修改属性 [${String(prop)}]，必须开启新 Revision 分支`
          );
        }
      });
    }
    return revision;
  },

  /**
   * 8. 禁止同行参考内容直接变成我方已核验实际可售商品 (Anti-Blind-Copy)
   */
  assertSellableOfferNotBlindlyCopied(offer, sourceProduct) {
    if (!offer || !sourceProduct) return;
    if (offer.source_product_id !== sourceProduct.source_product_id) {
      throw new InvariantViolationError(
        "OFFER_PRODUCT_ID_MISMATCH",
        `SellableOffer source_product_id (${offer.source_product_id}) 与 SourceProduct (${sourceProduct.source_product_id}) 不一致`
      );
    }

    // 若尚未人工确认，禁止声称为 READY 或已核验可交付
    if (!offer.human_confirmed && (offer.deliverable_verified || offer.fulfillment_status === FulfillmentStatus.READY)) {
      throw new InvariantViolationError(
        "BLIND_OFFER_VERIFICATION_PROHIBITED",
        "SellableOffer 严禁在未经过人工实测核验（human_confirmed=true）的情况下，直接被标记为 deliverable_verified=true 或 READY！"
      );
    }

    // 若声明了 READY，必须真实具备履约资产
    if (offer.fulfillment_status === FulfillmentStatus.READY && (!offer.fulfillment_assets || offer.fulfillment_assets.length === 0)) {
      throw new InvariantViolationError(
        "READY_OFFER_WITHOUT_ASSETS",
        "SellableOffer 已标为 READY，但未绑定任何实际履约资产 (fulfillment_assets 为空)"
      );
    }
  },

  /**
   * 14. 批准快照完整性守卫 (Approval Snapshot Integrity / Anti-TOCTOU)
   * 严禁在人工审核后发生任何事实/策略/方案篡改，任何关键哈希漂移均导致批准失效并拦截出库
   */
  assertApprovalSnapshotIntegrity({ approvalSnapshot, currentHashes }) {
    if (!approvalSnapshot || !approvalSnapshot.snapshot_hashes) {
      throw new InvariantViolationError(
        "APPROVAL_SNAPSHOT_MISSING",
        "人工审核快照不存在或缺失关键哈希表，严禁出库！"
      );
    }

    const requiredKeys = [
      "source_manifest_hash",
      "sellable_offer_hash",
      "product_dna_hash",
      "scorecard_hash",
      "selected_strategy_hash",
      "listing_content_hash",
      "image_plan_hash",
      "validation_report_hash"
    ];

    const snapshot = approvalSnapshot.snapshot_hashes;
    const mismatches = [];

    for (const key of requiredKeys) {
      const expected = snapshot[key];
      const actual = currentHashes?.[key];
      if (!expected || !actual || expected !== actual) {
        mismatches.push(`${key} (期望: ${expected || "NULL"}, 实际: ${actual || "NULL"})`);
      }
    }

    if (mismatches.length > 0) {
      throw new InvariantViolationError(
        "APPROVAL_SNAPSHOT_HASH_MISMATCH",
        `检测到审核后数据被篡改 (TOCTOU 违规)！以下哈希与批准快照不一致，批准已自动作废：${mismatches.join("; ")}`
      );
    }
  },

  /**
   * 15. 过期版本严禁发布/导出 (Anti-Stale Export)
   */
  assertPackageNotStale(packageData) {
    if (packageData?.package_status === "STALE") {
      throw new InvariantViolationError(
        "STALE_VERSION_EXPORT_PROHIBITED",
        `待发布包已失效/过期 (状态: STALE，原因: ${packageData.stale_reason || "未知"})，严禁导出或发布！`
      );
    }
  },

  /**
   * 16. 已发布版本文件严禁覆盖 (Immutable Version File)
   */
  assertVersionNotOverwritten(targetPath) {
    if (targetPath && fs.existsSync(targetPath)) {
      throw new InvariantViolationError(
        "VERSION_ALREADY_EXISTS",
        `已发布的正式版本文件严禁被原地覆盖：${targetPath}`
      );
    }
  }
};

export default InvariantsGuard;