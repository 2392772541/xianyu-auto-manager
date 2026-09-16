import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { adaptSourceProduct } from "../adapters/source-adapter.js";
import { SellableOfferManager } from "../models/sellable-offer-manager.js";
import { MockModelProvider } from "../providers/model-provider.js";
import { ProductAnalyst } from "../analyzers/product-analyst.js";
import { InvariantsGuard, InvariantViolationError } from "../validators/invariants-guard.js";
import { EvidenceValidator } from "../validators/evidence-validator.js";
import {
  RightsStatus,
  FulfillmentStatus,
  ClaimNature,
  EvidenceScope,
  DeliveryType
} from "../constants/enums.js";

// 真实样本路径
const SAMPLE_DJI_DIR = "商品素材/下载器/1063279814277-拆开了，算是没用过，大疆pocket3/2026-09-13T13-41-32-859Z-3067";
const SAMPLE_COURSE_DIR = "商品素材/1064285821878-162节审美课程";

test("P2.1 SellableOfferManager - 真实可售商品构造与反盲目复制守卫", () => {
  const { sourceProduct } = adaptSourceProduct(SAMPLE_DJI_DIR, { price: 2999 });

  // 1. 创建草稿：默认全部为未核验状态
  const draftOffer = SellableOfferManager.createDraftOffer(sourceProduct, {
    actual_contents: [
      { item_name: "大疆 Pocket 3 单机主机", format: "实体设备", count: 1, remarks: "自提验机" }
    ],
    fulfillment_type: DeliveryType.MANUAL_SERVICE
  });

  assert.equal(draftOffer.source_product_id, sourceProduct.source_product_id);
  assert.equal(draftOffer.fulfillment_status, FulfillmentStatus.NOT_CHECKED);
  assert.equal(draftOffer.quantity_verified, false);
  assert.equal(draftOffer.deliverable_verified, false);
  assert.equal(draftOffer.human_confirmed, false);

  // 2. 负面用例：系统或代码严禁在未人工确认时，直接把同行内容标为已核验或 READY
  assert.throws(() => {
    InvariantsGuard.assertSellableOfferNotBlindlyCopied(
      {
        ...draftOffer,
        deliverable_verified: true,
        human_confirmed: false
      },
      sourceProduct
    );
  }, /BLIND_OFFER_VERIFICATION_PROHIBITED/);

  // 3. 负面用例：未绑定资产时严禁声明 deliverable_verified=true
  assert.throws(() => {
    SellableOfferManager.verifyAndConfirm(draftOffer, sourceProduct, {
      deliverable_verified: true,
      quantity_verified: true
    });
  }, /DELIVERABLE_VERIFIED_WITHOUT_ASSETS/);

  // 4. 正确流程：绑定真实资产并人工确认 -> 流转至 READY
  SellableOfferManager.addFulfillmentAsset(draftOffer, {
    asset_type: "LOCAL_ARCHIVE",
    location_reference: "D:/仓库/实体数码/pocket3-01.jpg",
    checksum: "a1b2c3d4e5f6".repeat(5).slice(0, 64)
  });

  const readyOffer = SellableOfferManager.verifyAndConfirm(draftOffer, sourceProduct, {
    rights_status: RightsStatus.USER_OWNED,
    quantity_verified: true,
    deliverable_verified: true,
    confirmed_by: "auditor_zhang"
  });

  assert.equal(readyOffer.human_confirmed, true);
  assert.equal(readyOffer.fulfillment_status, FulfillmentStatus.READY);
  assert.equal(readyOffer.confirmed_by, "auditor_zhang");
  assert.ok(readyOffer.confirmed_at);
});

test("P2.2 ModelProvider - 不可变推理审计追踪与哈希快照", async () => {
  const { sourceProduct, manifest } = adaptSourceProduct(SAMPLE_COURSE_DIR);
  const provider = new MockModelProvider({ modelId: "deepseek-r1-mock", promptVersion: "v1.2.0" });

  const { auditTrail } = await provider.invoke({
    systemPrompt: "System instruction",
    prompt: "Analyze course",
    context: {
      sourceProduct,
      source_manifest_hash: manifest.manifestHash
    }
  });

  assert.equal(auditTrail.model_id, "deepseek-r1-mock");
  assert.equal(auditTrail.prompt_version, "v1.2.0");
  assert.equal(auditTrail.source_manifest_hash, manifest.manifestHash);
  assert.match(auditTrail.input_hash, /^[a-f0-9]{64}$/);
  assert.match(auditTrail.output_hash, /^[a-f0-9]{64}$/);
  assert.ok(auditTrail.duration_ms >= 0);
  assert.ok(auditTrail.timestamp);
});

