import { InvariantViolationError } from "./invariants-guard.js";

/**
 * CrossMediaConsistencyGuard - 跨媒体事实一致性守卫 (不变量 13)
 * 遵循 P4 终审准则：
 * 保证标题 (Title)、详情 (Description)、封面配图 (CoverCopy) 与图片规划方案 (ImagePlan) 中的核心事实与数量完全一致，
 * 严禁出现“标题写162节、详情写120节、封面写200节”或“首图写5000+、详情写3000+”的跨媒体分裂。
 */
export const CrossMediaConsistencyGuard = {
  /**
   * 跨媒体一致性主校验入口
   * @param {object} listingContent 文案对象
   * @param {object} imagePlan 图片规划对象
   */
  assertCrossMediaConsistency(listingContent, imagePlan) {
    if (!listingContent || !imagePlan) return;

    const title = listingContent.title || "";
    const desc = listingContent.description || "";
    const coverHeadline = listingContent.cover_copy?.headline || "";
    const coverSub = listingContent.cover_copy?.subheadline || "";
    const mainImgHeadline = imagePlan.main_image?.headline_text || "";
    const mainImgSub = imagePlan.main_image?.subheadline_text || "";

    // 1. 提取各媒体载体中的数量规格特征
    const quantityPattern = /([0-9]+[+]?(?:节|套|条|个|张|款|页|G|GB|MB|件))/g;

    const titleNums = title.match(quantityPattern) || [];
    const descNums = desc.match(quantityPattern) || [];
    const coverNums = `${coverHeadline} ${coverSub}`.match(quantityPattern) || [];
    const imagePlanNums = `${mainImgHeadline} ${mainImgSub}`.match(quantityPattern) || [];

    // 2. 跨媒体交叉核对：若某个载体明确声称了某一数量，其他出现同单位数量的载体必须完全一致
    const mediaSources = [
      { name: "标题 (Title)", numbers: titleNums },
      { name: "详情文案 (Description)", numbers: descNums },
      { name: "封面文案 (CoverCopy)", numbers: coverNums },
      { name: "图片主图规划 (ImagePlan)", numbers: imagePlanNums }
    ];

    // 按量词单位聚合（例如 "节"、"套"）
    const unitMap = new Map(); // unit -> Set of values (e.g. '节' -> Set(['162节', '120节']))

    for (const media of mediaSources) {
      for (const num of media.numbers) {
        const unit = num.replace(/^[0-9+]+/, "");
        if (!unitMap.has(unit)) {
          unitMap.set(unit, new Map());
        }
        const valMap = unitMap.get(unit);
        if (!valMap.has(num)) {
          valMap.set(num, []);
        }
        valMap.get(num).push(media.name);
      }
    }

    // 检查同一单位是否存在不同的具体数值声明
    for (const [unit, valMap] of unitMap.entries()) {
      if (valMap.size > 1) {
        const conflictDetails = Array.from(valMap.entries())
          .map(([val, sources]) => `${sources.join(" & ")} 声明为 "${val}"`)
          .join("；");

        throw new InvariantViolationError(
          "CROSS_MEDIA_FACT_CONFLICT",
          `检测到跨媒体关键事实冲突 (不变量 13 拦截)：针对单位 "${unit}"，${conflictDetails}！必须共用同一套事实声明！`
        );
      }
    }

    // 3. 检查封面主标题与图片规划主标题语义一致性
    if (coverHeadline && mainImgHeadline) {
      // 若两者差异极大且毫无重合词汇，予以预警或阻断
      const cleanCover = coverHeadline.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      const cleanImg = mainImgHeadline.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "");
      
      const hasOverlap = Array.from(cleanCover).some(char => cleanImg.includes(char));
      if (!hasOverlap && cleanCover.length > 2 && cleanImg.length > 2) {
        throw new InvariantViolationError(
          "CROSS_MEDIA_FACT_CONFLICT",
          `封面文案主标题 ("${coverHeadline}") 与主图规划核心标题 ("${mainImgHeadline}") 存在严重语义偏离，未保持视觉与文字一致性！`
        );
      }
    }
  }
};

export default CrossMediaConsistencyGuard;
