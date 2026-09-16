import { PublishConfig } from "../models/publish-config.js";

/**
 * 闲管家表单载荷适配器 (XianguanjiaPayloadAdapter)
 * 职责：纯函数，将标准 PendingListingPackage 映射为闲管家前端表单的标准结构
 * 核心准则：严禁修改已有内容、严禁擅自截断、显式透传发货地与库存，生成唯一商家编码用于对账
 */
export class XianguanjiaPayloadAdapter {
  /**
   * 将待发布包适配为闲管家表单载荷
   */
  static adapt(pkg, options = {}) {
    // 1. 标题标准化 (仅清除换行符和首尾空格，严禁截断语义！超长已在 Preflight 拦截)
    const formattedTitle = (pkg.title || "").trim().replace(/[\r\n]+/g, " ");

    // 2. 详情描述规范化 (保持人工核准正文无语义改动，结构化附带亮点与交付说明)
    let descriptionBlocks = [];
    if (pkg.description) {
      descriptionBlocks.push(pkg.description.trim());
    }
    if (Array.isArray(pkg.selling_points) && pkg.selling_points.length > 0) {
      descriptionBlocks.push("\n【商品亮点】\n" + pkg.selling_points.map((p, idx) => `${idx + 1}. ${p}`).join("\n"));
    }
    if (pkg.delivery_note) {
      descriptionBlocks.push("\n【交付与售后】\n" + pkg.delivery_note.trim());
    }
    const fullDescription = descriptionBlocks.join("\n");

    // 3. 价格提取 (已在 Preflight 严格校验有效性)
    const price = options.price ?? pkg.listing_content?.price ?? pkg.selected_strategy?.price_strategy?.recommended_price;

    // 4. 库存与发货地 (显式提供，严禁发布器随意猜测)
    const stock = options.stock ?? pkg.stock;
    const location = (options.location || pkg.location).trim();

    // 5. 物流与发货模式
    let isVirtual = options.isVirtual;
    if (isVirtual === undefined) {
      const fulfillStr = pkg.fulfillment_summary || "";
      const descStr = pkg.description || "";
      const titleStr = pkg.title || "";
      if (fulfillStr.includes("NETDISK") || descStr.includes("网盘") || titleStr.includes("网盘") || fulfillStr.includes("CARD_PASSWORD")) {
        isVirtual = true;
      } else if (fulfillStr.includes("EXPRESS") || descStr.includes("自提") || descStr.includes("快递") || descStr.includes("现货") || descStr.includes("相机")) {
        isVirtual = false;
      } else {
        isVirtual = descStr.includes("教程") || descStr.includes("课程") || descStr.includes("SOP") || descStr.includes("资料");
      }
    }
    const shippingType = options.shippingType || (isVirtual ? "NO_SHIPPING_REQUIRED" : "EXPRESS_AND_LOCAL");

    // 6. 生成唯一商家编码 outer_id 用于闲管家对账 (基于 package_hash 前 8 位)
    const shortHash = (pkg.package_hash || "HASH").slice(0, 8).toUpperCase();
    const outerId = `XYAI-${shortHash}`;

    // 7. 图片资产收集
    const images = Array.isArray(pkg.asset_refs) ? [...pkg.asset_refs] : [];

    return {
      package_id: pkg.package_id,
      version_id: pkg.version_id,
      outer_id: outerId,
      form_data: {
        title: formattedTitle,
        description: fullDescription,
        price: Number(Number(price).toFixed(2)),
        stock: Math.floor(stock),
        location: location,
        is_virtual: isVirtual,
        shipping_type: shippingType,
        outer_id: outerId,
        target_shop: options.targetShop || pkg.target_shop || null,
        images: images,
        keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
        cover_headline: pkg.cover_copy?.headline || "",
        cover_subheadline: pkg.cover_copy?.subheadline || ""
      },
      raw_package_hash: pkg.package_hash
    };
  }
}
