import test from "node:test";
import assert from "node:assert/strict";
import { ListingFactView } from "../models/listing-fact-view.js";
import { AssetRightsManager } from "../models/asset-rights.js";
import { ContentGenerator } from "../generators/content-generator.js";
import { ContentGuard } from "../validators/content-guard.js";
import { ImagePlanner } from "../generators/image-planner.js";
import { CrossMediaConsistencyGuard } from "../validators/cross-media-consistency-guard.js";
import { BaseModelProvider } from "../providers/model-provider.js";
import {
  RightsStatus,
  FulfillmentStatus,
  StrategyChangeScope,
  AssetAllowedUsage,
  ImageAction,
  ClaimNature,
  EvidenceScope
} from "../constants/enums.js";

// 测试专用的 Mock 模型提供者
class ContentMockModelProvider extends BaseModelProvider {
  constructor(cannedResponses = {}) {
    super({ modelId: "test-content-mock-v1" });
    this.cannedResponses = cannedResponses;
  }

  async invoke({ systemPrompt, prompt, context, responseSchema }) {
    const key = context.selected_strategy_id || context.source_product_id;
    const response = this.cannedResponses[key] || this.cannedResponses["default"];
    if (!response) {
      throw new Error(`No canned response for key ${key}`);
    }

    const auditTrail = this.createAuditTrail({
      promptVersion: "v1.0.0",
      schemaVersion: responseSchema,
      sourceManifestHash: "mock_content_hash_123",
      rawInput: { systemPrompt, prompt },
      rawOutput: JSON.stringify(response),
      durationMs: 15
    });

    return {
      rawOutput: JSON.stringify(response),
      parsedData: JSON.parse(JSON.stringify(response)),
      auditTrail
    };
  }
}

// 真实样本 A (大疆 Pocket3)
const mockDjiOffer = {
  source_product_id: "prod_1063279814277",
  actual_contents: ["大疆 Osmo Pocket 3 单机版主机", "原装保护壳", "手绳"],
  fulfillment_type: "OTHER",
  fulfillment_assets: [{ type: "PHYSICAL_INVENTORY", location: "仓库A" }],
  rights_status: RightsStatus.USER_OWNED,
  quantity_verified: true,
  deliverable_verified: true,
  fulfillment_status: FulfillmentStatus.READY,
  human_confirmed: true
};

const mockDjiStrategy = {
  strategy_id: "strat_dji_vlog",
  positioning: "准新便携旅拍云台相机（学生党轻度尝鲜）",
  target_customer: "在校大学生、年轻情侣旅拍",
  main_selling_angle: "原装盒说配件全，仅拆封无划痕立省400元",
  title_direction: "【个人闲置】大疆Pocket3 拆封未使用 深圳自提",
  content_direction: "重点突出成色如新、配件无磨损、支持验机保障",
  image_direction: "第一张首图凸显开机屏幕亮屏实拍与保护壳完整度",
  price_strategy: { recommended_price: 2499, price_rationale: "紧贴市场准新流通价下沿快速出单" },
  why_this_strategy_is_plausible: "原机成色99新且附件完整，迎合初学者低成本体验大疆旗舰防抖的需求",
  confidence_score: 0.92,
  strategy_change_scope: StrategyChangeScope.AUDIENCE_REFRAME,
  evidence_ids: ["clm_0001"]
};

// 真实样本 B (162节审美课程)
const mockCourseOffer = {
  source_product_id: "prod_1064285821878",
  actual_contents: ["设计审美体系视频全集(实测162节无损MP4)", "高清课件图解包"],
  fulfillment_type: "NETDISK",
  fulfillment_assets: [{ type: "NETDISK_SHARE", url: "https://pan.baidu.com/s/xxxx" }],
  rights_status: RightsStatus.LICENSED,
  quantity_verified: true,
  deliverable_verified: true,
  fulfillment_status: FulfillmentStatus.READY,
  human_confirmed: true
};

const mockCourseStrategy = {
  strategy_id: "strat_course_beginner",
  positioning: "零基础视觉审美提升急救包",
  target_customer: "非设计专业职场人、PPT制作者、自媒体图文作者",
  main_selling_angle: "告别土气排版与配色，162节讲透视觉底层逻辑",
  title_direction: "设计审美提升课162节｜配色排版视觉设计实用指南 百度网盘",
  content_direction: "强调通俗易懂、每天15分钟、手机随时看",
  image_direction: "高级莫兰迪配色卡、排版前后对比图",
  price_strategy: { recommended_price: 9.9, price_rationale: "低门槛知识付费冲量" },
  why_this_strategy_is_plausible: "小白用户痛点集中在不会配色排版，低价课能极大降低决策成本",
  confidence_score: 0.90,
  strategy_change_scope: StrategyChangeScope.MESSAGING_ONLY,
  evidence_ids: ["clm_0001"]
};

