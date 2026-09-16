import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { WorkflowOrchestrator } from "../workflows/workflow-orchestrator.js";
import { PendingListingPackageBuilder } from "../models/pending-listing-package-builder.js";
import { InvariantsGuard } from "../validators/invariants-guard.js";
import { BaseModelProvider } from "../providers/model-provider.js";
import {
  WorkflowStatus,
  RecommendedAction,
  RightsStatus,
  FulfillmentStatus,
  StrategyChangeScope,
  AssetAllowedUsage,
  ImageAction,
  ClaimNature,
  EvidenceScope
} from "../constants/enums.js";

// Mock 模型提供者
class WorkflowMockModelProvider extends BaseModelProvider {
  constructor(callLog = []) {
    super({ modelId: "mock-workflow-provider-v1" });
    this.callLog = callLog;
  }

  async invoke({ systemPrompt, prompt, context, responseSchema }) {
    this.callLog.push({ responseSchema, context });

    if (responseSchema === "product-dna.schema.json") {
      const dna = {
        source_product_id: context.source_product_id || "prod_dji_001",
        product_type: "PHYSICAL_GOODS",
        product_category: "数码相机/手持云台",
        target_customer: "短视频摄影爱好者",
        customer_problem: "拍摄Vlog需要轻便防抖设备",
        purchase_motivation: "近乎全新性价比高",
        usage_scenario: "日常旅行出游记录",
        core_content: ["大疆Pocket3标准套机"],
        core_benefits: ["小巧便携三轴防抖"],
        selling_points: ["充新成色无暗病"],
        keywords: ["大疆", "Pocket3", "Vlog神器"],
        delivery_type: "MANUAL_SERVICE",
        risk_flags: [],
        unsupported_claims: [],
        missing_information: [],
        need_human_review: false
      };
      return {
        rawOutput: JSON.stringify(dna),
        parsedData: dna,
        auditTrail: this.createAuditTrail({
          promptVersion: "v1.0.0",
          schemaVersion: responseSchema,
          sourceManifestHash: "hash_dna",
          rawInput: { prompt },
          rawOutput: JSON.stringify(dna)
        })
      };
    }

    if (responseSchema === "remake-strategy.schema.json") {
      const strategies = [
        {
          strategy_id: "strat_dji_vlog",
          positioning: "高性价比准新旅拍神器",
          target_customer: "学生及旅拍新手",
          main_selling_angle: "原装盒说配件全，仅拆封无划痕立省400元",
          title_direction: "突出成色与即拍即发",
          content_direction: "详述配件无磨损细节",
          image_direction: "实拍特写与开机屏幕检测",
          price_strategy: { recommended_price: 2450, price_rationale: "紧贴市场均价促成快速出单" },
          why_this_strategy_is_plausible: "成色良好迎合初学者低成本体验需求",
          confidence_score: 0.9,
          strategy_change_scope: StrategyChangeScope.POSITIONING_ONLY,
          evidence_ids: ["clm_0001"]
        }
      ];
      return {
        rawOutput: JSON.stringify({ strategies }),
        parsedData: { strategies },
        auditTrail: this.createAuditTrail({
          promptVersion: "v1.0.0",
          schemaVersion: responseSchema,
          sourceManifestHash: "hash_strat",
          rawInput: { prompt },
          rawOutput: JSON.stringify({ strategies })
        })
      };
    }

    if (responseSchema === "listing-content.schema.json") {
      const content = {
        source_product_id: context.selected_strategy?.source_product_id || "prod_dji_001",
        selected_strategy_id: context.selected_strategy_id || "strat_dji_vlog",
        title: "【个人闲置】大疆DJI Pocket3 口袋云台相机 拆封未使用 深圳自提",
        description: "仅拆封测试，99新无磨损，大疆Osmo Pocket3主机与原装保护壳齐全。",
        bullet_points: ["99成新仅拆封", "深圳南山支持自提", "外地支持快递发货"],
        keywords: ["大疆Pocket3", "云台相机", "数码二手"],
        cover_copy: {
          headline: "准新大疆 Pocket 3",
          subheadline: "拆封未使用 深圳自提"
        },
        delivery_note: "拍下24小时内顺丰发出"
      };
      return {
        rawOutput: JSON.stringify(content),
        parsedData: content,
        auditTrail: this.createAuditTrail({
          promptVersion: "v1.0.0",
          schemaVersion: responseSchema,
          sourceManifestHash: "hash_content",
          rawInput: { prompt },
          rawOutput: JSON.stringify(content)
        })
      };
    }

    if (responseSchema === "image-plan.schema.json") {
      const plan = {
        source_product_id: "prod_dji_001",
        selected_strategy_id: "strat_dji_vlog",
        rights_status: RightsStatus.USER_OWNED,
        main_image: {
          action: ImageAction.CLEAN_ONLY,
          layout_description: "居中实拍特写",
          headline_text: "准新大疆 Pocket 3",
          subheadline_text: "拆封未使用 深圳自提"
        },
        detail_images: [
          {
            page_number: 1,
            action: ImageAction.CLEAN_ONLY,
            focus: "镜头镀膜特写",
            content_summary: "多角度展示完好细节"
          }
        ],
        visual_theme: {
          color_tone: "科技数码深空灰",
          style_name: "专业实拍风"
        }
      };
      return {
        rawOutput: JSON.stringify(plan),
        parsedData: plan,
        auditTrail: this.createAuditTrail({
          promptVersion: "v1.0.0",
          schemaVersion: responseSchema,
          sourceManifestHash: "hash_plan",
          rawInput: { prompt },
          rawOutput: JSON.stringify(plan)
        })
      };
    }

    throw new Error(`未知的 responseSchema: ${responseSchema}`);
  }
}

