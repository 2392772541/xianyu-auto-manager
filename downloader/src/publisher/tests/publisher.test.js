import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  PublishCoordinator,
  PublishPreflightGuard,
  XianguanjiaPayloadAdapter,
  PublishReceipt,
  MockPublisher,
  PublishConfig
} from "../index.js";

function getSamplePackage(overrides = {}) {
  return {
    package_id: "pkg_test_001",
    version_id: "v1.0.0",
    package_hash: "hash_test_pkg_12345",
    package_status: "READY_FOR_EXPORT",
    title: "【全套162节】自媒体视觉审美进阶课 百度网盘发货", // 23 汉字，合规 <= 30
    description: "自媒体做图没灵感？排版土气没高级感？全套162节无损视频课程，从基础认知到进阶实操。",
    selling_points: [
      "全套162节体系化教程",
      "支持手机电脑随时回看"
    ],
    delivery_note: "拍下后发送百度网盘链接。",
    asset_refs: ["cover_01.jpg", "detail_01.jpg"],
    keywords: ["设计", "审美", "网盘发货"],
    cover_copy: {
      headline: "审美进阶课",
      subheadline: "162节系统学"
    },
    rights_summary: "可售物权利: LICENSED; 关联资产: 2 项",
    fulfillment_summary: "交付类型: NETDISK; 状态: READY; 可交付已核验: true",
    listing_content: {
      price: 19.9
    },
    stock: 999,
    location: "广东省深圳市",
    ...overrides
  };
}

test("PUB-1.0 PublishPreflightGuard 前置硬门禁测试 (防篡改、快照完整性与必填字段)", () => {
  const validPkg = getSamplePackage();
  assert.equal(PublishPreflightGuard.validatePackage(validPkg), true);

  // 1. 拦截标题超长 (严禁发布器擅自截断！必须回退打回重新审批)
  const longTitlePkg = getSamplePackage({
    title: "【全套162节】自媒体视觉审美进阶课 构图排版配色全解 百度网盘发货 超长标题用来验证阻断" // 43 汉字
  });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(longTitlePkg),
    /TITLE_TOO_LONG.*发布层严禁擅自截断/
  );

  // 2. 拦截发货地缺失 (防止闲管家页面记忆上一件商品造成污染)
  const noLocationPkg = getSamplePackage({ location: "" });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(noLocationPkg),
    /LOCATION_REQUIRED.*为防止闲管家页面记忆/
  );

  // 3. 拦截价格缺失 (禁止自作主张给兜底价)
  const noPricePkg = getSamplePackage({ listing_content: {} });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(noPricePkg),
    /PRICE_REQUIRED.*严禁发布器擅自给出默认兜底价/
  );

  // 4. 拦截库存缺失 (禁止随意猜测)
  const noStockPkg = getSamplePackage({ stock: null });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(noStockPkg),
    /STOCK_REQUIRED.*严禁发布器擅自猜测默认库存/
  );

  // 5. 拦截 STALE
  const stalePkg = getSamplePackage({ package_status: "STALE", stale_reason: "网盘链接失效" });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(stalePkg),
    /PREFLIGHT_BLOCKED.*已被标记为过期/
  );

  // 6. 拦截非 READY_FOR_EXPORT
  const draftPkg = getSamplePackage({ package_status: "DRAFT" });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(draftPkg),
    /待发布包状态非 READY_FOR_EXPORT/
  );

  // 7. 拦截权利缺失与 DROP 红线
  const dropPkg = getSamplePackage({ rights_summary: "可售物权利: DROP (违规资源)" });
  assert.throws(
    () => PublishPreflightGuard.validatePackage(dropPkg),
    /PREFLIGHT_BLOCKED.*违规红线/
  );
});

test("PUB-2.0 XianguanjiaPayloadAdapter 表单适配与商家编码对账生成测试", () => {
  const pkg = getSamplePackage();
  const adapted = XianguanjiaPayloadAdapter.adapt(pkg);

  // 标题保持原汁原味，无截断
  assert.equal(adapted.form_data.title, "【全套162节】自媒体视觉审美进阶课 百度网盘发货");

  // 描述包含原正文、亮点与交付说明
  assert.ok(adapted.form_data.description.includes("【商品亮点】"));
  assert.ok(adapted.form_data.description.includes("全套162节体系化教程"));
  assert.ok(adapted.form_data.description.includes("【交付与售后】"));

  // 显式字段正确映射
  assert.equal(adapted.form_data.price, 19.9);
  assert.equal(adapted.form_data.stock, 999);
  assert.equal(adapted.form_data.location, "广东省深圳市");

  // 唯一商家编码生成 (基于 package_hash)
  assert.ok(adapted.outer_id.startsWith("XYAI-"));
  assert.equal(adapted.form_data.outer_id, adapted.outer_id);

  // 虚拟商品发货模式
  assert.equal(adapted.form_data.is_virtual, true);
  assert.equal(adapted.form_data.shipping_type, "NO_SHIPPING_REQUIRED");
});

