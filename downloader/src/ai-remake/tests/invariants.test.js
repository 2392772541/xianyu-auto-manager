import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvariantsGuard,
  InvariantViolationError
} from '../validators/invariants-guard.js';
import {
  RightsStatus,
  FulfillmentStatus,
  ClaimNature,
  RecommendedAction,
  ImageAction,
  EvidenceScope
} from '../constants/enums.js';

test('不变量 1：原始目录只读保护 - 任何写/删操作均必须被阻断', () => {
  assert.throws(
    () => InvariantsGuard.assertSourceReadOnly(true, '商品素材/1064285821878/文案.txt'),
    (err) => err instanceof InvariantViolationError && err.code === 'READONLY_SOURCE_MUTATION'
  );

  assert.doesNotThrow(() => {
    InvariantsGuard.assertSourceReadOnly(false, '商品素材/1064285821878/文案.txt');
  });
});

test('不变量 2：履约未达 READY 严禁出库为 READY_FOR_EXPORT', () => {
  const incompleteOffer = {
    offer_id: 'offer_test001',
    fulfillment_status: FulfillmentStatus.INCOMPLETE,
    deliverable_verified: false,
    human_confirmed: false
  };

  assert.throws(
    () => InvariantsGuard.assertFulfillmentReadyForExport(incompleteOffer, 'READY_FOR_EXPORT'),
    (err) => err instanceof InvariantViolationError && err.code === 'FULFILLMENT_NOT_READY'
  );

  const readyOfferUnconfirmed = {
    offer_id: 'offer_test002',
    fulfillment_status: FulfillmentStatus.READY,
    deliverable_verified: true,
    human_confirmed: false
  };

  assert.throws(
    () => InvariantsGuard.assertFulfillmentReadyForExport(readyOfferUnconfirmed, 'READY_FOR_EXPORT'),
    (err) => err instanceof InvariantViolationError && err.code === 'DELIVERY_NOT_CONFIRMED'
  );

  const perfectOffer = {
    offer_id: 'offer_test003',
    fulfillment_status: FulfillmentStatus.READY,
    deliverable_verified: true,
    human_confirmed: true
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertFulfillmentReadyForExport(perfectOffer, 'READY_FOR_EXPORT');
  });

  // 草稿状态允许未就绪
  assert.doesNotThrow(() => {
    InvariantsGuard.assertFulfillmentReadyForExport(incompleteOffer, 'DRAFT');
  });
});

test('不变量 3：未授权原图严禁沿用 (KEEP)，必须强制 REBUILD', () => {
  const unauthorizedPlanWithKeep = {
    main_image: { action: ImageAction.KEEP },
    detail_images: [{ page_number: 1, action: ImageAction.REBUILD }]
  };

  assert.throws(
    () => InvariantsGuard.assertImageRightsCompliant(RightsStatus.UNKNOWN, unauthorizedPlanWithKeep),
    (err) => err instanceof InvariantViolationError && err.code === 'UNAUTHORIZED_IMAGE_KEEP'
  );

  const unauthorizedPlanRebuild = {
    main_image: { action: ImageAction.REBUILD },
    detail_images: [{ page_number: 1, action: ImageAction.REBUILD }]
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertImageRightsCompliant(RightsStatus.UNKNOWN, unauthorizedPlanRebuild);
  });

  const licensedPlanWithKeep = {
    main_image: { action: ImageAction.KEEP },
    detail_images: [{ page_number: 1, action: ImageAction.KEEP }]
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertImageRightsCompliant(RightsStatus.LICENSED, licensedPlanWithKeep);
  });
});

test('不变量 4：FACT 具体事实声明无直接证据支撑，严禁批准正式版本', () => {
  const evidenceSetWithUnverifiedFact = {
    source_product_id: 'prod_123',
    claims: [
      {
        claim_id: 'clm_01',
        claim_text: '包含5000条精选提示词',
        claim_nature: ClaimNature.FACT,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE,
        sources: [],
        verification_status: 'UNVERIFIED'
      }
    ]
  };

  assert.throws(
    () => InvariantsGuard.assertFactClaimsCovered(evidenceSetWithUnverifiedFact),
    (err) => err instanceof InvariantViolationError && err.code === 'UNVERIFIED_FACT_CLAIMS'
  );

  const evidenceSetValid = {
    source_product_id: 'prod_123',
    claims: [
      {
        claim_id: 'clm_01',
        claim_text: '包含5000条精选提示词',
        claim_nature: ClaimNature.FACT,
        evidence_scope: EvidenceScope.REFERENCE_SOURCE,
        sources: [{ source_type: 'SOURCE_DESCRIPTION', source_ref: 'line_2' }],
        verification_status: 'DIRECT_MATCH'
      },
      {
        claim_id: 'clm_02',
        claim_text: '适合零基础新手快速上手',
        claim_nature: ClaimNature.INFERENCE,
        evidence_scope: EvidenceScope.HUMAN_CONFIRMED,
        sources: [],
        verification_status: 'INDIRECT_INFERRED'
      }
    ]
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertFactClaimsCovered(evidenceSetValid);
  });
});

test('不变量 5：DROP 评定商品严禁触发营销内容生成', () => {
  const dropScorecard = {
    source_product_id: 'prod_123',
    recommended_action: RecommendedAction.DROP,
    decision_reason: '同质化极其严重且疑似侵权'
  };

  assert.throws(
    () => InvariantsGuard.assertNotDroppedForContentGen(dropScorecard),
    (err) => err instanceof InvariantViolationError && err.code === 'DROP_ACTION_BLOCKED'
  );

  const remakeScorecard = {
    source_product_id: 'prod_123',
    recommended_action: RecommendedAction.REMAKE,
    decision_reason: '具备差异化重包装空间'
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertNotDroppedForContentGen(remakeScorecard);
  });
});

test('不变量 6：正式 Version 只能来源于已 APPROVED 的 Revision', () => {
  const unapprovedRev = {
    revision_id: 'rev_001',
    status: 'NEEDS_REVIEW'
  };

  assert.throws(
    () => InvariantsGuard.assertVersionFromApprovedRevision(unapprovedRev, 'v1.0.0'),
    (err) => err instanceof InvariantViolationError && err.code === 'VERSION_FROM_UNAPPROVED_REVISION'
  );

  const approvedRev = {
    revision_id: 'rev_002',
    status: 'APPROVED'
  };

  assert.doesNotThrow(() => {
    InvariantsGuard.assertVersionFromApprovedRevision(approvedRev, 'v1.0.0');
  });
});

test('不变量 7：已锁定的历史 Revision 严禁原地修改（不可变）', () => {
  const lockedRevision = InvariantsGuard.assertRevisionImmutable({
    revision_id: 'rev_001',
    status: 'APPROVED',
    is_read_only: true
  });

  assert.throws(
    () => {
      lockedRevision.status = 'REJECTED';
    },
    (err) => err instanceof InvariantViolationError && err.code === 'IMMUTABLE_REVISION_MUTATION'
  );

  // 未锁定草稿允许修改
  const draftRevision = InvariantsGuard.assertRevisionImmutable({
    revision_id: 'rev_002',
    status: 'IN_PROGRESS',
    is_read_only: false
  });

  assert.doesNotThrow(() => {
    draftRevision.status = 'NEEDS_INPUT';
  });
});