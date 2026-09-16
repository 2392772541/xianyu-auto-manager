import { StrategyGuard } from "../validators/strategy-guard.js";

/**
 * StrategySelectionManager - 重制策略选择管理器
 * 遵循 P3 终审准则：
 * 1. STRATEGY_SELECTION 阶段在 V1 必须由人工显式确认与选定 (HUMAN 驱动)；
 * 2. 严禁隐式自动选择推进下游；
 * 3. 产出结构化的选择记录与不可变策略快照，供下游 ContentGenerator 单独消费。
 */
export class StrategySelectionManager {
  /**
   * 兼容方法：通过参数对象确认选定策略
   */
  static confirmStrategy({ sourceProductId, availableStrategies, selectedStrategyId, operator, reason, notes, human_confirmed_product_change }) {
    const strategySet = {
      source_product_id: sourceProductId,
      proposed_strategy_id: availableStrategies?.[0]?.strategy_id,
      strategies: availableStrategies || []
    };
    return this.selectStrategy(strategySet, selectedStrategyId, {
      operator,
      notes: reason || notes,
      human_confirmed_product_change
    });
  }

  /**
   * 记录并校验人工选定的重制策略
   * @param {object} strategySet 策略集合
   * @param {string} selectedStrategyId 人工选定的策略 ID
   * @param {object} options
   * @param {string} [options.operator] 操作人
   * @param {string} [options.notes] 选择理由或备注
   * @param {boolean} [options.human_confirmed_product_change] 若策略需变动产品，是否已人工确认
   * @returns {object} 结构化的策略选择记录
   */
  static selectStrategy(strategySet, selectedStrategyId, options = {}) {
    if (!strategySet || !Array.isArray(strategySet.strategies)) {
      throw new Error("StrategySelectionManager: 无效的 strategySet 输入");
    }

    // 通过 StrategyGuard 进行安全与合法性强校验
    const matchedStrategy = StrategyGuard.assertSelectedStrategyValid(
      strategySet,
      selectedStrategyId,
      options
    );

    const selectionRecord = {
      source_product_id: strategySet.source_product_id,
      selected_strategy_id: selectedStrategyId,
      proposed_strategy_id: strategySet.proposed_strategy_id,
      is_concurred_with_ai: selectedStrategyId === strategySet.proposed_strategy_id,
      selection_source: "HUMAN",
      operator: options.operator || "human_reviewer",
      selected_at: new Date().toISOString(),
      notes: options.notes || "人工确认选定该重制方向",
      strategy_snapshot: JSON.parse(JSON.stringify(matchedStrategy))
    };

    return Object.freeze(selectionRecord);
  }
}

export default StrategySelectionManager;
