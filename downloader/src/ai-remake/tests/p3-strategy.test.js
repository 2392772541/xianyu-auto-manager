import test from "node:test";
import assert from "node:assert/strict";
import { ProductScorer } from "../analyzers/product-scorer.js";
import { StrategyGenerator } from "../generators/strategy-generator.js";
import { StrategyGuard } from "../validators/strategy-guard.js";
import { StrategySelectionManager } from "../models/strategy-selection-manager.js";
import { BaseModelProvider } from "../providers/model-provider.js";
import {
  RecommendedAction,
  RightsStatus,
  FulfillmentStatus,
  StrategyChangeScope,
  RiskFlag
} from "../constants/enums.js";

// 构造测试专用的 MockModelProvider
class StrategyMockModelProvider extends BaseModelProvider {
  constructor(cannedResponses = {}) {
    super({ modelId: "test-strategy-mock-v1" });
    this.cannedResponses = cannedResponses;
  }

  async invoke({ systemPrompt, prompt, context, responseSchema }) {
    const key = context.source_product_id;
    const response = this.cannedResponses[key] || this.cannedResponses["default"];
    if (!response) {
      throw new Error(`No canned response for ${key}`);
    }

    const auditTrail = this.createAuditTrail({
      promptVersion: "v1.0.0",
      schemaVersion: responseSchema,
      sourceManifestHash: "mock_hash_123",
      rawInput: { systemPrompt, prompt },
      rawOutput: JSON.stringify(response),
      durationMs: 12
    });

    return {
      rawOutput: JSON.stringify(response),
      parsedData: JSON.parse(JSON.stringify(response)),
      auditTrail
    };
  }
}

// 真实样本 A (大疆相机) DNA 与 Offer
const mockDjiDna = {
  source_product_id: "prod_1063279814277",
  product_type: "PHYSICAL_GOODS",
  product_category: "数码相机/云台相机",
  target_customer: "Vlog创作者、旅拍爱好者、学生",
  customer_problem: "手机拍摄防抖差、夜景画质不足、便携性不佳",
  purchase_motivation: "低预算入手准新旗舰设备，节省差价",
  usage_scenario: "旅游随身拍、生活日常Vlog、短视频探店",
  core_content: ["大疆 Osmo Pocket 3 单机版主机", "原装保护壳", "手绳"],
  core_benefits: ["一英寸大底画质出色", "三轴机械防抖极稳", "旋转屏快速开机"],
  selling_points: ["刚拆封未使用", "机身无任何划痕", "支持顺丰包邮"],
  keywords: ["大疆", "Pocket3", "云台相机", "Vlog", "准新"],
  delivery_type: "OTHER",
  risk_flags: [],
  unsupported_claims: [],
  missing_information: ["未提及是否有发票", "未说明是否已激活大疆Care"],
  need_human_review: false
};

const mockDjiOffer = {
  source_product_id: "prod_1063279814277",
  actual_contents: ["大疆 Osmo Pocket 3 单机版主机", "原装保护壳", "手绳"],
  fulfillment_type: "OTHER",
  fulfillment_assets: [{ type: "PHYSICAL_INVENTORY", location: "本地仓库A区" }],
  rights_status: RightsStatus.USER_OWNED,
  quantity_verified: true,
  deliverable_verified: true,
  fulfillment_status: FulfillmentStatus.READY,
  human_confirmed: true
};

// 真实样本 B (162节审美课程) DNA 与 Offer
const mockCourseDna = {
  source_product_id: "prod_1064285821878",
  product_type: "VIRTUAL_RESOURCE",
  product_category: "设计教程/审美提升",
  target_customer: "设计初学者、自媒体博主、摄影爱好者",
  customer_problem: "排版不好看、配色土气、画面缺乏高级感",
  purchase_motivation: "系统化低成本提升视觉审美品味与设计技巧",
  usage_scenario: "日常自我提升、小红书图文制作、海报设计参考",
  core_content: ["162节高清视频课程（同行声称）", "配套课件PDF"],
  core_benefits: ["名师体系化讲解", "零基础易懂", "随到随学随时回放"],
  selling_points: ["162节体系化编排", "百度网盘极速发货", "手机电脑均可看"],
  keywords: ["审美课程", "设计提升", "网盘教程", "自媒体必备"],
  delivery_type: "NETDISK",
  risk_flags: [
    {
      type: RiskFlag.COPYRIGHT_OR_LICENSE,
      severity: "MEDIUM",
      reason: "第三方网盘课程资源可能存在著作权争议",
      remediation_suggestion: "建议重新自制课件大纲，或采用公版免版权教学资源"
    }
  ],
  unsupported_claims: [],
  missing_information: ["讲师真实资质未认证", "网盘链接有效期未明示"],
  need_human_review: true
};

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