test("P2.3 ProductAnalyst - 真实样本 A (大疆相机实体商品结构性推断)", async () => {
  const { sourceProduct } = adaptSourceProduct(SAMPLE_DJI_DIR, { price: 2999 });

  const mockProvider = new MockModelProvider();
  mockProvider.registerResponse(sourceProduct.source_product_id, {
    source_product_id: sourceProduct.source_product_id,
    product_type: "PHYSICAL_GOODS",
    product_category: "数码相机/云台相机",
    target_customer: "Vlog创作者、短视频博主、日常记录者",
    customer_problem: "手机拍摄不稳定，传统相机笨重难携带",
    purchase_motivation: "低价淘二手近全新设备，用于日常高画质防抖拍摄",
    usage_scenario: "个人Vlog、街头随拍、旅行记录、桌面直播",
    core_content: ["大疆pocket3"],
    core_benefits: ["便携防抖", "一英寸传感器", "旋转快启", "高性价比二手成色"],
    selling_points: ["拆开了，算是没用过", "深圳南山白石洲附近自提", "近全新成色"],
    keywords: ["大疆", "pocket3", "口袋相机", "云台相机", "自提"],
    delivery_type: "MANUAL_SERVICE",
    risk_flags: [
      {
        type: "INCOMPLETE_INFORMATION",
        severity: "MEDIUM",
        reason: "未详细说明是否包含续航手柄、三脚架、收纳包等全能套配件",
        remediation_suggestion: "建议在重制策略中明确以单机为准，或提醒买家私聊确认配件"
      }
    ],
    unsupported_claims: ["算是没用过（缺乏快门/通电时间客观佐证）"],
    missing_information: ["是否包含官方保修", "配件清单（手柄、保护壳、腕带等）", "发票及序列号"],
    need_human_review: true
  });

  const analyst = new ProductAnalyst(mockProvider);
  const { productDna, evidenceSet, auditTrail } = await analyst.analyze(sourceProduct);

  // 结构性断言
  assert.equal(productDna.product_type, "PHYSICAL_GOODS", "大疆相机必须识别为实体商品");
  assert.equal(productDna.delivery_type, "MANUAL_SERVICE", "自提商品交付方式必须识别为当面/人工服务");
  assert.ok(productDna.core_content.includes("大疆pocket3"));
  assert.ok(productDna.missing_information.length > 0, "必须记录配件缺失等未知信息，严禁脑补配件");
  assert.equal(productDna.need_human_review, true);

  // 证据链作用域断言：所有事实必须严格锁定为 REFERENCE_SOURCE
  assert.equal(evidenceSet.source_product_id, sourceProduct.source_product_id);
  assert.ok(evidenceSet.claims.length > 0);
  for (const claim of evidenceSet.claims) {
    assert.equal(
      claim.evidence_scope,
      EvidenceScope.REFERENCE_SOURCE,
      "同行提取事实其作用域严禁外溢为 SELLABLE_OFFER"
    );
  }
  assert.ok(auditTrail.input_hash);
});

test("P2.4 ProductAnalyst - 真实样本 B (162节审美课程虚拟商品结构性推断)", async () => {
  const { sourceProduct } = adaptSourceProduct(SAMPLE_COURSE_DIR);

  const mockProvider = new MockModelProvider();
  mockProvider.registerResponse(sourceProduct.source_product_id, {
    source_product_id: sourceProduct.source_product_id,
    product_type: "VIRTUAL_RESOURCE",
    product_category: "设计技能/审美培训课程",
    target_customer: "平面设计师、视觉工作者、美术爱好者、设计专业学生",
    customer_problem: "审美体系混乱，缺乏系统的视觉与排版鉴赏进阶课程",
    purchase_motivation: "系统化提升视觉品味与设计理论水平",
    usage_scenario: "业余碎片化自学、设计灵感充电、作品集排版提升",
    core_content: ["162节审美课程"],
    core_benefits: ["系统化知识体系", "162节超大容量", "永久回放学习"],
    selling_points: ["162节体系化审美大课", "网盘快速秒发", "即学即用"],
    keywords: ["审美课", "设计教程", "视觉进阶", "艺术鉴赏", "视频课程"],
    delivery_type: "NETDISK",
    risk_flags: [
      {
        type: "COPYRIGHT_OR_LICENSE",
        severity: "HIGH",
        reason: "涉及第三方知识付费录播课程，可能存在版权侵权投诉或下架风险",
        remediation_suggestion: "核实授权或仅作个人学习笔记重构，避免直接出现原机构商标"
      }
    ],
    unsupported_claims: ["同行宣称包含完整162节课，需核查实际网盘资源"],
    missing_information: ["主讲名师背景", "课程格式与清晰度", "附带练习素材/课件下载情况"],
    need_human_review: true
  });

  const analyst = new ProductAnalyst(mockProvider);
  const { productDna, evidenceSet } = await analyst.analyze(sourceProduct);

  assert.equal(productDna.product_type, "VIRTUAL_RESOURCE", "课程必须识别为虚拟资源");
  assert.equal(productDna.delivery_type, "NETDISK", "虚拟课程必须识别为网盘交付");
  assert.ok(productDna.core_content.includes("162节审美课程"));

  // 虚拟商品事实与交付物强隔离断言：
  // 同行声称“162节”仅为 REFERENCE_SOURCE 证据，我方必须经 SellableOffer 人工核验后才能转为我方事实
  const courseClaim = evidenceSet.claims.find(c => c.claim_text === "162节审美课程");
  assert.ok(courseClaim);
  assert.equal(courseClaim.claim_nature, ClaimNature.FACT);
  assert.equal(courseClaim.evidence_scope, EvidenceScope.REFERENCE_SOURCE);
});