// 模拟测试数据
function createTestFixtures() {
  const sourceProduct = {
    source_product_id: "prod_dji_001",
    source_url: "https://www.goofish.com/item?id=1063279814277",
    source_title: "拆开了，大疆pocket3",
    source_description: "拆开了，算是没用过，大疆pocket3",
    source_images: [
      {
        position: 1,
        file_name: "01.webp",
        sha256: "8b2791a49e49acb434df98f1e80da986f034fbcd5cf3160caa0a0c3f08de33cb",
        width: 1440,
        height: 1920
      }
    ],
    source_price: { amount: 2500, currency: "CNY" },
    captured_at: "2026-09-13T13:41:33.018Z",
    archive_manifest_hash: "a".repeat(64)
  };

  const sellableOffer = {
    offer_id: "offer_pocket3_001",
    source_product_id: "prod_dji_001",
    actual_contents: [
      { item_name: "大疆Osmo Pocket3主机与原装保护壳", format: "实物顺丰包邮", count: 1 }
    ],
    fulfillment_type: "MANUAL_SERVICE",
    fulfillment_assets: [
      { asset_type: "LOCAL_ARCHIVE", location_reference: "仓库A区货架3" }
    ],
    rights_status: RightsStatus.USER_OWNED,
    quantity_verified: true,
    deliverable_verified: true,
    fulfillment_status: FulfillmentStatus.READY,
    human_confirmed: true
  };

  const assetRecords = [
    {
      asset_id: "ast_001",
      origin: "SOURCE_PRODUCT",
      rights_status: RightsStatus.USER_OWNED,
      allowed_usage: AssetAllowedUsage.DIRECT_USE,
      file_name: "01.webp",
      sha256: "8b2791a49e49acb434df98f1e80da986f034fbcd5cf3160caa0a0c3f08de33cb"
    }
  ];

  return { sourceProduct, sellableOffer, assetRecords };
}