test("P3.1 ProductScorer - 实体商品 (大疆相机) 价值评价与可行性打分", async () => {
  const scorer = new ProductScorer();
  const scorecard = await scorer.score(mockDjiDna, mockDjiOffer, { source_images: [{}, {}, {}] });

  assert.equal(scorecard.source_product_id, "prod_1063279814277");
  assert.equal(scorecard.recommended_action, RecommendedAction.REMAKE);
  assert.ok(scorecard.demand_signal_strength >= 3 && scorecard.demand_signal_strength <= 5);
  assert.ok(scorecard.positioning_clarity >= 1 && scorecard.positioning_clarity <= 5);
  assert.ok(scorecard.remake_feasibility >= 4);
  assert.ok(scorecard.limitations.includes("代理指标"));
  assert.equal(scorecard.scoring_basis.has_concrete_facts, true);
});

test("P3.1 ProductScorer - 虚拟商品 (审美课程) 评价与局限性标识", async () => {
  const scorer = new ProductScorer();
  const scorecard = await scorer.score(mockCourseDna, mockCourseOffer, { source_images: [{}, {}] });

  assert.equal(scorecard.source_product_id, "prod_1064285821878");
  assert.equal(scorecard.recommended_action, RecommendedAction.REMAKE);
  assert.ok(scorecard.decision_reason.length > 10);
  assert.ok(scorecard.limitations.includes("未联网"));
});

test("P3.1 ProductScorer - 致命风险与履约缺失触发 DROP 阻断动作", async () => {
  const scorer = new ProductScorer();

  // 场景 1: 违法违禁
  const illegalDna = {
    ...mockCourseDna,
    risk_flags: [
      {
        type: RiskFlag.ILLEGAL_OR_PROHIBITED,
        severity: "CRITICAL",
        reason: "涉及监管严禁出售的违禁虚拟账户",
        remediation_suggestion: "必须立即下架"
      }
    ]
  };
  const sc1 = await scorer.score(illegalDna, mockCourseOffer);
  assert.equal(sc1.recommended_action, RecommendedAction.DROP);
  assert.ok(sc1.decision_reason.includes("违规风险"));

  // 场景 2: 权利明确为未授权 (NOT_AUTHORIZED)
  const unauthorizedOffer = {
    ...mockCourseOffer,
    rights_status: RightsStatus.NOT_AUTHORIZED
  };
  const sc2 = await scorer.score(mockCourseDna, unauthorizedOffer);
  assert.equal(sc2.recommended_action, RecommendedAction.DROP);
  assert.ok(sc2.decision_reason.includes("无授权"));

  // 场景 3: 履约状态不可用 (UNAVAILABLE)
  const unavailOffer = {
    ...mockCourseOffer,
    fulfillment_status: FulfillmentStatus.UNAVAILABLE
  };
  const sc3 = await scorer.score(mockCourseDna, unavailOffer);
  assert.equal(sc3.recommended_action, RecommendedAction.DROP);
  assert.ok(sc3.decision_reason.includes("不可用"));
});

