/**
 * 闲管家发布层配置与状态契约 (PublishConfig)
 */
export const PublishConfig = {
  // 默认发布方式：首选 DRAFT（存为草稿箱，安全可逆可人工复查），可选 IMMEDIATE（立即发布）
  DEFAULT_PUBLISH_MODE: "DRAFT",

  // 闲鱼/闲管家标题长度硬上限：最多 30 个汉字/全角字符
  MAX_TITLE_CHARS: 30,

  // 本地安全上限（非官方硬限制，作为本地防溢出保守安全上限）
  LOCAL_SAFETY_MAX_DESCRIPTION_CHARS: 1000,

  // 发布状态枚举 (精细化状态机，拒绝简单二元 SUCCESS/FAILED)
  STATUS: {
    DRAFT_SAVED: "DRAFT_SAVED", // 安全存入闲管家草稿箱
    SUBMITTED: "SUBMITTED", // 已点击提交，待进一步状态确认
    PUBLISHED_CONFIRMED: "PUBLISHED_CONFIRMED", // 确认在线上架成功
    FAILED_CONFIRMED: "FAILED_CONFIRMED", // 确认失败（表单校验失败、参数错误等确定性失败）
    UNKNOWN: "UNKNOWN", // 结果未知（网络中断/响应超时，服务端状态不确定）
    NEEDS_RECONCILIATION: "NEEDS_RECONCILIATION" // 需要人工或列表二次核对，禁止自动重试
  },

  // 默认账本路径 (使用 jsonl 格式，逐行原子追加防止重写损坏)
  DEFAULT_LEDGER_PATH: "商品重制输出/publish_receipts.jsonl"
};