test("PUB-2.1 实体商品表单适配测试", () => {
  const physicalPkg = getSamplePackage({
    title: "【个人闲置】大疆 Pocket 3 拆封未使用 深圳自提",
    fulfillment_summary: "交付类型: MANUAL_SERVICE; 状态: READY; 可交付已核验: true",
    description: "大疆Pocket 3手持云台相机，自提现货。",
    rights_summary: "可售物权利: USER_OWNED; 关联资产: 1 项",
    listing_content: { price: 2450 },
    stock: 1,
    location: "广东省深圳市南山区"
  });

  const adapted = XianguanjiaPayloadAdapter.adapt(physicalPkg);
  assert.equal(adapted.form_data.is_virtual, false);
  assert.equal(adapted.form_data.shipping_type, "EXPRESS_AND_LOCAL");
  assert.equal(adapted.form_data.stock, 1);
  assert.equal(adapted.form_data.price, 2450);
  assert.equal(adapted.form_data.location, "广东省深圳市南山区");
});

test("PUB-3.0 PublishCoordinator 端到端草稿发布与 .jsonl 账本归档", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-test-"));
  const ledgerPath = path.join(tmpDir, "publish_receipts.jsonl");

  const coordinator = new PublishCoordinator({
    ledgerPath: ledgerPath,
    executor: new MockPublisher()
  });

  const pkg = getSamplePackage();
  const res = await coordinator.publishPackage(pkg, { publishMode: "DRAFT" });

  assert.equal(res.success, true);
  assert.equal(res.status, PublishConfig.STATUS.DRAFT_SAVED);
  assert.equal(res.receipt.publish_mode, "DRAFT");
  assert.ok(res.receipt.platform_draft_id.startsWith("xgj_draft_"));
  assert.ok(res.receipt.outer_id.startsWith("XYAI-"));

  // 验证 .jsonl 账本持久化
  const ledger = PublishReceipt.loadLedger(ledgerPath);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].receipt_id, res.receipt.receipt_id);
  assert.equal(ledger[0].package_id, pkg.package_id);
  assert.equal(ledger[0].outer_id, res.receipt.outer_id);

  // 清理临时文件
  // 5. 测试商家编码 (outer_id) 哈希碰撞拦截
  const collisionPkg = getSamplePackage({
    package_id: "pkg_collision_003",
    package_hash: pkg.package_hash.slice(0, 8) + "_different_suffix" // 前8位相同，但整体hash不同
  });
  assert.throws(
    () => PublishPreflightGuard.assertNotDuplicatePublish(collisionPkg, ledger),
    /OUTER_ID_COLLISION.*产生哈希碰撞/
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("PUB-4.0 幂等防重与 UNKNOWN/对账中断拦截测试", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pub-test-idem-"));
  const ledgerPath = path.join(tmpDir, "publish_receipts.jsonl");

  const coordinator = new PublishCoordinator({
    ledgerPath: ledgerPath,
    executor: new MockPublisher()
  });

  const pkg = getSamplePackage();

  // 1. 立即发布成功
  const liveRes = await coordinator.publishPackage(pkg, { publishMode: "IMMEDIATE" });
  assert.equal(liveRes.success, true);
  assert.equal(liveRes.status, PublishConfig.STATUS.PUBLISHED_CONFIRMED);
  assert.ok(liveRes.receipt.platform_item_id.startsWith("xgj_item_"));

  // 2. 再次尝试立即发布同一包，必须被幂等阻断
  await assert.rejects(
    async () => {
      await coordinator.publishPackage(pkg, { publishMode: "IMMEDIATE" });
    },
    /DUPLICATE_PUBLISH_BLOCKED.*禁止重复上架/
  );

  // 3. 测试网络超时/结果未知 (TIMEOUT_UNKNOWN) 场景
  const timeoutCoordinator = new PublishCoordinator({
    ledgerPath: ledgerPath,
    executor: new MockPublisher({ failureMode: "TIMEOUT_UNKNOWN" })
  });

  const pkg2 = getSamplePackage({ package_id: "pkg_test_002", package_hash: "hash_002_abc" });
  const timeoutRes = await timeoutCoordinator.publishPackage(pkg2, { publishMode: "DRAFT" });
  assert.equal(timeoutRes.success, false);
  assert.equal(timeoutRes.status, PublishConfig.STATUS.UNKNOWN);
  assert.equal(timeoutRes.receipt.needs_reconciliation, true);

  // 4. 对处于 UNKNOWN 状态的包，严禁自动重试，必须阻断并提示人工对账！
  await assert.rejects(
    async () => {
      await coordinator.publishPackage(pkg2, { publishMode: "DRAFT" });
    },
    /RECONCILIATION_REQUIRED.*严禁自动重试/
  );

  // 账本中已记录该 UNKNOWN 事件与商家编码
  const ledger = PublishReceipt.loadLedger(ledgerPath);
  assert.equal(ledger.length, 2);
  assert.equal(ledger[1].status, "UNKNOWN");
  assert.ok(ledger[1].outer_id.startsWith("XYAI-"));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
