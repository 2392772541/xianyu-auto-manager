import crypto from "node:crypto";
import {
  RightsStatus,
  FulfillmentStatus,
  DeliveryType
} from "../constants/enums.js";
import { validateData } from "../validators/schema-validator.js";
import { InvariantsGuard, InvariantViolationError } from "../validators/invariants-guard.js";

/**
 * SellableOffer 管理器
 * 负责我方实际可售商品/交付包的构建、资产绑定与履约核验
 * 严格执行“同行页面不等于我方事实”、“禁止系统自动将同行宣称标记为已核验”
 */
export class SellableOfferManager {
  /**
   * 生成合规的 offer_id (符合 ^offer_[a-zA-Z0-9_-]{8,32}$ 规范)
   */
  static generateOfferId() {
    return `offer_${crypto.randomBytes(8).toString("hex")}`;
  }

  /**
   * 基于参考商品创建草稿 (创建之初强制为未核验状态)
   * @param {object} sourceProduct 只读参考商品
   * @param {object} [draftData] 用户或系统提供的初始化草稿数据
   * @returns {object} SellableOffer 草稿实体
   */
  static createDraftOffer(sourceProduct, draftData = {}) {
    if (!sourceProduct || !sourceProduct.source_product_id) {
      throw new Error("必须提供合法的 sourceProduct 实例");
    }

    const offerId = draftData.offer_id || this.generateOfferId();

    // 默认或辅助填写的实际内容条目
    let actualContents = [];
    if (Array.isArray(draftData.actual_contents) && draftData.actual_contents.length > 0) {
      actualContents = draftData.actual_contents.map(item => ({
        item_name: String(item.item_name || "待确认文件/条目"),
        format: String(item.format || "unknown"),
        ...(item.count !== undefined ? { count: Number(item.count) } : { count: 1 }),
        ...(item.size_bytes !== undefined ? { size_bytes: Number(item.size_bytes) } : {}),
        remarks: item.remarks || "[待人工核对实际文件]"
      }));
    } else {
      // 默认空条目等待用户录入真实资产
      actualContents = [
        {
          item_name: "待核对可交付资产",
          format: "TBD",
          count: 1,
          remarks: "[辅助占位：需人工或资产扫描确认我方真实文件]"
        }
      ];
    }

    // 严禁在创建草稿时自动标记为已核验或已确认
    const offer = {
      offer_id: offerId,
      source_product_id: sourceProduct.source_product_id,
      actual_contents: actualContents,
      fulfillment_type: draftData.fulfillment_type || DeliveryType.OTHER,
      fulfillment_assets: Array.isArray(draftData.fulfillment_assets) ? draftData.fulfillment_assets : [],
      rights_status: draftData.rights_status || RightsStatus.UNKNOWN,
      quantity_verified: false,
      deliverable_verified: false,
      fulfillment_status: FulfillmentStatus.NOT_CHECKED,
      human_confirmed: false
    };

    // 守卫校验
    InvariantsGuard.assertSellableOfferNotBlindlyCopied(offer, sourceProduct);

    // Schema 校验
    const validation = validateData("sellable-offer.schema.json", offer);
    if (!validation.valid) {
      throw new Error(`SellableOffer 草稿未通过 Schema 验证: ${validation.formattedErrors}`);
    }

    return offer;
  }

  /**
   * 为可售商品绑定履约资产 (网盘链接/卡密池/本地文件等)
   * @param {object} offer SellableOffer 实例
   * @param {object} asset 资产对象 { asset_type, location_reference, checksum }
   */
  static addFulfillmentAsset(offer, asset) {
    if (!asset || !asset.asset_type || !asset.location_reference) {
      throw new Error("资产对象必须包含 asset_type 与 location_reference");
    }
    const validAssetTypes = ["NETDISK_LINK", "CARD_KEY_POOL", "LOCAL_ARCHIVE", "SERVICE_ACCOUNT"];
    if (!validAssetTypes.includes(asset.asset_type)) {
      throw new Error(`不支持的 asset_type: ${asset.asset_type}`);
    }

    offer.fulfillment_assets = offer.fulfillment_assets || [];
    offer.fulfillment_assets.push({
      asset_type: asset.asset_type,
      location_reference: asset.location_reference,
      ...(asset.checksum ? { checksum: asset.checksum } : {})
    });

    const validation = validateData("sellable-offer.schema.json", offer);
    if (!validation.valid) {
      throw new Error(`绑定资产后 SellableOffer 格式不合法: ${validation.formattedErrors}`);
    }
    return offer;
  }

  /**
   * 人工/实测对可售商品进行核验与状态确认
   * @param {object} offer 待核验的 SellableOffer
   * @param {object} sourceProduct 对应的只读参考商品
   * @param {object} verificationDetails 核验细节
   * @returns {object} 核验后的 SellableOffer
   */
  static verifyAndConfirm(offer, sourceProduct, verificationDetails = {}) {
    InvariantsGuard.assertSellableOfferNotBlindlyCopied(offer, sourceProduct);

    const {
      rights_status = RightsStatus.USER_OWNED,
      quantity_verified = false,
      deliverable_verified = false,
      confirmed_by = "operator_audit",
      actual_contents
    } = verificationDetails;

    // 若核验声明可交付，必须存在真实的履约资产支撑
    if (deliverable_verified && (!offer.fulfillment_assets || offer.fulfillment_assets.length === 0)) {
      throw new InvariantViolationError(
        "DELIVERABLE_VERIFIED_WITHOUT_ASSETS",
        "声明 deliverable_verified=true 必须绑定至少一个履约资产 (fulfillment_assets)"
      );
    }

    if (Array.isArray(actual_contents) && actual_contents.length > 0) {
      offer.actual_contents = actual_contents;
    }

    offer.rights_status = rights_status;
    offer.quantity_verified = Boolean(quantity_verified);
    offer.deliverable_verified = Boolean(deliverable_verified);
    offer.human_confirmed = true;
    offer.confirmed_by = confirmed_by;
    offer.confirmed_at = new Date().toISOString();

    // 判定履约准备度
    if (
      offer.deliverable_verified &&
      offer.quantity_verified &&
      offer.fulfillment_assets.length > 0 &&
      offer.rights_status !== RightsStatus.NOT_AUTHORIZED
    ) {
      offer.fulfillment_status = FulfillmentStatus.READY;
    } else if (offer.fulfillment_assets.length > 0) {
      offer.fulfillment_status = FulfillmentStatus.INCOMPLETE;
    } else {
      offer.fulfillment_status = FulfillmentStatus.UNAVAILABLE;
    }

    // 最终守卫与 Schema 检验
    InvariantsGuard.assertSellableOfferNotBlindlyCopied(offer, sourceProduct);
    const validation = validateData("sellable-offer.schema.json", offer);
    if (!validation.valid) {
      throw new Error(`核验确认后 SellableOffer 未通过 Schema 验证: ${validation.formattedErrors}`);
    }

    return offer;
  }
}

export default SellableOfferManager;
