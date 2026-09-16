import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData, getLoadedSchemas } from '../validators/schema-validator.js';
import {
  RightsStatus,
  FulfillmentStatus,
  ClaimNature,
  RecommendedAction,
  ImageAction,
  EvidenceScope,
  DeliveryType
} from '../constants/enums.js';

test('Schema 加载数量校验 - 13 个核心 Schema 均已正确挂载', () => {
  const loaded = getLoadedSchemas();
  assert.equal(loaded.length, 13, '必须加载 1 个 enums + 12 个业务 Schema');
});

test('1. SourceProduct Schema 校验', () => {
  const validData = {
    source_product_id: 'prod_1063279814277',
    source_url: 'https://www.goofish.com/item?id=1063279814277',
    source_title: '拆开了，算是没用过，大疆pocket3',
    source_description: '拆开了，算是没用过，大疆pocket3\n深圳南山白石洲附近自提',
    source_images: [
      {
        position: 1,
        file_name: '01.webp',
        sha256: '8b2791a49e49acb434df98f1e80da986f034fbcd5cf3160caa0a0c3f08de33cb',
        width: 1440,
        height: 1920
      }
    ],
    source_price: { amount: 2500, currency: 'CNY' },
    captured_at: '2026-09-13T13:41:33.018Z',
    archive_manifest_hash: 'a'.repeat(64)
  };

  const res = validateData('source-product.schema.json', validData);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('2. SellableOffer Schema 校验', () => {
  const validOffer = {
    offer_id: 'offer_pocket3_001',
    source_product_id: 'prod_1063279814277',
    actual_contents: [
      { item_name: '大疆Pocket3主机+配件', format: '实物顺丰包邮', count: 1 }
    ],
    fulfillment_type: DeliveryType.MANUAL_SERVICE,
    fulfillment_assets: [
      { asset_type: 'LOCAL_ARCHIVE', location_reference: '仓库A区货架3' }
    ],
    rights_status: RightsStatus.USER_OWNED,
    quantity_verified: true,
    deliverable_verified: true,
    fulfillment_status: FulfillmentStatus.READY,
    human_confirmed: true
  };

  const res = validateData('sellable-offer.schema.json', validOffer);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('3. ProductDNA Schema 校验', () => {
  const validDNA = {
    source_product_id: 'prod_1063279814277',
    product_type: 'PHYSICAL_GOODS',
    product_category: '数码相机/手持云台',
    target_customer: '短视频摄影爱好者',
    customer_problem: '拍摄Vlog需要轻便防抖设备',
    purchase_motivation: '近乎全新性价比高',
    usage_scenario: '日常旅行出游记录',
    core_content: ['大疆Pocket3标准套机'],
    core_benefits: ['小巧便携三轴防抖'],
    selling_points: ['充新成色无暗病'],
    keywords: ['大疆', 'Pocket3', 'Vlog神器'],
    delivery_type: DeliveryType.MANUAL_SERVICE,
    risk_flags: [],
    unsupported_claims: [],
    missing_information: [],
    need_human_review: false
  };
  const res = validateData('product-dna.schema.json', validDNA);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('4. ProductScorecard Schema 校验', () => {
  const validScorecard = {
    source_product_id: 'prod_1063279814277',
    demand_signal_strength: 5,
    positioning_clarity: 4,
    differentiation_potential: 3,
    remake_feasibility: 4,
    recommended_action: RecommendedAction.REMAKE,
    decision_reason: '市场高需求且成色良好',
    limitations: '仅基于单商品描述与图片判断，未接入全网实时大盘销量'
  };
  const res = validateData('product-scorecard.schema.json', validScorecard);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('5. RemakeStrategy Schema 校验', () => {
  const validStrategySet = {
    source_product_id: 'prod_1063279814277',
    proposed_strategy_id: 'strat_travel_vlog',
    strategies: [
      {
        strategy_id: 'strat_travel_vlog',
        positioning: '高性价比准新旅拍神器',
        target_customer: '学生及旅拍新手',
        main_selling_angle: '原盒在保几乎未使用立省数百元',
        title_direction: '突出成色与即拍即发',
        content_direction: '详述配件无磨损细节',
        image_direction: '实拍特写与开机屏幕检测',
        price_strategy: { recommended_price: 2450, price_rationale: '略低于市场均价促成快速成交' },
        why_this_strategy_is_plausible: '原图清晰展示无划痕，原主仅拆封符合轻度使用画像',
        confidence_score: 0.88,
        strategy_change_scope: 'POSITIONING_ONLY',
        evidence_ids: ['ev_001']
      }
    ]
  };
  const res = validateData('remake-strategy.schema.json', validStrategySet);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('6. ListingContent Schema 校验', () => {
  const validContent = {
    source_product_id: 'prod_1063279814277',
    selected_strategy_id: 'strat_travel_vlog',
    title: '【准新在保】大疆DJI Pocket3 口袋云台相机 配件齐全顺丰包邮',
    description: '刚买不久仅拆封测试，成色99新无划痕。包装配件全部都在，支持验机。',
    bullet_points: ['99成新仅拆封', '官方在保可查', '深圳同城支持自提'],
    keywords: ['大疆Pocket3', '云台相机', '拍Vlog', '数码二手'],
    cover_copy: {
      headline: '几乎全新 Pocket3',
      subheadline: '在保原装配件全'
    },
    delivery_note: '拍下24小时内顺丰保价发出'
  };
  const res = validateData('listing-content.schema.json', validContent);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('7. ImagePlan Schema 校验', () => {
  const validImagePlan = {
    source_product_id: 'prod_1063279814277',
    selected_strategy_id: 'strat_travel_vlog',
    rights_status: RightsStatus.USER_OWNED,
    main_image: {
      action: ImageAction.CLEAN_ONLY,
      layout_description: '中心特写居中，右上角打上准新在保标签',
      headline_text: '准新大疆 Pocket 3',
      subheadline_text: '箱说齐全 顺丰包邮'
    },
    detail_images: [
      {
        page_number: 1,
        action: ImageAction.CLEAN_ONLY,
        focus: '镜头无划痕特写',
        content_summary: '展示镜头镀膜与机身按键完好'
      }
    ],
    visual_theme: {
      color_tone: '科技数码深空灰',
      style_name: '专业实拍风'
    }
  };
  const res = validateData('image-plan.schema.json', validImagePlan);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('8. Evidence Schema 校验', () => {
  const validEvidence = {
    source_product_id: 'prod_1063279814277',
    claims: [
      {
        claim_id: 'clm_0001',
        claim_text: '原装未拆封配件齐全',
        claim_nature: ClaimNature.FACT,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE,
        sources: [
          { source_type: 'SOURCE_DESCRIPTION', source_ref: 'line_1' }
        ],
        verification_status: 'DIRECT_MATCH',
        confidence: 0.95
      }
    ]
  };
  const res = validateData('evidence.schema.json', validEvidence);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('9. ValidationReport Schema 校验', () => {
  const validReport = {
    source_product_id: 'prod_1063279814277',
    passed: true,
    errors: [],
    warnings: ['原图包含环境背景，建议适当裁剪'],
    fact_coverage_rate: 1.0,
    fulfillment_ready: true,
    rights_compliant: true,
    checked_at: '2026-09-16T12:30:00Z'
  };
  const res = validateData('validation-report.schema.json', validReport);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('10. PendingListingPackage Schema 校验', () => {
  const validPkg = {
    package_id: 'pkg_pocket3_001',
    version_id: 'v1.0.0',
    approved_revision_id: 'rev_pocket3_001',
    source_product_id: 'prod_1063279814277',
    offer_id: 'offer_pocket3_001',
    source_manifest_hash: 'a'.repeat(64),
    sellable_offer_hash: 'b'.repeat(64),
    selected_strategy_id: 'strat_travel_vlog',
    selected_strategy_hash: 'c'.repeat(64),
    title: '【准新在保】大疆DJI Pocket3 口袋云台相机 配件齐全顺丰包邮',
    description: '刚买不久仅拆封测试，成色99新无划痕。包装配件全部都在，支持验机。',
    selling_points: ['99成新仅拆封', '官方在保可查', '深圳同城支持自提'],
    keywords: ['大疆Pocket3', '云台相机', '拍Vlog', '数码二手'],
    cover_copy: {
      headline: '几乎全新 Pocket3',
      subheadline: '在保原装配件全'
    },
    delivery_note: '拍下24小时内顺丰保价发出',
    listing_content: {
      source_product_id: 'prod_1063279814277',
      selected_strategy_id: 'strat_travel_vlog',
      title: '【准新在保】大疆DJI Pocket3 口袋云台相机 配件齐全顺丰包邮',
      description: '刚买不久仅拆封测试，成色99新无划痕。包装配件全部都在，支持验机。',
      bullet_points: ['99成新仅拆封', '官方在保可查', '深圳同城支持自提'],
      keywords: ['大疆Pocket3', '云台相机', '拍Vlog', '数码二手'],
      cover_copy: {
        headline: '几乎全新 Pocket3',
        subheadline: '在保原装配件全'
      },
      delivery_note: '拍下24小时内顺丰保价发出'
    },
    image_plan: {
      source_product_id: 'prod_1063279814277',
      selected_strategy_id: 'strat_travel_vlog',
      rights_status: RightsStatus.USER_OWNED,
      main_image: {
        action: ImageAction.CLEAN_ONLY,
        layout_description: '中心特写居中，右上角打上准新在保标签',
        headline_text: '准新大疆 Pocket 3',
        subheadline_text: '箱说齐全 顺丰包邮'
      },
      detail_images: [
        {
          page_number: 1,
          action: ImageAction.CLEAN_ONLY,
          focus: '镜头无划痕特写',
          content_summary: '展示镜头镀膜与机身按键完好'
        }
      ],
      visual_theme: {
        color_tone: '科技数码深空灰',
        style_name: '专业实拍风'
      }
    },
    asset_refs: ['01.webp'],
    claim_evidence_summary: {
      total_claims: 3,
      fact_claims_count: 2,
      unverified_fact_count: 0
    },
    evidence_summary: {
      total_claims: 3,
      fact_claims_count: 2,
      unverified_fact_count: 0
    },
    rights_summary: '用户自制实拍图，版权归我方所有',
    fulfillment_summary: '现货顺丰包邮，24小时发出',
    validation_report_hash: 'd'.repeat(64),
    human_review: {
      decision: 'APPROVE',
      reviewer: 'admin',
      reviewed_at: '2026-09-16T12:35:00Z',
      notes: '成色良好，证据充分'
    },
    approved_by: 'admin',
    approved_at: '2026-09-16T12:35:00Z',
    package_hash: 'e'.repeat(64),
    fulfillment_status: FulfillmentStatus.READY,
    package_status: 'READY_FOR_EXPORT'
  };
  const res = validateData('pending-listing-package.schema.json', validPkg);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('11. CanonicalVersioning Schema 校验', () => {
  const validVersioning = {
    job_id: 'job_pocket3_001',
    source_product_id: 'prod_1063279814277',
    current_status: 'APPROVED',
    active_revision_id: 'rev_pocket3_001',
    revisions: [
      {
        revision_id: 'rev_pocket3_001',
        created_at: '2026-09-16T12:00:00Z',
        status: 'APPROVED',
        change_reason: '初始生成与人工微调',
        selected_strategy_id: 'strat_travel_vlog',
        is_read_only: true
      }
    ],
    published_versions: [
      {
        version_id: 'v1.0.0',
        derived_from_revision_id: 'rev_pocket3_001',
        published_at: '2026-09-16T12:40:00Z',
        package_ref: 'pkg_pocket3_001'
      }
    ]
  };
  const res = validateData('canonical-versioning.schema.json', validVersioning);
  assert.equal(res.valid, true, res.formattedErrors);
});

test('12. NodeExecutionReceipt Schema 校验', () => {
  const validReceipt = {
    receipt_id: 'rec_analysis_001',
    job_id: 'job_pocket3_001',
    revision_id: 'rev_pocket3_001',
    node: 'PRODUCT_ANALYSIS',
    input_hash: 'a'.repeat(64),
    output_hash: 'b'.repeat(64),
    started_at: '2026-09-16T12:00:00Z',
    finished_at: '2026-09-16T12:00:02Z',
    status: 'SUCCESS',
    attempt: 1,
    model_id: 'test-model-v1',
    prompt_version: 'v1.0.0',
    policy_version: 'v1.0.0',
    error: null
  };
  const res = validateData('node-execution-receipt.schema.json', validReceipt);
  assert.equal(res.valid, true, res.formattedErrors);
});