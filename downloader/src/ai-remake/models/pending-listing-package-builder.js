import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { InvariantsGuard } from "../validators/invariants-guard.js";
import { computeCanonicalHash } from "../utils/hash-utils.js";
import { validateData } from "../validators/schema-validator.js";
import { FulfillmentStatus } from "../constants/enums.js";

export class PendingListingPackageBuilder {
  /**
   * 构造并封签待发布包 (PendingListingPackage)
   * 严格执行 不变量 6 (已批准 Revision)、不变量 2 (履约已就绪)、不变量 14 (审核快照哈希一致性)
   */
  static build({
    packageId,
    versionId,
    approvedRevision,
    sourceProduct,
    sellableOffer,
    productDNA,
    scorecard,
    selectedStrategy,
    listingContent,
    imagePlan,
    validationReport,
    evidenceSet,
    approvalSnapshot,
    assetRecords = []
  }) {
    if (!approvedRevision) {
      throw new Error("approvedRevision 不能为空");
    }
    if (!versionId) {
      throw new Error("versionId 不能为空");
    }

    // 1. 不变量 6: 正式版本只能从已 APPROVED 的 Revision 生成
    InvariantsGuard.assertVersionFromApprovedRevision(approvedRevision, versionId);

    // 2. 不变量 2: 履约准备度未达 READY 严禁出库
    InvariantsGuard.assertFulfillmentReadyForExport(sellableOffer, "READY_FOR_EXPORT");

    // 3. 计算即时核心哈希快照
    const currentHashes = {
      source_manifest_hash: sourceProduct.archive_manifest_hash,
      sellable_offer_hash: computeCanonicalHash(sellableOffer),
      product_dna_hash: computeCanonicalHash(productDNA),
      scorecard_hash: computeCanonicalHash(scorecard),
      selected_strategy_hash: computeCanonicalHash(selectedStrategy),
      listing_content_hash: computeCanonicalHash(listingContent),
      image_plan_hash: computeCanonicalHash(imagePlan),
      validation_report_hash: computeCanonicalHash(validationReport)
    };

    // 4. 不变量 14: TOCTOU 防护 - 批准快照哈希完整性比对
    InvariantsGuard.assertApprovalSnapshotIntegrity({
      approvalSnapshot,
      currentHashes
    });

    const pkgId = packageId || `pkg_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    // 5. 组装待发布包基础数据 (遵循 pending-listing-package.schema.json)
    const basePackage = {
      package_id: pkgId,
      version_id: versionId,
      approved_revision_id: approvedRevision.revision_id,
      source_product_id: sourceProduct.source_product_id,
      offer_id: sellableOffer.offer_id,
      source_manifest_hash: currentHashes.source_manifest_hash,
      sellable_offer_hash: currentHashes.sellable_offer_hash,
      selected_strategy_id: selectedStrategy.strategy_id,
      selected_strategy_hash: currentHashes.selected_strategy_hash,
      title: listingContent.title,
      description: listingContent.description,
      selling_points: listingContent.bullet_points,
      keywords: listingContent.keywords,
      cover_copy: listingContent.cover_copy,
      delivery_note: listingContent.delivery_note || "拍下自动发货或联系客服",
      listing_content: listingContent,
      image_plan: imagePlan,
      asset_refs: assetRecords.map(a => a.asset_id || a.file_name),
      claim_evidence_summary: {
        total_claims: evidenceSet?.claims?.length || 0,
        fact_claims_count: (evidenceSet?.claims || []).filter(c => c.claim_nature === "FACT").length,
        unverified_fact_count: 0
      },
      evidence_summary: {
        total_claims: evidenceSet?.claims?.length || 0,
        fact_claims_count: (evidenceSet?.claims || []).filter(c => c.claim_nature === "FACT").length,
        unverified_fact_count: 0
      },
      rights_summary: `可售物权利: ${sellableOffer.rights_status}; 关联资产: ${assetRecords.length} 项`,
      fulfillment_summary: `交付类型: ${sellableOffer.fulfillment_type}; 状态: ${sellableOffer.fulfillment_status}; 可交付已核验: ${sellableOffer.deliverable_verified}`,
      validation_report_hash: currentHashes.validation_report_hash,
      human_review: {
        decision: approvalSnapshot.decision || "APPROVE",
        reviewer: approvalSnapshot.reviewer,
        reviewed_at: approvalSnapshot.reviewed_at,
        notes: approvalSnapshot.notes || "人工审核通过并固化哈希快照",
        snapshot_hashes: approvalSnapshot.snapshot_hashes
      },
      approved_by: approvalSnapshot.reviewer,
      approved_at: approvalSnapshot.reviewed_at,
      fulfillment_status: sellableOffer.fulfillment_status || FulfillmentStatus.READY,
      package_status: "READY_FOR_EXPORT"
    };

    // 6. 计算不可篡改 Package Hash (基于未包含自身 package_hash 的完整数据)
    const packageHash = computeCanonicalHash(basePackage);
    const finalPackage = {
      ...basePackage,
      package_hash: packageHash
    };

    // 7. 严格 Schema 校验
    const validation = validateData("pending-listing-package.schema.json", finalPackage);
    if (!validation.valid) {
      throw new Error(`[PACKAGE_SCHEMA_VALIDATION_FAILED] 生成的待发布包未通过校验: ${validation.formattedErrors}`);
    }

    return finalPackage;
  }

  /**
   * 将待发布包物理持久化到独立隔离的“商品重制输出/”目录
   * 严格执行 不变量 1b (路径隔离保护) 与 不变量 16 (版本覆盖拦截)
   */
  static saveToDisk(packageData, targetDir, sourceRootPaths = []) {
    InvariantsGuard.assertSourcePathIsolated(targetDir, sourceRootPaths);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const packageFileName = `${packageData.package_id}_${packageData.version_id}.json`;
    const targetFilePath = path.join(targetDir, packageFileName);

    InvariantsGuard.assertVersionNotOverwritten(targetFilePath);

    fs.writeFileSync(targetFilePath, JSON.stringify(packageData, null, 2), "utf-8");
    return {
      filePath: targetFilePath,
      packageId: packageData.package_id,
      versionId: packageData.version_id,
      packageHash: packageData.package_hash
    };
  }

  /**
   * 标记版本过期 (STALE)
   */
  static markStale(packageData, reason = "SELLABLE_OFFER_CHANGED") {
    return {
      ...packageData,
      package_status: "STALE",
      stale_reason: reason
    };
  }
}

export default PendingListingPackageBuilder;