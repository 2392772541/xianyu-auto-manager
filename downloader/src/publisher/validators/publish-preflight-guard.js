import { PublishConfig } from "../models/publish-config.js";

/**
 * 发布前置硬门禁 (PublishPreflightGuard)
 * 严格执行发布层安全红线、快照完整性守卫与防重复发布机制
 */
export class PublishPreflightGuard {
  /**
   * 校验待发布包完整性与合规性 (严禁发布器擅自修改、截断或臆测已核准字段)
   */
  static validatePackage(pkg, options = {}) {
    if (!pkg || typeof pkg !== "object") {
      throw new Error("[PREFLIGHT_ERROR] 待发布包不能为空且必须为对象");
    }

    // 1. 拦截过期包 (STALE)
    if (pkg.package_status === "STALE") {
      throw new Error(`[PREFLIGHT_BLOCKED] 该成品包已被标记为过期 (STALE)，原因: ${pkg.stale_reason || "未知"}，禁止发布！`);
    }

    if (pkg.package_status !== "READY_FOR_EXPORT") {
      throw new Error(`[PREFLIGHT_BLOCKED] 待发布包状态非 READY_FOR_EXPORT (当前状态: ${pkg.package_status})，禁止发布！`);
    }

    // 2. 检查基本签名与不可变封签
    if (!pkg.package_id || !pkg.package_hash) {
      throw new Error("[PREFLIGHT_BLOCKED] 待发布包缺少 package_id 或 package_hash 封签，禁止发布！");
    }

    // 3. 标题完整性与硬长度限制 (严禁偷偷截断！超限必须打回生成新 Revision)
    const title = (pkg.title || "").trim();
    if (title.length === 0) {
      throw new Error("[PREFLIGHT_BLOCKED] [TITLE_EMPTY] 待发布包标题为空，禁止发布！");
    }
    if (title.length > PublishConfig.MAX_TITLE_CHARS) {
      throw new Error(`[PREFLIGHT_BLOCKED] [TITLE_TOO_LONG] 待发布标题超过平台硬限制 (当前 ${title.length} 汉字 > 上限 ${PublishConfig.MAX_TITLE_CHARS} 汉字)。发布层严禁擅自截断破坏批准快照完整性！必须回退生成新 Revision 重新审批！`);
    }

    // 4. 详情完整性与本地安全阈值
    const description = (pkg.description || "").trim();
    if (description.length === 0) {
      throw new Error("[PREFLIGHT_BLOCKED] [DESCRIPTION_EMPTY] 待发布包详情描述为空，禁止发布！");
    }
    if (description.length > PublishConfig.LOCAL_SAFETY_MAX_DESCRIPTION_CHARS) {
      throw new Error(`[PREFLIGHT_BLOCKED] [DESCRIPTION_TOO_LONG] 待发布详情超过本地安全上限 (${description.length} > ${PublishConfig.LOCAL_SAFETY_MAX_DESCRIPTION_CHARS})，请人工确认！`);
    }

    // 5. 拦截权利缺失与 DROP 红线
    const rightsSummary = pkg.rights_summary || "";
    if (rightsSummary.includes("DROP") || rightsSummary.includes("ILLEGAL_OR_PROHIBITED")) {
      throw new Error(`[PREFLIGHT_BLOCKED] 待发布包命中权利或违规红线 (${rightsSummary})，禁止发布！`);
    }

    // 6. 显式价格校验 (严禁发布器自作主张给兜底价)
    const price = options.price ?? pkg.listing_content?.price ?? pkg.selected_strategy?.price_strategy?.recommended_price;
    if (price === undefined || price === null || typeof price !== "number" || isNaN(price) || price <= 0) {
      throw new Error("[PREFLIGHT_BLOCKED] [PRICE_REQUIRED] 价格缺失或无效。价格属于商业决策，必须在待发布包中提供或显式传入，严禁发布器擅自给出默认兜底价！");
    }

    // 7. 显式库存校验 (严禁发布器根据商品类型自动猜库存)
    const stock = options.stock ?? pkg.stock;
    if (stock === undefined || stock === null || typeof stock !== "number" || isNaN(stock) || stock < 1) {
      throw new Error("[PREFLIGHT_BLOCKED] [STOCK_REQUIRED] 库存数量 (stock) 必须显式指定且必须 >= 1，严禁发布器擅自猜测默认库存！");
    }

    // 8. 显式发货地校验 (闲管家必填字段，且有记忆上一件商品的黏性污染风险，必须显式指定)
    const location = options.location || pkg.location;
    if (!location || typeof location !== "string" || location.trim().length === 0) {
      throw new Error("[PREFLIGHT_BLOCKED] [LOCATION_REQUIRED] 发货地 (location) 为必填字段。为防止闲管家页面记忆上一件商品的黏性发货地污染，必须显式指定！");
    }

    return true;
  }

  /**
   * 防重复发布与不确定状态对账检查 (assertNotDuplicatePublish)
   */
  static assertNotDuplicatePublish(pkg, existingReceipts = [], options = {}) {
    const matched = existingReceipts.filter(r => r.package_id === pkg.package_id || r.package_hash === pkg.package_hash);
    
    // 检查 outer_id 是否与其他 package_hash 产生碰撞
    const currentOuterId = `XYAI-${(pkg.package_hash || "").slice(0, 8).toUpperCase()}`;
    const collision = existingReceipts.find(r => 
      (r.outer_id === currentOuterId || r.meta?.outer_id === currentOuterId) &&
      r.package_hash && r.package_hash !== pkg.package_hash
    );
    if (collision) {
      throw new Error(`[OUTER_ID_COLLISION] 商家编码 ${currentOuterId} 与已发布包 ${collision.package_id} 产生哈希碰撞！禁止使用同名编码。`);
    }

    // 1. 检查是否存在未决对账状态 (UNKNOWN / NEEDS_RECONCILIATION)
    const pendingReconciliation = matched.find(r => 
      r.status === PublishConfig.STATUS.UNKNOWN || 
      r.status === PublishConfig.STATUS.NEEDS_RECONCILIATION
    );
    if (pendingReconciliation) {
      const outerId = pendingReconciliation.outer_id || pendingReconciliation.meta?.outer_id || "未知编码";
      throw new Error(`[RECONCILIATION_REQUIRED] 该包上一次发布处于结果不确定状态 (${pendingReconciliation.status}, 商家编码: ${outerId})！网络异常不等于发布失败，严禁自动重试！请先至闲管家列表核对后再做处理。`);
    }

    // 2. 检查是否已经线上发布确认 (PUBLISHED_CONFIRMED)
    const confirmedPublish = matched.find(r => r.status === PublishConfig.STATUS.PUBLISHED_CONFIRMED);
    if (confirmedPublish) {
      throw new Error(`[DUPLICATE_PUBLISH_BLOCKED] 该包已在 ${confirmedPublish.published_at} 成功发布上架到平台 (单号: ${confirmedPublish.platform_item_id})，禁止重复上架！`);
    }

    // 3. 检查草稿箱重复保护
    const allowDraftRepeat = options.allowDraftRepeat ?? true;
    const existingDraft = matched.find(r => r.status === PublishConfig.STATUS.DRAFT_SAVED);
    if (existingDraft && !allowDraftRepeat) {
      throw new Error(`[DUPLICATE_DRAFT_BLOCKED] 该包已在草稿箱存在 (单号: ${existingDraft.platform_draft_id})，未开启草稿重复覆盖模式！`);
    }

    return true;
  }
}