test("P3.2 StrategyGenerator - 生成实体商品 (大疆相机) 差异化重制策略", async () => {
  const mockResponses = {
    "prod_1063279814277": {
      source_product_id: "prod_1063279814277",
      proposed_strategy_id: "strat_dji_vlog_novice",
      strategies: [
        {
          strategy_id: "strat_dji_vlog_novice",
          positioning: "准新便携旅拍云台相机（学生党轻度尝鲜）",
          target_customer: "在校大学生、年轻情侣旅拍",
          main_selling_angle: "原装盒说配件全，仅拆封无划痕立省400元",
          title_direction: "【准新在保】大疆Pocket3 仅拆封测试箱说全 顺丰包邮",
          content_direction: "重点突出成色如新、配件无磨损、支持验机保障",
          image_direction: "第一张首图凸显开机屏幕亮屏实拍与保护壳完整度",
          price_strategy: { recommended_price: 2499, price_rationale: "紧贴市场准新流通价下沿快速出单" },
          why_this_strategy_is_plausible: "原机成色99新且附件完整，迎合初学者低成本体验大疆旗舰防抖的需求",
          confidence_score: 0.92,
          strategy_change_scope: StrategyChangeScope.AUDIENCE_REFRAME,
          evidence_ids: ["clm_0001", "clm_0002"]
        },
        {
          strategy_id: "strat_dji_content_creator",
          positioning: "自媒体短视频便携生产力利器",
          target_customer: "全职自媒体新人、探店博主",
          main_selling_angle: "一英寸大底暗光神器，即买即拍快速回本",
          title_direction: "大疆DJI Pocket 3 探店Vlog生产力 极品成色带配件",
          content_direction: "突出对焦速度快、夜景噪点低及收音效果",
          image_direction: "拍摄探店、室内暗光实拍画质对比展示",
          price_strategy: { recommended_price: 2550, price_rationale: "瞄准生产力工具定位，提供更专业的成色保障" },
          why_this_strategy_is_plausible: "产品硬件一英寸底对自媒体创作者具有极高吸引力，买家更看重设备完好与稳定性",
          confidence_score: 0.86,
          strategy_change_scope: StrategyChangeScope.POSITIONING_ONLY,
          evidence_ids: ["clm_0001"]
        }
      ]
    }
  };

  const provider = new StrategyMockModelProvider(mockResponses);
  const generator = new StrategyGenerator(provider);
  const scorer = new ProductScorer();
  const scorecard = await scorer.score(mockDjiDna, mockDjiOffer);

  const { strategySet, auditTrail } = await generator.generateStrategies(
    mockDjiDna,
    mockDjiOffer,
    scorecard
  );

  assert.equal(strategySet.source_product_id, "prod_1063279814277");
  assert.equal(strategySet.strategies.length, 2);
  assert.equal(strategySet.proposed_strategy_id, "strat_dji_vlog_novice");
  assert.ok(auditTrail.output_hash);
});

test("P3.2 StrategyGenerator - 生成虚拟商品 (审美课程) 双策略与 DROP 阻断", async () => {
  const mockResponses = {
    "prod_1064285821878": {
      source_product_id: "prod_1064285821878",
      proposed_strategy_id: "strat_course_beginner",
      strategies: [
        {
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
        },
        {
          strategy_id: "strat_course_designer_pro",
          positioning: "专业视觉设计师灵感大纲与审美题库",
          target_customer: "在职平面设计师、UI设计师、视觉美术生",
          main_selling_angle: "系统梳理大师级视觉构成规律，突破设计灵感瓶颈",
          title_direction: "高级视觉审美与艺术构成全套162节 百度网盘秒发",
          content_direction: "强调体系完整度、经典案例拆解与艺术修养培养",
          image_direction: "极简黑白艺术构图，大师名作解析界面",
          price_strategy: { recommended_price: 19.9, price_rationale: "针对进阶专业用户设定中等客单价" },
          why_this_strategy_is_plausible: "课程内容达162节，体量庞大，符合专业人群对系统深度内容的需求",
          confidence_score: 0.85,
          strategy_change_scope: StrategyChangeScope.PACKAGING_REFRAME,
          evidence_ids: ["clm_0001"]
        }
      ]
    }
  };

  const provider = new StrategyMockModelProvider(mockResponses);
  const generator = new StrategyGenerator(provider);
  const scorer = new ProductScorer();
  const scorecard = await scorer.score(mockCourseDna, mockCourseOffer);

  const { strategySet } = await generator.generateStrategies(
    mockCourseDna,
    mockCourseOffer,
    scorecard
  );
  assert.equal(strategySet.strategies.length, 2);

  // 验证 DROP 阻断：如果评分卡判定为 DROP，必须拦截
  const dropScorecard = {
    ...scorecard,
    recommended_action: RecommendedAction.DROP,
    decision_reason: "风险过高，强制淘汰"
  };

  await assert.rejects(
    async () => {
      await generator.generateStrategies(mockCourseDna, mockCourseOffer, dropScorecard);
    },
    /DROP_ACTION_BLOCKED/
  );
});

test("P3.3 StrategyGuard - 不变量 8: 严禁策略擅自篡改或扩充我方交付事实", () => {
  // 模拟策略擅自增加未核验的“附送模板”、“终身答疑”
  const badStrategySet = {
    source_product_id: "prod_1064285821878",
    proposed_strategy_id: "strat_hack",
    strategies: [
      {
        strategy_id: "strat_hack",
        positioning: "设计课全集",
        target_customer: "学员",
        main_selling_angle: "买就送源码和一对一辅导超值大礼包", // 擅自承诺
        title_direction: "大礼包",
        content_direction: "大礼包",
        image_direction: "图",
        price_strategy: { recommended_price: 10, price_rationale: "低" },
        why_this_strategy_is_plausible: "好卖",
        confidence_score: 0.8,
        strategy_change_scope: StrategyChangeScope.POSITIONING_ONLY, // 未标记为 PRODUCT_CHANGE_REQUIRED
        evidence_ids: []
      }
    ]
  };

  assert.throws(
    () => {
      StrategyGuard.assertStrategyDoesNotMutateOfferFacts(badStrategySet, mockCourseOffer);
    },
    /STRATEGY_UNAUTHORIZED_FACT_MUTATION/
  );
});

