import { StrategyChangeScope } from "../constants/enums.js";
import { InvariantViolationError } from "./invariants-guard.js";

/**
 * StrategyGuard - 策略质量与安全不变量守卫
 * 遵循 P3 终审准则：
 * - Invariant 8: 策略绝不允许擅自修改 SellableOffer 商品事实；
 * - Invariant 9: 1~3 个候选策略必须存在实质性定位与人群差异，禁止同义换皮；
 * - Invariant 10: 策略中的事实声明必须有证据支撑，严禁篡改作用域；
 * - Invariant 11: 策略选择 (STRATEGY_SELECTION) V1 必须由人工显式指定，严禁隐式自动推进。
 */
export const StrategyGuard = {
  /**
   * 检查策略是否擅自扩充或篡改我方可售事实
   * @param {object} strategySet 策略集合
   * @param {object} sellableOffer 我方实际可售商品
   */
  assertStrategyDoesNotMutateOfferFacts(strategySetOrStrat, sellableOffer) {
    if (!strategySetOrStrat) return;
    const strategySet = Array.isArray(strategySetOrStrat) ? { strategies: strategySetOrStrat } : (Array.isArray(strategySetOrStrat.strategies) ? strategySetOrStrat : { strategies: [strategySetOrStrat] });
    if (!sellableOffer) return;

    const actualContents = sellableOffer.actual_contents || [];
    const actualText = actualContents.join(" ");

    for (const strat of strategySet.strategies) {
      // 若策略试图要求改变交付物形态或增加实体赠品，必须显式标注为 PRODUCT_CHANGE_REQUIRED
      if (strat.strategy_change_scope === StrategyChangeScope.PRODUCT_CHANGE_REQUIRED) {
        // 允许标记，但提示后续必须转 HUMAN_INPUT
        continue;
      }

      // 如果策略声称包含某些赠品或特定规格，检查是否违背了 SellableOffer 实际内容
      const angle = strat.main_selling_angle || "";
      const pos = strat.positioning || "";
      const textToCheck = angle + " " + pos;

      // 常见越界关键词：附赠、赠送、包含源码、终身答疑、一对一指导等（若我方未核验则禁止作为确定性卖点）
      const unauthorizedPromises = ["送源码", "附送模板", "一对一辅导", "赠送社群", "终身包更新"];
      for (const promise of unauthorizedPromises) {
        if (textToCheck.includes(promise) && !actualText.includes(promise)) {
          throw new InvariantViolationError(
            "STRATEGY_UNAUTHORIZED_FACT_MUTATION",
            `策略 [${strat.strategy_id}] 私自增加了未核验交付内容 "${promise}"，且未标记为 PRODUCT_CHANGE_REQUIRED，已被拦截！`
          );
        }
      }
    }
  },

  /**
   * 检查多个策略之间是否具备实质性差异
   * @param {object} strategySet
   */
  assertStrategiesSubstantiveDifference(strategiesOrSet) {
    const set = Array.isArray(strategiesOrSet) ? { strategies: strategiesOrSet } : strategiesOrSet;
    return this.assertStrategyDiversity(set);
  },

  assertStrategyDiversity(strategySet) {
    if (Array.isArray(strategySet)) strategySet = { strategies: strategySet };
    if (!strategySet || !Array.isArray(strategySet.strategies)) return;
    const strats = strategySet.strategies;
    if (strats.length <= 1) return;

    for (let i = 0; i < strats.length; i++) {
      for (let j = i + 1; j < strats.length; j++) {
        const s1 = strats[i];
        const s2 = strats[j];

        const sameTarget = s1.target_customer.trim() === s2.target_customer.trim();
        const sameAngle = s1.main_selling_angle.trim() === s2.main_selling_angle.trim();
        const samePositioning = s1.positioning.trim() === s2.positioning.trim();

        if (sameTarget && sameAngle && samePositioning) {
          throw new InvariantViolationError(
            "REDUNDANT_STRATEGY_GENERATED",
            `策略 [${s1.strategy_id}] 与 [${s2.strategy_id}] 存在完全重复的定位与卖点，未达到实质性差异化要求！`
          );
        }
      }
    }
  },

  /**
   * 检查选中的策略是否合法且可进入下游
   * @param {object} strategySet 策略集合
   * @param {string} selectedStrategyId 人工或显式选定的策略 ID
   * @param {object} [options]
   */
  assertSelectedStrategyValid(strategySet, selectedStrategyId, options = {}) {
    if (!selectedStrategyId || typeof selectedStrategyId !== "string") {
      throw new InvariantViolationError(
        "MISSING_SELECTED_STRATEGY_ID",
        "V1 规则：STRATEGY_SELECTION 阶段必须显式提供选定的策略 ID (selected_strategy_id)，严禁隐式自动选择推进！"
      );
    }

    const matchedStrategy = (strategySet?.strategies || []).find(s => s.strategy_id === selectedStrategyId);
    if (!matchedStrategy) {
      throw new InvariantViolationError(
        "UNKNOWN_SELECTED_STRATEGY",
        `选定的策略 ID [${selectedStrategyId}] 不在当前候选策略列表中！`
      );
    }

    // 若策略需要商品实体变更，检查是否已经获得人工确认
    if (matchedStrategy.strategy_change_scope === StrategyChangeScope.PRODUCT_CHANGE_REQUIRED) {
      if (!options.human_confirmed_product_change) {
        throw new InvariantViolationError(
          "PRODUCT_CHANGE_REQUIRED_BLOCKED",
          `选定策略 [${selectedStrategyId}] 标记为 PRODUCT_CHANGE_REQUIRED（需要产品变动），必须由人工在 HUMAN_INPUT 阶段核验并更新 SellableOffer，严禁直接进入 ContentGeneration！`
        );
      }
    }

    return matchedStrategy;
  }
};

export default StrategyGuard;