test("P4.0 ListingFactView - 准确构建可发布事实视图，隔离同行参考事实", () => {
  const mockEvidenceSet = {
    claims: [
      {
        claim_id: "clm_0001",
        claim_text: "设计审美体系视频全集(实测162节无损MP4)",
        claim_nature: ClaimNature.FACT,
        evidence_scope: EvidenceScope.SELLABLE_OFFER,
        verification_status: "DIRECT_MATCH"
      },
      {
        claim_id: "clm_0002",
        claim_text: "同行声称赠送终身学习社群",
        claim_nature: ClaimNature.FACT,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE, // 仅同行声称
        verification_status: "DIRECT_MATCH"
      }
    ]
  };

  const factView = ListingFactView.from(mockCourseOffer, mockEvidenceSet, {
    target_customer: "零基础学员",
    keywords: ["审美课", "设计教程"]
  });

  assert.equal(factView.source_product_id, "prod_1064285821878");
  assert.equal(factView.verified_facts.length, 1);
  assert.equal(factView.isFactPublishable("162节"), true);
  assert.equal(factView.isFactPublishable("终身学习社群"), false);
});

test("P4.2 ContentGenerator - 实体相机正常生成候选文案并通过校验", async () => {
  const cannedDjiContent = {
    source_product_id: "prod_1063279814277",
    selected_strategy_id: "strat_dji_vlog",
    title: "【个人闲置】大疆DJI Pocket3 拆封未使用 深圳自提可邮寄",
    description: "自用闲置出，成色非常新仅拆封测试，机身无任何划痕暗病。深圳南山白石洲附近支持自提当面看，外地可走快递发货。感兴趣可直接拍。",
    bullet_points: [
      "仅拆封测试成色99新",
      "拆封未使用个人闲置",
      "深圳支持自提外地可寄"
    ],
    keywords: ["大疆Pocket3", "云台相机", "旅拍Vlog", "便携数码"],
    cover_copy: {
      headline: "个人闲置 Pocket3",
      subheadline: "仅拆封测试配件齐全",
      tag: "深圳自提"
    },
    delivery_note: "深圳南山支持自提，外地快递发货",
    claim_ids: ["clm_0001"]
  };

  const provider = new ContentMockModelProvider({
    "strat_dji_vlog": cannedDjiContent
  });
  const generator = new ContentGenerator(provider);
  const factView = ListingFactView.from(mockDjiOffer, { claims: [] });

  const { listingContent, auditTrail } = await generator.generateContent(
    mockDjiStrategy,
    factView
  );

  assert.equal(listingContent.selected_strategy_id, "strat_dji_vlog");
  assert.equal(listingContent.title.includes("Pocket3"), true);
  assert.ok(auditTrail.output_hash);
});

test("P4.3 ContentGuard - 拦截擅自增造未核验交付物 (送源码/一对一)", () => {
  const badContent = {
    source_product_id: "prod_1064285821878",
    selected_strategy_id: "strat_course_beginner",
    title: "设计审美提升课162节 赠送源码与社群答疑", // 擅自承诺送源码、社群答疑
    description: "课程通俗易懂，下单即送源码并享受一对一指导，快来购买！",
    bullet_points: ["162节系统课", "附送模板与代码", "享受终身售后"],
    keywords: ["设计课", "审美", "网盘"],
    cover_copy: { headline: "审美提升课", subheadline: "拍下送源码" },
    delivery_note: "网盘秒发"
  };

  const factView = ListingFactView.from(mockCourseOffer, { claims: [] });

  assert.throws(
    () => {
      ContentGuard.validateContent(badContent, factView, mockCourseStrategy);
    },
    /UNAUTHORIZED_DELIVERABLE_INVENTION/
  );
});

test("P4.3 ContentGuard - 不变量 12 与防洗白: 拦截未核验数量事实 (162节 vs 120节)", () => {
  // 假定我方实际可售商品只有 120 节课程
  const smallOffer = {
    ...mockCourseOffer,
    actual_contents: ["设计审美课程精选集(实测120节)"] // 实际只有120节
  };
  const factView = ListingFactView.from(smallOffer, { claims: [] });

  // 文案依然按同行原样吹嘘为 "162节"
  const launderedContent = {
    source_product_id: "prod_1064285821878",
    selected_strategy_id: "strat_course_beginner",
    title: "设计审美提升课162节 高清视频教程百度网盘", // 数量越界
    description: "包含162节精讲课程，全面提升设计水平与艺术审美构图。",
    bullet_points: ["162节课时", "百度网盘发货", "零基础学习"],
    keywords: ["审美课", "设计"],
    cover_copy: { headline: "设计审美课", subheadline: "162节完整版" },
    delivery_note: "拍下后发网盘链接"
  };

  assert.throws(
    () => {
      ContentGuard.validateContent(launderedContent, factView, mockCourseStrategy);
    },
    /UNVERIFIED_QUANTITY_FACT_BREACH/
  );
});