test("P3.3 StrategyGuard - 不变量 9: 严禁生成同义改写的冗余策略", () => {
  const redundantStrategySet = {
    source_product_id: "prod_1064285821878",
    proposed_strategy_id: "strat_1",
    strategies: [
      {
        strategy_id: "strat_1",
        positioning: "小白入门课",
        target_customer: "大学生",
        main_selling_angle: "低价速成",
        title_direction: "A",
        content_direction: "A",
        image_direction: "A",
        price_strategy: { recommended_price: 10, price_rationale: "低" },
        why_this_strategy_is_plausible: "好",
        confidence_score: 0.8,
        strategy_change_scope: StrategyChangeScope.POSITIONING_ONLY,
        evidence_ids: []
      },
      {
        strategy_id: "strat_2",
        positioning: "小白入门课", // 完全相同
        target_customer: "大学生", // 完全相同
        main_selling_angle: "低价速成", // 完全相同
        title_direction: "B",
        content_direction: "B",
        image_direction: "B",
        price_strategy: { recommended_price: 10, price_rationale: "低" },
        why_this_strategy_is_plausible: "好",
        confidence_score: 0.8,
        strategy_change_scope: StrategyChangeScope.POSITIONING_ONLY,
        evidence_ids: []
      }
    ]
  };

  assert.throws(
    () => {
      StrategyGuard.assertStrategyDiversity(redundantStrategySet);
    },
    /REDUNDANT_STRATEGY_GENERATED/
  );
});

test("P3.4 StrategySelectionManager - 人工策略选定与 PRODUCT_CHANGE_REQUIRED 拦截", () => {
  const stratSet = {
    source_product_id: "prod_1064285821878",
    proposed_strategy_id: "strat_normal",
    strategies: [
      {
        strategy_id: "strat_normal",
        positioning: "正常定位",
        target_customer: "大众",
        main_selling_angle: "高质量",
        title_direction: "A",
        content_direction: "A",
        image_direction: "A",
        price_strategy: { recommended_price: 15, price_rationale: "平价" },
        why_this_strategy_is_plausible: "可行",
        confidence_score: 0.9,
        strategy_change_scope: StrategyChangeScope.MESSAGING_ONLY,
        evidence_ids: []
      },
      {
        strategy_id: "strat_needs_change",
        positioning: "改造成7天训练营",
        target_customer: "高意愿学员",
        main_selling_angle: "按天打卡学完",
        title_direction: "B",
        content_direction: "B",
        image_direction: "B",
        price_strategy: { recommended_price: 49, price_rationale: "高客单" },
        why_this_strategy_is_plausible: "需要重新分包",
        confidence_score: 0.75,
        strategy_change_scope: StrategyChangeScope.PRODUCT_CHANGE_REQUIRED,
        evidence_ids: []
      }
    ]
  };

  // 1. 未显式传参选择策略，拦截
  assert.throws(
    () => {
      StrategySelectionManager.selectStrategy(stratSet, null);
    },
    /MISSING_SELECTED_STRATEGY_ID/
  );

  // 2. 选择不存在的策略 ID，拦截
  assert.throws(
    () => {
      StrategySelectionManager.selectStrategy(stratSet, "strat_non_existent");
    },
    /UNKNOWN_SELECTED_STRATEGY/
  );

  // 3. 选定需要产品变动的策略，在未经人工确认产品变更时，阻断下游推进
  assert.throws(
    () => {
      StrategySelectionManager.selectStrategy(stratSet, "strat_needs_change", {
        human_confirmed_product_change: false
      });
    },
    /PRODUCT_CHANGE_REQUIRED_BLOCKED/
  );

  // 4. 正常选择 strat_normal，生成合法只读快照
  const record = StrategySelectionManager.selectStrategy(stratSet, "strat_normal", {
    operator: "zhang_san",
    notes: "主打普通大众，客单价合理"
  });

  assert.equal(record.selected_strategy_id, "strat_normal");
  assert.equal(record.selection_source, "HUMAN");
  assert.equal(record.operator, "zhang_san");
  assert.equal(record.strategy_snapshot.strategy_id, "strat_normal");
  assert.equal(Object.isFrozen(record), true);
});