test("P2.5 异常防御与安全阻断矩阵 (五大负面用例测试)", async () => {
  const { sourceProduct } = adaptSourceProduct(SAMPLE_DJI_DIR, { price: 2999 });

  // 防御 1: 模型输出 JSON 语法错误被拦截
  {
    const provider = new MockModelProvider();
    provider.setCorruptionMode("JSON_SYNTAX_ERROR");
    const analyst = new ProductAnalyst(provider);
    await assert.rejects(
      () => analyst.analyze(sourceProduct),
      /模型返回的不是有效的 JSON 对象/
    );
  }

  // 防御 2: 模型输出缺少必须字段（Schema 校验失败）被拦截
  {
    const provider = new MockModelProvider();
    provider.setCorruptionMode("SCHEMA_MISMATCH");
    const analyst = new ProductAnalyst(provider);
    await assert.rejects(
      () => analyst.analyze(sourceProduct),
      /ProductAnalyst 输出未通过 ProductDNA Schema 校验/
    );
  }

  // 防御 3: 虚构引用拦截 (Evidence 来源引用不在原文中)
  {
    const fakeEvidenceSet = {
      source_product_id: sourceProduct.source_product_id,
      claims: [
        {
          claim_id: "clm_fake_001",
          claim_text: "送512G闪迪高速内存卡与双电池",
          claim_nature: ClaimNature.FACT,
          evidence_scope: EvidenceScope.REFERENCE_SOURCE,
          sources: [
            {
              source_type: "SOURCE_DESCRIPTION",
              source_ref: "附赠512G内存卡" // 原始描述根本没有这段话
            }
          ],
          verification_status: "DIRECT_MATCH",
          confidence: 0.99
        }
      ]
    };

    const res = EvidenceValidator.validate(fakeEvidenceSet, sourceProduct);
    assert.equal(res.valid, false);
    assert.ok(res.violations.some(v => v.code === "PHANTOM_SOURCE_REFERENCE"));
  }

  // 防御 4: 同行事实直接升格为我方事实被拦截 (EVIDENCE_SCOPE_ESCALATION_PROHIBITED)
  {
    const escalatedClaim = {
      claim_id: "clm_escalated_001",
      claim_text: "拆开了，算是没用过，大疆pocket3",
      claim_nature: ClaimNature.FACT,
      evidence_scope: EvidenceScope.SELLABLE_OFFER, // 篡改为我方事实！
      sources: [
        {
          source_type: "SOURCE_DESCRIPTION",
          source_ref: "大疆pocket3"
        }
      ],
      verification_status: "DIRECT_MATCH",
      confidence: 0.95
    };

    assert.throws(() => {
      InvariantsGuard.assertEvidenceScopeIntegrity(escalatedClaim);
    }, /EVIDENCE_SCOPE_ESCALATION_PROHIBITED/);
  }

  // 防御 5: 物理路径越界拦截 (严禁向原始素材目录写入)
  {
    const forbiddenOutputPath = path.resolve(SAMPLE_DJI_DIR, "generated_file.txt");
    assert.throws(() => {
      InvariantsGuard.assertSourcePathIsolated(forbiddenOutputPath, [SAMPLE_DJI_DIR, "商品素材"]);
    }, /SOURCE_DIRECTORY_MUTATION_BREACH/);
  }
});