test("P4.4 AssetRightsManager 与 P4.5 ImagePlanner - 资产级权利门禁与图片规划", async () => {
  // 模拟一组素材：一张是自己制作已授权，另一张是同行原图 REFERENCE_ONLY
  const assetRecords = [
    AssetRightsManager.createAssetRecord({
      asset_id: "ast_001",
      rights_status: RightsStatus.LICENSED,
      allowed_usage: AssetAllowedUsage.DIRECT_USE,
      file_name: "实拍主图.jpg"
    }),
    AssetRightsManager.createAssetRecord({
      asset_id: "ast_002",
      rights_status: RightsStatus.UNKNOWN,
      allowed_usage: AssetAllowedUsage.REFERENCE_ONLY,
      file_name: "同行详情截图.jpg"
    })
  ];

  // 1. 合法图片规划方案：同行原图使用 REBUILD
  const validPlanData = {
    source_product_id: "prod_1063279814277",
    selected_strategy_id: "strat_dji_vlog",
    rights_status: RightsStatus.USER_OWNED,
    main_image: {
      action: ImageAction.KEEP,
      layout_description: "左侧设备实拍特写，右侧标明99新与官方配件全",
      headline_text: "个人闲置 Pocket3",
      subheadline_text: "仅拆封测试配件全",
      asset_id: "ast_001",
      allowed_usage: AssetAllowedUsage.DIRECT_USE
    },
    detail_images: [
      {
        page_number: 1,
        action: ImageAction.REBUILD, // 正确使用 REBUILD
        focus: "机身接口与屏幕无划痕特写",
        content_summary: "多角度展示完好细节",
        asset_id: "ast_002",
        allowed_usage: AssetAllowedUsage.REFERENCE_ONLY,
        rebuild_prompt: "微距拍摄云台镜头镀膜与旋转屏"
      }
    ],
    visual_theme: {
      color_tone: "科技深灰配纯净白底",
      style_name: "数码旗舰极简风"
    }
  };

  const provider = new ContentMockModelProvider({
    "strat_dji_vlog": validPlanData
  });
  const planner = new ImagePlanner(provider);
  const { imagePlan } = await planner.planImages(
    mockDjiStrategy,
    mockDjiOffer,
    { title: "准新大疆", cover_copy: { headline: "个人闲置 Pocket3" } },
    assetRecords
  );

  assert.equal(imagePlan.main_image.action, ImageAction.KEEP);
  assert.equal(imagePlan.detail_images[0].action, ImageAction.REBUILD);

  // 2. 违规图片规划：试图对 REFERENCE_ONLY 素材使用 KEEP 动作，必须拦截！
  const illegalKeepPlanData = {
    ...validPlanData,
    detail_images: [
      {
        page_number: 1,
        action: ImageAction.KEEP, // 违规：REFERENCE_ONLY 严禁 KEEP
        focus: "盗用同行详情图",
        content_summary: "直接沿用同行截图",
        asset_id: "ast_002",
        allowed_usage: AssetAllowedUsage.REFERENCE_ONLY
      }
    ]
  };

  const badProvider = new ContentMockModelProvider({
    "strat_dji_vlog": illegalKeepPlanData
  });
  const badPlanner = new ImagePlanner(badProvider);

  await assert.rejects(
    async () => {
      await badPlanner.planImages(
        mockDjiStrategy,
        mockDjiOffer,
        { title: "准新大疆", cover_copy: { headline: "个人闲置 Pocket3" } },
        assetRecords
      );
    },
    /REFERENCE_ONLY.*严禁使用 KEEP/
  );
});

test("P4.6 CrossMediaConsistencyGuard - 不变量 13: 跨媒体事实冲突拦截 (162节 vs 120节 vs 200节)", () => {
  const consistentContent = {
    title: "设计审美提升课162节 百度网盘秒发",
    description: "全面系统讲解162节视觉审美核心课程，零基础包看懂。",
    cover_copy: {
      headline: "设计审美课",
      subheadline: "162节通俗易懂精讲"
    }
  };

  const consistentImagePlan = {
    main_image: {
      headline_text: "设计审美课162节",
      subheadline_text: "162节通俗易懂精讲"
    }
  };

  // 1. 完全一致，顺利通过
  assert.doesNotThrow(() => {
    CrossMediaConsistencyGuard.assertCrossMediaConsistency(consistentContent, consistentImagePlan);
  });

  // 2. 标题写 162节，但图片主图规划写 200节，触发冲突拦截
  const conflictedImagePlan = {
    main_image: {
      headline_text: "设计审美课200节完整版", // 冲突！200节 vs 162节
      subheadline_text: "通俗易懂精讲"
    }
  };

  assert.throws(
    () => {
      CrossMediaConsistencyGuard.assertCrossMediaConsistency(consistentContent, conflictedImagePlan);
    },
    /CROSS_MEDIA_FACT_CONFLICT/
  );
});