test("P5.1 Workflow 全流程流转与人工选策略、终审出库闭环", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-test-workflow-"));
  const callLog = [];
  const modelProvider = new WorkflowMockModelProvider(callLog);
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();

  // 1. 创建 Job
  const jobInit = orchestrator.createJob({
    sourceProduct,
    sellableOffer,
    assetRecords
  });
  assert.equal(jobInit.status, WorkflowStatus.INPUT_CHECK);

  // 2. 初次执行：跑完 ANALYSIS, SCORING, STRATEGY，停在 STRATEGY_SELECTION (HUMAN_INPUT)
  const run1 = await orchestrator.execute(jobInit.jobId);
  assert.equal(run1.paused, true);
  assert.equal(run1.status, WorkflowStatus.HUMAN_INPUT);
  assert.match(run1.pauseReason, /AWAITING_HUMAN_STRATEGY_SELECTION/);

  // 3. 人工指定选定策略
  const run2 = await orchestrator.submitHumanInput(jobInit.jobId, {
    inputType: "STRATEGY_SELECTION",
    data: { selected_strategy_id: "strat_dji_vlog" },
    operator: "test_human_editor"
  });

  // 自动推进经 CONTENT_GENERATION, IMAGE_PLAN, VALIDATION，停在 HUMAN_REVIEW
  assert.equal(run2.paused, true);
  assert.equal(run2.status, WorkflowStatus.HUMAN_REVIEW);
  assert.ok(run2.artifacts.listingContent);
  assert.ok(run2.artifacts.imagePlan);
  assert.equal(run2.artifacts.validationReport.passed, true);

  // 4. 人工终审 APPROVE 并封签待发布包
  const approvalRes = await orchestrator.submitHumanReview(jobInit.jobId, {
    decision: "APPROVE",
    reviewer: "qa_director",
    notes: "全部要素合规真实，准予出库",
    versionId: "v1.0.0"
  });

  assert.equal(approvalRes.status, WorkflowStatus.APPROVED);
  assert.equal(approvalRes.versionId, "v1.0.0");
  assert.ok(approvalRes.package);
  assert.equal(approvalRes.package.package_status, "READY_FOR_EXPORT");
  assert.ok(fs.existsSync(approvalRes.packagePath));

  // 验证 NodeExecutionReceipt 完整性
  const status = orchestrator.getJobStatus(jobInit.jobId);
  assert.equal(status.currentStatus, WorkflowStatus.APPROVED);
  assert.ok(status.receiptsCount >= 5, "必须有完整的各节点执行凭据");

  // 清理临时目录
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("P5.2 幂等性执行验证 - 相同输入完全命中缓存，0 额外模型调用", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-idempotence-"));
  const callLog = [];
  const modelProvider = new WorkflowMockModelProvider(callLog);
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();
  const jobInit = orchestrator.createJob({ sourceProduct, sellableOffer, assetRecords });

  // 第一次执行至 STRATEGY_SELECTION
  await orchestrator.execute(jobInit.jobId);
  const callsAfterRun1 = callLog.length;
  assert.ok(callsAfterRun1 > 0);

  // 再次重复调用 execute
  await orchestrator.execute(jobInit.jobId);
  const callsAfterRun2 = callLog.length;

  // 幂等断言：模型调用次数完全未增加
  assert.equal(callsAfterRun2, callsAfterRun1, "输入未变时必须完全命中节点执行凭据缓存");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("P5.3 断点恢复机制 - 中断退出后无缝续跑", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-resume-"));
  const callLog = [];
  const modelProvider = new WorkflowMockModelProvider(callLog);
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();
  const jobInit = orchestrator.createJob({ sourceProduct, sellableOffer, assetRecords });

  // 跑到策略选择并人工选定策略
  await orchestrator.execute(jobInit.jobId);
  await orchestrator.submitHumanInput(jobInit.jobId, {
    inputType: "STRATEGY_SELECTION",
    data: { selected_strategy_id: "strat_dji_vlog" },
    operator: "tester"
  });

  // 模拟程序在 HUMAN_REVIEW 状态下意外关闭，重新实例化 Orchestrator
  const recoveredOrchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const resumed = await recoveredOrchestrator.resume(jobInit.jobId);
  assert.equal(resumed.status, WorkflowStatus.HUMAN_REVIEW);
  assert.ok(resumed.artifacts.listingContent);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("P5.4 不变量 14: Approval Snapshot Integrity (TOCTOU 防护) - 审核后篡改直接作废批准", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-toctou-"));
  const modelProvider = new WorkflowMockModelProvider();
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();
  const jobInit = orchestrator.createJob({ sourceProduct, sellableOffer, assetRecords });

  await orchestrator.execute(jobInit.jobId);
  await orchestrator.submitHumanInput(jobInit.jobId, {
    inputType: "STRATEGY_SELECTION",
    data: { selected_strategy_id: "strat_dji_vlog" }
  });

  // 人工 APPROVE 成功生成版本
  const approvalRes = await orchestrator.submitHumanReview(jobInit.jobId, {
    decision: "APPROVE",
    reviewer: "lead_auditor",
    versionId: "v1.0.0"
  });
  assert.equal(approvalRes.status, WorkflowStatus.APPROVED);

  // 模拟黑客或异常进程偷偷修改了 sellable_offer.json（由1件改成2件）
  const revDir = path.join(tempDir, jobInit.jobId, "revisions", jobInit.revisionId);
  const offer = JSON.parse(fs.readFileSync(path.join(revDir, "sellable_offer.json"), "utf-8"));
  offer.actual_contents[0].count = 2; // 篡改事实！
  fs.writeFileSync(path.join(revDir, "sellable_offer.json"), JSON.stringify(offer, null, 2), "utf-8");

  // 尝试使用被篡改的数据重新打包出库
  const rev = JSON.parse(fs.readFileSync(path.join(revDir, "revision.json"), "utf-8"));
  const snap = JSON.parse(fs.readFileSync(path.join(revDir, "approval_snapshot.json"), "utf-8"));
  const dna = JSON.parse(fs.readFileSync(path.join(revDir, "product_dna.json"), "utf-8"));
  const card = JSON.parse(fs.readFileSync(path.join(revDir, "scorecard.json"), "utf-8"));
  const strats = JSON.parse(fs.readFileSync(path.join(revDir, "strategies.json"), "utf-8"));
  const content = JSON.parse(fs.readFileSync(path.join(revDir, "listing_content.json"), "utf-8"));
  const plan = JSON.parse(fs.readFileSync(path.join(revDir, "image_plan.json"), "utf-8"));
  const report = JSON.parse(fs.readFileSync(path.join(revDir, "validation_report.json"), "utf-8"));
  const ev = JSON.parse(fs.readFileSync(path.join(revDir, "evidence.json"), "utf-8"));

  assert.throws(
    () => {
      PendingListingPackageBuilder.build({
        versionId: "v1.0.1",
        approvedRevision: rev,
        sourceProduct,
        sellableOffer: offer, // 传入篡改后的 offer
        productDNA: dna,
        scorecard: card,
        selectedStrategy: strats[0],
        listingContent: content,
        imagePlan: plan,
        validationReport: report,
        evidenceSet: ev,
        approvalSnapshot: snap,
        assetRecords
      });
    },
    /APPROVAL_SNAPSHOT_HASH_MISMATCH/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("P5.5 DROP 决策流转与人工驳回/新建修订分支 (DROP & Revision Branching)", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-drop-"));
  const modelProvider = new WorkflowMockModelProvider();
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();
  // 注入致命合规风险触发 DROP
  sellableOffer.rights_status = RightsStatus.NOT_AUTHORIZED;

  const jobInit = orchestrator.createJob({ sourceProduct, sellableOffer, assetRecords });
  const run1 = await orchestrator.execute(jobInit.jobId);

  // 验证 DROP 自动流转至 HUMAN_REVIEW，暂停执行后续营销文案生成
  assert.equal(run1.status, WorkflowStatus.HUMAN_REVIEW);
  assert.equal(run1.scorecard.recommended_action, RecommendedAction.DROP);

  // 人工决策：申请修订并补充合法授权
  const revisionRes = await orchestrator.submitHumanReview(jobInit.jobId, {
    decision: "REQUEST_REVISION",
    reviewer: "compliance_officer",
    notes: "版权未授权导致DROP，需提供授权证明"
  });

  assert.equal(revisionRes.status, WorkflowStatus.PRODUCT_ANALYSIS);
  assert.notEqual(revisionRes.newRevisionId, jobInit.revisionId);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("P5.6 STALE 状态处理与版本覆盖拦截 (Anti-Stale & Version Immutability)", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "p5-stale-"));
  const modelProvider = new WorkflowMockModelProvider();
  const orchestrator = new WorkflowOrchestrator({
    workspaceRoot: tempDir,
    modelProvider
  });

  const { sourceProduct, sellableOffer, assetRecords } = createTestFixtures();
  const jobInit = orchestrator.createJob({ sourceProduct, sellableOffer, assetRecords });
  await orchestrator.execute(jobInit.jobId);
  await orchestrator.submitHumanInput(jobInit.jobId, {
    inputType: "STRATEGY_SELECTION",
    data: { selected_strategy_id: "strat_dji_vlog" }
  });
  const approved = await orchestrator.submitHumanReview(jobInit.jobId, {
    decision: "APPROVE",
    reviewer: "admin",
    versionId: "v1.0.0"
  });

  // 1. 尝试覆盖已存在版本文件 -> 不变量 16 拦截
  assert.throws(
    () => {
      InvariantsGuard.assertVersionNotOverwritten(approved.packagePath);
    },
    /VERSION_ALREADY_EXISTS/
  );

  // 2. 将此版本标记为 STALE
  const staleRes = orchestrator.markVersionStale(jobInit.jobId, "v1.0.0", {
    reason: "SELLABLE_OFFER_CHANGED"
  });
  assert.equal(staleRes.status, "STALE");

  const stalePkg = JSON.parse(fs.readFileSync(approved.packagePath, "utf-8"));
  assert.equal(stalePkg.package_status, "STALE");

  // 3. 不变量 15 守卫：STALE 包禁止导出发布
  assert.throws(
    () => {
      InvariantsGuard.assertPackageNotStale(stalePkg);
    },
    /STALE_VERSION_EXPORT_PROHIBITED/
  );

  fs.rmSync(tempDir, { recursive: true, force: true });
});
