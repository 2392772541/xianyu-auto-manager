import { RightsStatus, AssetAllowedUsage, AssetOrigin } from "../constants/enums.js";

/**
 * AssetRightsManager - 素材级权利与用途评估管理器
 * 遵循 P4 终审要求：将版权与使用权从商品级下沉至具体资产级 (Asset-level)
 */
export class AssetRightsManager {
  /**
   * 构造受控素材资产项
   */
  static createAssetRecord({
    asset_id,
    origin = AssetOrigin.SOURCE_PRODUCT,
    rights_status = RightsStatus.UNKNOWN,
    allowed_usage = null,
    file_name = "",
    sha256 = ""
  }) {
    // 确定性推导 allowed_usage
    let usage = allowed_usage;
    if (!usage) {
      if (rights_status === RightsStatus.USER_OWNED) {
        usage = AssetAllowedUsage.DIRECT_USE;
      } else if (rights_status === RightsStatus.LICENSED) {
        usage = AssetAllowedUsage.EDIT_ALLOWED;
      } else if (rights_status === RightsStatus.NOT_AUTHORIZED) {
        usage = AssetAllowedUsage.PROHIBITED;
      } else {
        // UNKNOWN 或默认同行素材 -> 只能参考构图信息，绝不能直接发布
        usage = AssetAllowedUsage.REFERENCE_ONLY;
      }
    }

    return Object.freeze({
      asset_id,
      file_name,
      origin,
      rights_status,
      allowed_usage: usage,
      sha256
    });
  }

  /**
   * 依据 SourceProduct 图片素材列表和全局权利状态构建资产权利清单
   * @param {object} sourceProduct
   * @param {string} [defaultRightsStatus]
   * @returns {Array<object>}
   */
  static resolveAssetsFromSourceProduct(sourceProduct, defaultRightsStatus = RightsStatus.UNKNOWN) {
    const images = sourceProduct?.source_images || [];
    return images.map((img, idx) => {
      const assetId = `ast_${String(idx + 1).padStart(3, "0")}`;
      return this.createAssetRecord({
        asset_id: assetId,
        origin: AssetOrigin.SOURCE_PRODUCT,
        rights_status: defaultRightsStatus,
        file_name: img.file_name,
        sha256: img.sha256 || ""
      });
    });
  }
}

export default AssetRightsManager;
