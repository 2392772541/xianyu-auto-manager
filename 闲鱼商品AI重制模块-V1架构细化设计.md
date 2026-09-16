
# 闲鱼商品 AI 重制模块 V1：数据模型、Workflow 与 AI 节点契约细化与冻结规范（V1.0.0-final-freeze）

> **规范版本**：`V1.0.0-final-freeze`（架构终版冻结）  
> **制定日期**：2026-09-16  
> **适用工程**：闲鱼自动铺货助手 / `downloader/ai-remake/`  
> **技术栈约束**：纯 Electron + Node.js + 文件系统/JSON 单技术栈；零 Python，零外置数据库；原始采集素材永久只读。  
> **评审收敛说明**：本版本基于资深产品架构师专家评审意见，完成了 9 大关键收敛：
> 1. **解耦 SellableOffer（实际可售履约包）**：建立参考源（同行商品）与履约源（我方实售）的物理隔离，事实性营销描述必须受真实交付资产硬约束。
> 2. **解耦 ProductDNA 与 ProductScorecard**：商品事实认知与主观商业评价彻底分离，评分规则调整不影响底层事实模型。
> 3. **评分去伪精确与指标重塑**：废除 0–100 伪精确分，降级为 1–5 分制真实可度量指标；策略层将空想的 `why_it_can_win` 调整为事实支撑的 `why_this_strategy_is_plausible`。
> 4. **显式策略选择节点（STRATEGY_SELECTION）**：消除策略选择前后矛盾，AI 提议推荐策略，文案生成严格消费选定策略。
> 5. **拆分人工介入职责**：过程交互（`HUMAN_INPUT`：信息补齐、DROP争议复议、策略选择、履约资产核验）与出库终审门禁（`HUMAN_REVIEW`：APPROVE / REJECT / REQUEST_REVISION）彻底分工。
> 6. **证据链按声明性质分级（Claim Nature）**：事实（FACT）严格执行 100% 证据链倒查，推断（INFERENCE）与修辞（MARKETING_EXPRESSION）遵守合规与合理性边界，避免营销死锁。
> 7. **虚拟商品现实双门禁**：版权状态（`rights_status` 未明严禁 KEEP 原图）与履约状态（`fulfillment_status` 未达 READY 严禁出库发布）。
> 8. **确定性规则流转**：废除未经校准的模型置信度硬门槛，以 6 项确定性规则矩阵作为流转依据。
> 9. **清理冗余版本定义**：彻底消除版本模型重复章节，确立唯一权威 Canonical Schema。

---

## 0. 本文要解决什么

本文承接《闲鱼商品AI重制模块-V1架构调研.md》，不展开讨论“为什么要做重制”，而是直接将“商品采集完成后的 AI 重制模块”落盘为**可直接指导 Node.js 编码的数据模型、状态机契约与接口规范**。

### 核心要解决的产品与工程问题：

1. **避免盲目文案生成**：严禁大模型在没有理解商品交付本质的情况下直接输出营销话术，必须先提取客观的 `Product DNA`。
2. **切断虚假承诺与履约风险**：同行商品页面（`SourceProduct`）仅代表市场参考和素材来源，不代表我方实际拥有的交付物。建立独立实体的 `SellableOffer`，文案事实必须与我方实际履约物 100% 对齐。
3. **主客观解耦**：商品事实（DNA）与商业判断（Scorecard）解耦，评分规则演进时无需重跑底层理解。
4. **消除伪精确与幻觉**：单商品重制无全网大盘数据，废除 0–100 评分，改用 1–5 分制单商品可观察指标；将胜率幻想改为基于证据的合理性论述。
5. **流程确定性与可控性**：固定 Workflow 编排专用 AI 节点，策略由人工显式选定或规则明确驱动，杜绝全自动黑盒 Agent 失控。
6. **分级证据链防死锁**：区分事实、推论、修辞与合规披露，事实百分之百证据倒查，营销修辞守底线防夸大。
7. **数据资产不可变**：原始采集素材只读零改写；中间草稿使用 `Revision` 审计；正式成果固化为 `Version`，随时可复盘。

---

# 第一部分：领域模型与统一术语

## 1.1 核心实体

| 术语 | 精确定义 | 是否可修改 |
|---|---|---:|
| `SourceProduct` | 采集模块生成的原始商品目录及其清单 | 永远只读 |
| `SourceManifest` | 对原始标题、描述、图片哈希、采集完整性等计算出的来源快照 | 不可修改；来源变化时生成新快照 |
| `ProductDNA` | 对一个来源快照的客观结构化理解、核心资产和风险说明 | AI 输出不可覆盖；变更产生新 Revision |
| `SellableOffer` | 我方实际拥有、已核验且能交付的真实可售商品资产包 | 版本化保存；履约未就绪禁止出库 |
| `ProductScorecard` | Product Scorer 对 Product DNA 与履约基础给出的独立商业评价卡 | 独立保存；评分策略调整时单独重跑 |
| `ProductRemakeStrategy` | 某个商品的一种具体重制定位方向 | 版本化保存，1~3 个候选，经选择后生效 |
| `RemakeJob` | 用户对一个 SourceProduct 发起的一次完整重制任务 | 状态可推进，历史事件只能追加 |
| `RemakeRevision` | Job 内一次不可变的 AI/人工编辑结果快照 | 不可修改；修改或重跑产生下一 Revision |
| `ProductVersion` | 经人工终审批准、满足履约与权利门禁后固化为可导出的正式快照 | 不可覆盖；新批准产生新 Version |
| `Claim` | 从 DNA、策略、文案或图片中抽取的原子化声明实体（含声明性质） | 版本化保存 |
| `Evidence` | 支持、削弱或反驳某个 Claim 的来源证据 | 原始证据不可修改，人工确认需记录留痕 |
| `PendingListingPackage` | 已批准并固化的待发布数据包 | V1 状态固定为 NOT_PUBLISHED，不等于已发布 |

## 1.2 四个关键业务与技术边界

### 边界一：Product DNA 不是销售文案
Product DNA 回答“这是什么、包含什么、面向谁、有何风险”，是系统对商品的客观认知底座。它严禁包含情绪化营销修辞，严禁引入原始素材不存在的事实。

### 边界二：参考商品事实（同行页面）≠ 实际交付能力（我方履约包）
同行页面写了“5000条提示词+20套工作流+永久更新”，AI 只能证明“同行确实这么写了”，绝不能证明“我方手里真有这套资料并能永久更新”。所有事实性营销声明必须以我方 `SellableOffer` 实际核验的资产为准；若履约资产未达 `READY`，严禁导出发布。

### 边界三：商品事实理解（Product DNA）与商业价值评价（Product Scorecard）彻底解耦
Product DNA 表达客观事实与理解，Product Scorecard 表达主观商业看法。商业评分标准、淘汰策略的改动只需重跑 Scorer 节点，不得污染或重新生成底层的 Product DNA。

### 边界四：启发式评价不是市场事实，拒绝伪精确
V1 不联网爬取全网竞争对手和真实大盘销量。评分系统采用 1–5 分制可观察指标，拒绝 0–100 伪精确打分。Revision 是技术与审核流转中的草稿快照，Version 是人工终审签发后的正式发布物，二者严禁混淆。

---

# 第二部分：Product DNA、SellableOffer 与 ProductScorecard 模型

## 2.1 实体协作生命周期图

```text
SourceProduct（只读采集源）
  │
  ▼
SourceManifest（只读快照）
  │
  ▼
Product Analyst ──► ProductDNA（客观事实理解与资产盘点）
                            │
我方资产导入/核验 ──► SellableOffer（实际可售履约包）
                            │
                            ▼
Product Scorer   ──► ProductScorecard（1-5分制商业评价，KEEP/REMAKE/DROP）
                            │
                            ▼
Strategy Generator ─► StrategySet（1~3 个重制候选策略 + proposed_strategy_id）
                            │
                            ▼
STRATEGY_SELECTION ─► 选定 selected_strategy_id（人工确认或显式规则选定）
                            │
                            ▼
Content Generator  ─► ContentDraft（新标题/文案/卖点，严格基于选定策略与履约事实）
                            │
                            ▼
Image Planner      ─► ImagePlan（主图/详情图方案，受 rights_status 约束，不制图）
                            │
                            ▼
Validation Engine  ─► ValidationReport（事实覆盖 100%，履约 READY 门禁）
                            │
                            ▼
HUMAN_REVIEW       ─► APPROVE ──► ProductVersion（待发布出库包）
```

## 2.2 Product DNA JSON Schema

规范：JSON Schema Draft 2020-12。解耦商业评分，专注于客观事实提取与风险识别。


```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.xianyu-ai/schemas/product-dna.v1.schema.json",
  "title": "ProductDNA",
  "description": "针对不可变 SourceManifest 生成的客观商品理解、核心资产和风险信息快照（解耦主观商业评分）。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "product_dna_id",
    "job_id",
    "revision_id",
    "source_manifest_sha256",
    "source_product_id",
    "source_url",
    "source_title",
    "source_description",
    "source_images",
    "source_price",
    "source_quality",
    "product_type",
    "product_category",
    "target_customer",
    "customer_problem",
    "purchase_motivation",
    "usage_scenario",
    "core_content",
    "core_benefits",
    "selling_points",
    "keywords",
    "delivery_type",
    "rights_status",
    "risk_flags",
    "unsupported_claims",
    "missing_information",
    "need_human_review",
    "evidence_ids",
    "sellable_offer_ref",
    "created_at"
  ],
  "properties": {
    "schema_version": {
      "const": "1.0",
      "description": "契约版本。",
      "x-origin": "SYSTEM"
    },
    "product_dna_id": {
      "type": "string",
      "pattern": "^dna_[A-Za-z0-9_-]+$",
      "description": "DNA 快照唯一 ID。",
      "x-origin": "SYSTEM"
    },
    "job_id": {
      "type": "string",
      "pattern": "^job_[A-Za-z0-9_-]+$",
      "description": "所属任务。",
      "x-origin": "SYSTEM"
    },
    "revision_id": {
      "type": "string",
      "pattern": "^revision_[0-9]{3,}$",
      "description": "产生该 DNA 的 Revision。",
      "x-origin": "SYSTEM"
    },
    "source_manifest_sha256": {
      "type": "string",
      "pattern": "^[A-Fa-f0-9]{64}$",
      "description": "绑定的来源快照哈希。",
      "x-origin": "SYSTEM"
    },
    "source_product_id": {
      "type": "string",
      "minLength": 1,
      "description": "采集系统原商品 ID。",
      "x-origin": "SOURCE"
    },
    "source_url": {
      "type": [
        "string",
        "null"
      ],
      "format": "uri",
      "description": "原商品链接，未知为 null。",
      "x-origin": "SOURCE"
    },
    "source_title": {
      "type": "string",
      "minLength": 1,
      "description": "原标题原样副本。",
      "x-origin": "SOURCE"
    },
    "source_description": {
      "type": "string",
      "description": "原描述原样副本。",
      "x-origin": "SOURCE"
    },
    "source_images": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/sourceImage"
      },
      "description": "原图引用、顺序、尺寸和哈希。",
      "x-origin": "SOURCE"
    },
    "source_price": {
      "oneOf": [
        {
          "$ref": "#/$defs/money"
        },
        {
          "type": "null"
        }
      ],
      "description": "原价格，未知为 null。",
      "x-origin": "SOURCE_OR_HUMAN"
    },
    "source_quality": {
      "$ref": "#/$defs/sourceQuality",
      "description": "采集完整性与质量判断。",
      "x-origin": "SYSTEM_DERIVED"
    },
    "product_type": {
      "type": "string",
      "enum": [
        "PHYSICAL",
        "VIRTUAL_RESOURCE",
        "SERVICE",
        "ACCOUNT_OR_ACCESS",
        "MIXED",
        "UNKNOWN"
      ],
      "description": "商品交付本质。",
      "x-origin": "AI_ANALYSIS"
    },
    "product_category": {
      "$ref": "#/$defs/category",
      "description": "类目判断。",
      "x-origin": "AI_ANALYSIS"
    },
    "target_customer": {
      "type": "array",
      "minItems": 1,
      "maxItems": 5,
      "items": {
        "$ref": "#/$defs/audienceInsight"
      },
      "description": "潜在目标人群，不是买家统计。",
      "x-origin": "AI_ANALYSIS"
    },
    "customer_problem": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "$ref": "#/$defs/insight"
      },
      "description": "商品可能解决的问题。",
      "x-origin": "AI_ANALYSIS"
    },
    "purchase_motivation": {
      "type": "array",
      "maxItems": 8,
      "items": {
        "$ref": "#/$defs/insight"
      },
      "description": "购买动机假设。",
      "x-origin": "AI_ANALYSIS"
    },
    "usage_scenario": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "$ref": "#/$defs/insight"
      },
      "description": "使用场景。",
      "x-origin": "AI_ANALYSIS"
    },
    "core_content": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/coreContent"
      },
      "description": "真正交付的实体、文件、服务或使用权。",
      "x-origin": "AI_ANALYSIS"
    },
    "core_benefits": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/claimAsset"
      },
      "description": "有证据支持的收益。",
      "x-origin": "AI_ANALYSIS"
    },
    "selling_points": {
      "type": "array",
      "maxItems": 10,
      "items": {
        "$ref": "#/$defs/claimAsset"
      },
      "description": "未营销化的候选卖点。",
      "x-origin": "AI_ANALYSIS"
    },
    "keywords": {
      "type": "array",
      "maxItems": 30,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "实体、人群、场景和交付关键词。",
      "x-origin": "AI_ANALYSIS"
    },
    "delivery_type": {
      "type": "string",
      "enum": [
        "PHYSICAL_SHIPPING",
        "DIGITAL_FILE",
        "CLOUD_LINK",
        "ACCOUNT_ACCESS",
        "REMOTE_SERVICE",
        "LOCAL_SERVICE",
        "MIXED",
        "UNKNOWN"
      ],
      "description": "真实交付方式。",
      "x-origin": "SOURCE_OR_AI"
    },
    "rights_status": {
      "type": "string",
      "enum": [
        "USER_OWNED",
        "LICENSED",
        "PUBLIC_DOMAIN",
        "UNKNOWN",
        "NOT_AUTHORIZED"
      ],
      "description": "原始素材与知识产权权利状态。",
      "x-origin": "AI_OR_HUMAN"
    },
    "risk_flags": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/riskFlag"
      },
      "description": "来源、权利、平台、隐私、交付等风险。",
      "x-origin": "AI_OR_SYSTEM"
    },
    "unsupported_claims": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/unsupportedClaim"
      },
      "description": "不得继续使用或需确认的声明。",
      "x-origin": "AI_OR_POLICY"
    },
    "missing_information": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/missingInfo"
      },
      "description": "影响理解、履约或发布的信息缺口。",
      "x-origin": "AI_OR_SYSTEM"
    },
    "need_human_review": {
      "type": "boolean",
      "description": "是否必须人工介入。",
      "x-origin": "SYSTEM_DERIVED"
    },
    "evidence_ids": {
      "type": "array",
      "uniqueItems": true,
      "items": {
        "type": "string",
        "pattern": "^evidence_[A-Za-z0-9_-]+$"
      },
      "description": "DNA 使用的证据 ID 列表。",
      "x-origin": "SYSTEM_DERIVED"
    },
    "sellable_offer_ref": {
      "type": [
        "string",
        "null"
      ],
      "description": "关联的我方实际可售履约包引用，未关联为 null。",
      "x-origin": "SYSTEM"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "description": "快照创建时间。",
      "x-origin": "SYSTEM"
    }
  },
  "$defs": {
    "sourceImage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "image_id",
        "relative_path",
        "sha256",
        "position",
        "width",
        "height",
        "mime_type"
      ],
      "properties": {
        "image_id": {
          "type": "string",
          "pattern": "^image_[A-Za-z0-9_-]+$"
        },
        "relative_path": {
          "type": "string",
          "minLength": 1
        },
        "sha256": {
          "type": "string",
          "pattern": "^[A-Fa-f0-9]{64}$"
        },
        "position": {
          "type": "integer",
          "minimum": 1
        },
        "width": {
          "type": "integer",
          "minimum": 1
        },
        "height": {
          "type": "integer",
          "minimum": 1
        },
        "mime_type": {
          "type": "string",
          "enum": [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif"
          ]
        },
        "is_cover": {
          "type": "boolean"
        },
        "detected_text": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "watermark_detected": {
          "type": "boolean"
        }
      }
    },
    "money": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "currency",
        "amount"
      ],
      "properties": {
        "currency": {
          "type": "string",
          "const": "CNY"
        },
        "amount": {
          "type": "number",
          "minimum": 0
        }
      }
    },
    "sourceQuality": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "status",
        "has_title",
        "has_description",
        "image_count",
        "text_length",
        "ocr_applied",
        "issues"
      ],
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "COMPLETE",
            "PARTIAL",
            "INVALID"
          ]
        },
        "has_title": {
          "type": "boolean"
        },
        "has_description": {
          "type": "boolean"
        },
        "image_count": {
          "type": "integer",
          "minimum": 0
        },
        "text_length": {
          "type": "integer",
          "minimum": 0
        },
        "ocr_applied": {
          "type": "boolean"
        },
        "issues": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "category": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "primary_category",
        "sub_category",
        "confidence"
      ],
      "properties": {
        "primary_category": {
          "type": "string",
          "minLength": 1
        },
        "sub_category": {
          "type": "string",
          "minLength": 1
        },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      }
    },
    "audienceInsight": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "segment",
        "rationale",
        "evidence_ids"
      ],
      "properties": {
        "segment": {
          "type": "string",
          "minLength": 1
        },
        "rationale": {
          "type": "string",
          "minLength": 1
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "insight": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "content",
        "evidence_ids"
      ],
      "properties": {
        "content": {
          "type": "string",
          "minLength": 1
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "coreContent": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "item_name",
        "item_type",
        "quantity",
        "format",
        "evidence_ids"
      ],
      "properties": {
        "item_name": {
          "type": "string",
          "minLength": 1
        },
        "item_type": {
          "type": "string",
          "enum": [
            "DOCUMENT",
            "VIDEO",
            "AUDIO",
            "SOFTWARE_CODE",
            "TEMPLATE",
            "GRAPHIC_ASSET",
            "HARDWARE",
            "PHYSICAL_ITEM",
            "OTHER"
          ]
        },
        "quantity": {
          "type": [
            "string",
            "integer",
            "null"
          ]
        },
        "format": {
          "type": [
            "string",
            "null"
          ]
        },
        "evidence_ids": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string"
          }
        }
      }
    },
    "claimAsset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "claim_text",
        "evidence_ids",
        "confidence"
      ],
      "properties": {
        "claim_text": {
          "type": "string",
          "minLength": 1
        },
        "evidence_ids": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string"
          }
        },
        "confidence": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        }
      }
    },
    "riskFlag": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "risk_code",
        "severity",
        "description",
        "action_required"
      ],
      "properties": {
        "risk_code": {
          "type": "string",
          "enum": [
            "COPYRIGHT_OR_LICENSE",
            "PROHIBITED_KEYWORD",
            "INSUFFICIENT_INFO",
            "OVERPROMISE",
            "FACT_CONFLICT",
            "FULFILLMENT_RISK",
            "OTHER"
          ]
        },
        "severity": {
          "type": "string",
          "enum": [
            "INFO",
            "WARNING",
            "CRITICAL"
          ]
        },
        "description": {
          "type": "string",
          "minLength": 1
        },
        "action_required": {
          "type": "string",
          "enum": [
            "NONE",
            "CLEAN_TEXT",
            "REPLACE_IMAGE",
            "CONFIRM_FULFILLMENT",
            "FORCE_DROP",
            "MANUAL_REVIEW"
          ]
        }
      }
    },
    "unsupportedClaim": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "claim_text",
        "reason",
        "suggested_action"
      ],
      "properties": {
        "claim_text": {
          "type": "string",
          "minLength": 1
        },
        "reason": {
          "type": "string",
          "minLength": 1
        },
        "suggested_action": {
          "type": "string",
          "enum": [
            "REMOVE",
            "DOWNGRADE",
            "VERIFY_WITH_HUMAN"
          ]
        }
      }
    },
    "missingInfo": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "field_name",
        "impact",
        "suggested_recovery"
      ],
      "properties": {
        "field_name": {
          "type": "string",
          "minLength": 1
        },
        "impact": {
          "type": "string",
          "enum": [
            "LOW",
            "MEDIUM",
            "HIGH",
            "BLOCKING"
          ]
        },
        "suggested_recovery": {
          "type": "string",
          "minLength": 1
        }
      }
    }
  }
}
```

## 2.3 SellableOffer JSON Schema

规范：JSON Schema Draft 2020-12。定义我方真实拥有的履约交付包，解决“同行所写 ≠ 我方所售”的风险门禁。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.xianyu-ai/schemas/sellable-offer.v1.schema.json",
  "title": "SellableOffer",
  "description": "我方实际拥有、已核验且能够履约交付的真实可售商品资产包规范。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "offer_id",
    "source_product_id",
    "actual_contents",
    "fulfillment_type",
    "fulfillment_assets",
    "rights_status",
    "quantity_verified",
    "deliverable_verified",
    "fulfillment_status",
    "human_confirmed",
    "created_at"
  ],
  "properties": {
    "schema_version": {
      "const": "1.0",
      "description": "契约版本。"
    },
    "offer_id": {
      "type": "string",
      "pattern": "^offer_[A-Za-z0-9_-]+$",
      "description": "实际可售包唯一 ID。"
    },
    "source_product_id": {
      "type": "string",
      "minLength": 1,
      "description": "关联的参考来源商品 ID。"
    },
    "actual_contents": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string",
        "minLength": 1
      },
      "description": "我方实际拥有的交付物清单（如具体文件、课件、代码包、卡密类型）。"
    },
    "fulfillment_type": {
      "type": "string",
      "enum": [
        "NETDISK_AUTO",
        "NETDISK_MANUAL",
        "CARD_CODE",
        "MANUAL_SERVICE",
        "TUTORIAL_FILE",
        "PHYSICAL_EXPRESS"
      ],
      "description": "实际交付方式。"
    },
    "fulfillment_assets": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/$defs/fulfillmentAsset"
      },
      "description": "实际履约交付资产集合（网盘链接、本地文件、卡密池等）。"
    },
    "rights_status": {
      "type": "string",
      "enum": [
        "USER_OWNED",
        "LICENSED",
        "PUBLIC_DOMAIN",
        "UNKNOWN",
        "NOT_AUTHORIZED"
      ],
      "description": "该交付资产的知识产权与转售授权状态。"
    },
    "quantity_verified": {
      "type": "boolean",
      "description": "资产数量（如题库数、模板套数）是否经人工或脚本核验。"
    },
    "deliverable_verified": {
      "type": "boolean",
      "description": "交付载体（网盘链接有效性、提取码、解压密码）是否测试可用。"
    },
    "fulfillment_status": {
      "type": "string",
      "enum": [
        "NOT_CHECKED",
        "READY",
        "INCOMPLETE",
        "UNAVAILABLE"
      ],
      "description": "履约就绪状态。只有 READY 状态才允许最终批准出库。"
    },
    "human_confirmed": {
      "type": "boolean",
      "description": "是否由运营/店主人工确认我方交付无误。"
    },
    "operator": {
      "type": [
        "string",
        "null"
      ],
      "description": "确认人标识。"
    },
    "verified_at": {
      "type": [
        "string",
        "null"
      ],
      "format": "date-time",
      "description": "履约核验时间。"
    },
    "notes": {
      "type": [
        "string",
        "null"
      ],
      "description": "交付注意事项与发货附言。"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "description": "创建时间。"
    }
  },
  "$defs": {
    "fulfillmentAsset": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "asset_id",
        "asset_name",
        "asset_type",
        "storage_location_ref",
        "verified"
      ],
      "properties": {
        "asset_id": {
          "type": "string",
          "pattern": "^fas_[A-Za-z0-9_-]+$"
        },
        "asset_name": {
          "type": "string",
          "minLength": 1
        },
        "asset_type": {
          "type": "string",
          "enum": [
            "BAIDU_NETDISK",
            "QUARK_NETDISK",
            "ALIYUN_DRIVE",
            "LOCAL_ARCHIVE",
            "CODE_TOKEN",
            "OTHER"
          ]
        },
        "storage_location_ref": {
          "type": "string",
          "minLength": 1,
          "description": "资产存储引用或脱敏链接标识。"
        },
        "file_count": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "size_bytes": {
          "type": [
            "integer",
            "null"
          ],
          "minimum": 0
        },
        "sha256_checksum": {
          "type": [
            "string",
            "null"
          ],
          "pattern": "^[A-Fa-f0-9]{64}$"
        },
        "verified": {
          "type": "boolean"
        }
      }
    }
  }
}
```

## 2.4 ProductScorecard JSON Schema

规范：JSON Schema Draft 2020-12。解耦自 ProductDNA，专注于单商品可度量的商业启发式评价（1–5分制）。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.xianyu-ai/schemas/product-scorecard.v1.schema.json",
  "title": "ProductScorecard",
  "description": "对 ProductDNA 提取事实的启发式商业评价卡（1-5分制真实可度量指标，解耦客观理解）。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "scorecard_id",
    "job_id",
    "revision_id",
    "product_dna_id",
    "demand_signal_strength",
    "positioning_clarity",
    "differentiation_potential",
    "remake_feasibility",
    "virtual_product_fit_score",
    "scorecard_confidence",
    "score_basis",
    "recommended_action",
    "recommended_action_reason",
    "limitations",
    "evaluation_policy_version",
    "created_at"
  ],
  "properties": {
    "schema_version": {
      "const": "1.0",
      "description": "契约版本。"
    },
    "scorecard_id": {
      "type": "string",
      "pattern": "^scorecard_[A-Za-z0-9_-]+$",
      "description": "评分卡唯一 ID。"
    },
    "job_id": {
      "type": "string",
      "pattern": "^job_[A-Za-z0-9_-]+$"
    },
    "revision_id": {
      "type": "string",
      "pattern": "^revision_[0-9]{3,}$"
    },
    "product_dna_id": {
      "type": "string",
      "pattern": "^dna_[A-Za-z0-9_-]+$",
      "description": "评价依据的 ProductDNA ID。"
    },
    "demand_signal_strength": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "需求信号强度 (1-5)：同行文案痛点清晰度、提问点与动销暗示。"
    },
    "positioning_clarity": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "定位清晰度 (1-5)：目标受众与核心使用场景是否鲜明。"
    },
    "differentiation_potential": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "差异化潜力 (1-5)：在同质化中挖掘细分切入角色的可能性。"
    },
    "remake_feasibility": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5,
      "description": "重制可行性 (1-5)：素材完整性、履约复杂度与合规门槛综合判断。"
    },
    "virtual_product_fit_score": {
      "type": [
        "integer",
        "null"
      ],
      "minimum": 1,
      "maximum": 5,
      "description": "虚拟商品适配度 (1-5)；非虚拟商品为 null。"
    },
    "scorecard_confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1,
      "description": "评分可靠度辅助估值，不作为自动流转硬门槛。"
    },
    "score_basis": {
      "type": "array",
      "minItems": 4,
      "items": {
        "$ref": "#/$defs/scoreBasisItem"
      },
      "description": "逐项可度量指标的评估理由、分级与依据。"
    },
    "recommended_action": {
      "type": "string",
      "enum": [
        "KEEP",
        "REMAKE",
        "DROP"
      ],
      "description": "推荐决策方向。"
    },
    "recommended_action_reason": {
      "type": "string",
      "minLength": 10,
      "description": "推荐动作核心理由。"
    },
    "limitations": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "string"
      },
      "description": "当前评估局限性说明（如未联网检索全平台销量/竞争品数量）。"
    },
    "evaluation_policy_version": {
      "type": "string",
      "description": "评分规则策略版本。"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    }
  },
  "$defs": {
    "scoreBasisItem": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "metric_name",
        "score",
        "rating",
        "reason",
        "evidence_ids",
        "limitations"
      ],
      "properties": {
        "metric_name": {
          "type": "string",
          "enum": [
            "DEMAND_SIGNAL",
            "POSITIONING_CLARITY",
            "DIFFERENTIATION_POTENTIAL",
            "REMAKE_FEASIBILITY",
            "VIRTUAL_FIT"
          ]
        },
        "score": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
        },
        "rating": {
          "type": "string",
          "enum": [
            "LOW",
            "MEDIUM",
            "HIGH"
          ]
        },
        "reason": {
          "type": "string",
          "minLength": 5
        },
        "evidence_ids": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "limitations": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

## 2.5 顶层字段详细对照说明

### ProductDNA 字段说明表

| 字段名 | 类型 | 必填 | 来源分类 | 用途说明 |
|---|---|:---:|---|---|
| `schema_version` | string | 是 | SYSTEM | 契约版本，V1 固定为 "1.0" |
| `product_dna_id` | string | 是 | SYSTEM | DNA 实例唯一业务 ID，格式 `dna_<id>` |
| `job_id` | string | 是 | SYSTEM | 归属的重制任务 ID |
| `revision_id` | string | 是 | SYSTEM | 产生该 DNA 的具体快照版本 |
| `source_manifest_sha256` | string | 是 | SYSTEM | 绑定的输入来源快照哈希，防止素材篡改 |
| `source_product_id` | string | 是 | SOURCE | 采集系统原始商品 ID |
| `source_url` | string/null | 是 | SOURCE | 原商品闲鱼网页链接 |
| `source_title` | string | 是 | SOURCE | 原商品标题原文，供证据锚定 |
| `source_description` | string | 是 | SOURCE | 原商品描述原文，供文本切片与证据匹配 |
| `source_images` | array | 是 | SOURCE | 原商品下载图片集合（包含尺寸、位置、OCR文字及哈希） |
| `source_price` | object/null | 是 | SOURCE_OR_HUMAN | 原标价，未知时为 null |
| `source_quality` | object | 是 | SYSTEM_DERIVED | 采集完整性与质量评估（文本长度、图片数、OCR覆盖） |
| `product_type` | enum | 是 | AI_ANALYSIS | 交付物本质（实物、虚拟资源、服务、账号、混合、未知） |
| `product_category` | object | 是 | AI_ANALYSIS | 归属类目及分析置信度 |
| `target_customer` | array | 是 | AI_ANALYSIS | 潜在目标画像推断（含细分人群、核心诉求及对应证据引用） |
| `customer_problem` | array | 是 | AI_ANALYSIS | 解决的核心用户痛点 |
| `purchase_motivation` | array | 是 | AI_ANALYSIS | 购买动机假设 |
| `usage_scenario` | array | 是 | AI_ANALYSIS | 具体使用场景 |
| `core_content` | array | 是 | AI_ANALYSIS | 实际交付的核心内容清单（课件、模板、工具包等） |
| `core_benefits` | array | 是 | AI_ANALYSIS | 有证据支持的核心利益点 |
| `selling_points` | array | 是 | AI_ANALYSIS | 未营销包装的基础事实卖点 |
| `keywords` | array | 是 | AI_ANALYSIS | 提取的高频关键词（实体词、场景词、人群词） |
| `delivery_type` | enum | 是 | SOURCE_OR_AI | 真实交付方式（网盘链接、数字文件、实体快递等） |
| `rights_status` | enum | 是 | AI_OR_HUMAN | 知识产权与转售授权状态（USER_OWNED/LICENSED/PUBLIC_DOMAIN/UNKNOWN/NOT_AUTHORIZED） |
| `risk_flags` | array | 是 | AI_OR_SYSTEM | 风险标记列表（违禁词、侵权风险、文图冲突、过度承诺） |
| `unsupported_claims` | array | 是 | AI_OR_POLICY | 不受证据支持的声明（标记删除或降级） |
| `missing_information` | array | 是 | AI_OR_SYSTEM | 关键信息缺口（阻断或降级依据） |
| `need_human_review` | boolean | 是 | SYSTEM_DERIVED | 是否触发人工介入标记 |
| `evidence_ids` | array | 是 | SYSTEM_DERIVED | 该 DNA 引用的全部证据 ID 集合 |
| `sellable_offer_ref` | string/null | 是 | SYSTEM | 关联的我方可售交付包引用 |
| `created_at` | string | 是 | SYSTEM | ISO 8601 创建时间戳 |

### SellableOffer 字段说明表

| 字段名 | 类型 | 必填 | 来源分类 | 用途说明 |
|---|---|:---:|---|---|
| `offer_id` | string | 是 | SYSTEM | 实际可售履约包唯一 ID，格式 `offer_<id>` |
| `source_product_id` | string | 是 | SOURCE | 关联的参考来源商品 ID |
| `actual_contents` | array | 是 | HUMAN_OR_ASSET | 我方实际拥有的交付物清单（真实文件/网盘内容） |
| `fulfillment_type` | enum | 是 | HUMAN_OR_ASSET | 实际履约方式（网盘自动、卡密、人工代查等） |
| `fulfillment_assets` | array | 是 | HUMAN_OR_ASSET | 实际履约文件与存储介质引用集合 |
| `rights_status` | enum | 是 | HUMAN_CONFIRMED | 我方资产权利状态 |
| `quantity_verified` | boolean | 是 | HUMAN_OR_SCRIPT | 资产数量是否已经过物理核对 |
| `deliverable_verified` | boolean | 是 | HUMAN_OR_SCRIPT | 交付载体是否已实际测试有效（网盘未失效） |
| `fulfillment_status` | enum | 是 | SYSTEM_DERIVED | 履约状态（NOT_CHECKED/READY/INCOMPLETE/UNAVAILABLE） |
| `human_confirmed` | boolean | 是 | HUMAN_INPUT | 是否人工复核确认 |
| `operator` | string/null | 否 | HUMAN_INPUT | 核验操作人 |
| `verified_at` | string/null | 否 | SYSTEM | 核验通过时间 |
| `notes` | string/null | 否 | HUMAN_INPUT | 发货附言与注意事项 |
| `created_at` | string | 是 | SYSTEM | 创建时间戳 |

### ProductScorecard 字段说明表

| 字段名 | 类型 | 必填 | 范围 | 用途说明 |
|---|---|:---:|:---:|---|
| `demand_signal_strength` | integer | 是 | 1–5 | 需求信号强度：基于同行动销词、痛点明确度与提问意图 |
| `positioning_clarity` | integer | 是 | 1–5 | 定位清晰度：卖点是否聚焦、人群是否边界分明 |
| `differentiation_potential` | integer | 是 | 1–5 | 差异化潜力：在同质化供给中包装细分方向的空间 |
| `remake_feasibility` | integer | 是 | 1–5 | 重制可行性：素材完整性、履约成熟度与合规门槛 |
| `virtual_product_fit_score` | integer/null| 是 | 1–5 | 虚拟商品适配度（非虚拟商品填 null） |
| `scorecard_confidence` | number | 是 | 0.0–1.0 | 评分置信度辅助参考（不作为硬阻断门槛） |
| `recommended_action` | enum | 是 | KEEP/REMAKE/DROP | 推荐业务动作 |
| `recommended_action_reason` | string | 是 | >=10字 | 推荐动作的因果链解释 |
| `score_basis` | array | 是 | >=4项 | 逐项指标的评估原因、分级（LOW/MED/HIGH）及局限 |
| `limitations` | array | 是 | >=1项 | 必须显式声明局限性（如未联网验证大盘数据） |

## 2.6 模型核心不变量

1. **事实只读性**：`ProductDNA` 中的 `source_*` 字段必须与 `SourceManifest` 字节一致，禁止 AI 润色或增删。
2. **客观与主观隔离**：`ProductDNA` 严禁包含商业评分与动作；商业评价统一由 `ProductScorecard` 承载。
3. **履约硬约束**：营销文案中声明的商品数量、格式、赠品，必须受到 `SellableOffer.actual_contents` 的子集约束，严禁虚假超售。
4. **权利强检出**：`rights_status` 为 `NOT_AUTHORIZED` 或 `UNKNOWN` 时，原商品素材严禁在重制中直接沿用。
5. **评分防伪精确**：所有启发式指标必须在 1–5 分整数范围内，且必须附带对应的 `limitations` 说明。
6. **无证据不立项**：`ProductDNA` 中的每个核心利益与卖点，必须包含至少一个有效 `evidence_ids`。

# 第三部分：重制策略模型

## 3.1 策略层职责

```text
Product DNA（客观事实） + SellableOffer（实际履约底座）
        ↓
Strategy Generator（策略生成器：生成 1~3 个差异化候选 + proposed_strategy_id）
        ↓
STRATEGY_SELECTION（策略选择节点：由人工确认或显式规则锁定 selected_strategy_id）
        ↓
Content Generator（内容生成节点：严格根据所选唯一定位执行）
```

策略层是连接“底层事实”与“上层文案”的业务路由器。一个商品允许存在多种合理的重制定位（如低价入门款、高阶专业款、特定职业垂直款）。策略层必须给出清晰的人群定义、销售角度、标题公式与视觉方向，同时说明 **`why_this_strategy_is_plausible`（为什么该策略基于现有事实和履约能力是成立的）**，拒绝大模型臆造的“胜率”保证。

## 3.2 ProductRemakeStrategySet JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.xianyu-ai/schemas/product-remake-strategy-set.v1.schema.json",
  "title": "ProductRemakeStrategySet",
  "description": "重制策略集合规范，由 Strategy Generator 输出，最多3个候选策略及推荐项，文案生成依赖显式选定项。",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "strategy_set_id",
    "job_id",
    "revision_id",
    "source_product_id",
    "product_dna_id",
    "scorecard_id",
    "source_manifest_sha256",
    "recommended_action",
    "strategies",
    "proposed_strategy_id",
    "created_at"
  ],
  "properties": {
    "schema_version": {
      "const": "1.0",
      "x-origin": "SYSTEM"
    },
    "strategy_set_id": {
      "type": "string",
      "pattern": "^strategy_set_[A-Za-z0-9_-]+$",
      "x-origin": "SYSTEM"
    },
    "job_id": {
      "type": "string",
      "pattern": "^job_[A-Za-z0-9_-]+$",
      "x-origin": "SYSTEM"
    },
    "revision_id": {
      "type": "string",
      "pattern": "^revision_[0-9]{3,}$",
      "x-origin": "SYSTEM"
    },
    "source_product_id": {
      "type": "string",
      "minLength": 1,
      "x-origin": "SOURCE"
    },
    "product_dna_id": {
      "type": "string",
      "pattern": "^dna_[A-Za-z0-9_-]+$",
      "x-origin": "SYSTEM"
    },
    "scorecard_id": {
      "type": "string",
      "pattern": "^scorecard_[A-Za-z0-9_-]+$",
      "x-origin": "SYSTEM"
    },
    "source_manifest_sha256": {
      "type": "string",
      "pattern": "^[A-Fa-f0-9]{64}$",
      "x-origin": "SYSTEM"
    },
    "recommended_action": {
      "type": "string",
      "enum": [
        "KEEP",
        "REMAKE",
        "DROP"
      ],
      "x-origin": "AI_SCORING"
    },
    "strategies": {
      "type": "array",
      "minItems": 0,
      "maxItems": 3,
      "items": {
        "$ref": "#/$defs/strategy"
      },
      "x-origin": "AI_STRATEGY"
    },
    "proposed_strategy_id": {
      "type": [
        "string",
        "null"
      ],
      "pattern": "^strategy_[A-Za-z0-9_-]+$",
      "description": "AI 推荐策略 ID，DROP 时为 null。不等于最终选定策略。",
      "x-origin": "SYSTEM_DERIVED"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "x-origin": "SYSTEM"
    }
  },
  "$defs": {
    "strategy": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "strategy_id",
        "source_product_id",
        "product_dna_id",
        "strategy_index",
        "strategy_mode",
        "positioning",
        "target_customer",
        "main_selling_angle",
        "rationale",
        "title_direction",
        "content_direction",
        "image_direction",
        "price_strategy",
        "confidence_score",
        "evidence_ids",
        "assumptions",
        "risk_controls"
      ],
      "properties": {
        "strategy_id": {
          "type": "string",
          "pattern": "^strategy_[A-Za-z0-9_-]+$",
          "description": "策略唯一 ID。"
        },
        "source_product_id": {
          "type": "string",
          "minLength": 1,
          "description": "原商品 ID。"
        },
        "product_dna_id": {
          "type": "string",
          "pattern": "^dna_[A-Za-z0-9_-]+$",
          "description": "绑定的 Product DNA。"
        },
        "strategy_index": {
          "type": "integer",
          "minimum": 1,
          "maximum": 3,
          "description": "候选顺序。"
        },
        "strategy_mode": {
          "type": "string",
          "enum": [
            "KEEP_OPTIMIZE",
            "REMAKE"
          ],
          "description": "保守优化或重新定位。"
        },
        "positioning": {
          "type": "string",
          "minLength": 10,
          "description": "一句话定位：为谁提供什么核心价值。"
        },
        "target_customer": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "segment",
            "primary_need",
            "excluded_segments"
          ],
          "properties": {
            "segment": {
              "type": "string",
              "minLength": 1
            },
            "primary_need": {
              "type": "string",
              "minLength": 1
            },
            "excluded_segments": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        },
        "main_selling_angle": {
          "type": "string",
          "minLength": 5,
          "description": "整个版本唯一主要销售角度。"
        },
        "rationale": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "why_this_positioning",
            "why_this_customer",
            "why_this_strategy_is_plausible",
            "evidence_ids"
          ],
          "properties": {
            "why_this_positioning": {
              "type": "string",
              "minLength": 10
            },
            "why_this_customer": {
              "type": "string",
              "minLength": 10
            },
            "why_this_strategy_is_plausible": {
              "type": "string",
              "minLength": 10,
              "description": "为什么基于当前事实和交付物该策略是合理的，杜绝臆造胜率。"
            },
            "evidence_ids": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string"
              }
            }
          }
        },
        "title_direction": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "formula",
            "must_include",
            "avoid",
            "tone"
          ],
          "properties": {
            "formula": {
              "type": "string",
              "minLength": 5
            },
            "must_include": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string"
              }
            },
            "avoid": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "tone": {
              "type": "string",
              "enum": [
                "PRACTICAL",
                "PROFESSIONAL",
                "CLEAR",
                "URGENT_VALUE"
              ]
            }
          }
        },
        "content_direction": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "opening_hook",
            "structure_template",
            "proof_emphasis",
            "buyer_notice"
          ],
          "properties": {
            "opening_hook": {
              "type": "string",
              "minLength": 5
            },
            "structure_template": {
              "type": "array",
              "minItems": 3,
              "items": {
                "type": "string"
              }
            },
            "proof_emphasis": {
              "type": "array",
              "minItems": 1,
              "items": {
                "type": "string"
              }
            },
            "buyer_notice": {
              "type": "string",
              "minLength": 5
            }
          }
        },
        "image_direction": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "cover_theme",
            "cover_headline",
            "cover_badges",
            "detail_page_sequence"
          ],
          "properties": {
            "cover_theme": {
              "type": "string",
              "minLength": 3
            },
            "cover_headline": {
              "type": "string",
              "minLength": 2
            },
            "cover_badges": {
              "type": "array",
              "maxItems": 4,
              "items": {
                "type": "string"
              }
            },
            "detail_page_sequence": {
              "type": "array",
              "minItems": 2,
              "items": {
                "type": "string"
              }
            }
          }
        },
        "price_strategy": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "mode",
            "suggested_price",
            "pricing_logic",
            "requires_human_confirmation"
          ],
          "properties": {
            "mode": {
              "type": "string",
              "enum": [
                "FOLLOW_SOURCE",
                "PENETRATION_LOW",
                "VALUE_ANCHOR",
                "MANUAL"
              ]
            },
            "suggested_price": {
              "type": [
                "number",
                "null"
              ],
              "minimum": 0
            },
            "pricing_logic": {
              "type": "string",
              "minLength": 5
            },
            "requires_human_confirmation": {
              "type": "boolean",
              "const": true
            }
          }
        },
        "confidence_score": {
          "type": "number",
          "minimum": 0,
          "maximum": 1
        },
        "evidence_ids": {
          "type": "array",
          "minItems": 1,
          "items": {
            "type": "string"
          }
        },
        "assumptions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "risk_controls": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

## 3.3 策略数量、选择与流转规则

| 推荐动作 | 允许策略数 | 策略模式 | 流转规则 |
|---|:---:|---|---|
| `KEEP` | 1 | `KEEP_OPTIMIZE` | 仅允许生成 1 个保守优化策略，严禁破坏原商品成熟事实 |
| `REMAKE` | 1–3 | `REMAKE` | 生成实质不同的定位方向，且必须至少包含 1 项差异化主张 |
| `DROP` | 0 | 无 | 严禁生成策略，直接流向 `HUMAN_INPUT` 供人工复核确认废弃 |

### 核心流转与选择机制：

1. **多策略实质差异性**：多个策略的目标人群（`target_customer`）、主卖点角度（`main_selling_angle`）或核心使用场景必须至少有 1 项实质不同，严禁仅做近义词替换。
2. **解耦建议与决策**：Strategy Generator 节点只负责产出 `strategies` 列表并给出建议项 `proposed_strategy_id`，它**绝对不等于最终选定策略**。
3. **显式策略确认门禁**：Workflow 进入独立的 `STRATEGY_SELECTION` 状态。必须存在已确认的 `selected_strategy_id`（由人工点击确认，或在自动化测试中由显式规则参数指定），下游 `Content Generator` 才能启动。
4. **单策略纯净消费**：`Content Generator` 一次只消费一个选定策略，禁止将策略 A 的人群和策略 B 的卖点拼凑混合。
5. **分支派生机制**：若用户后续希望尝试策略 B，系统必须从策略 B 派生出全新的 `Revision`（如 `revision_004`），绝对不得覆盖原有基于策略 A 的 `revision_002`。

## 3.4 定价策略边界

V1 不联网抓取实时竞争品成交价。系统生成的定价建议必须满足：
- 严格标记 `requires_human_confirmation: true`；
- 若原商品标价未知（`source_price == null`），模式必须强制设为 `MANUAL`，严禁 AI 凭空虚构确切标价；
- 若原商品标价已知，可提供 `FOLLOW_SOURCE`（保持原价）或 `PENETRATION_LOW`（渗透定价建议），并必须在 `pricing_logic` 中注明推导逻辑与局限。

---

# 第四部分：V1 Workflow 状态机

## 4.1 主状态图

```text
START
  │
  ▼
INPUT_CHECK ───────(PARTIAL / 缺漏)───────► HUMAN_INPUT (补充素材/确认缺口)
  │ (PASS)                                      │
  ▼                                             ▼ (补充完成)
PRODUCT_ANALYSIS ◄──────────────────────────────┘
  │
  ▼
PRODUCT_SCORING ───(DROP 争议/复议)───────► HUMAN_INPUT (确认废弃/强制复核)
  │ (KEEP / REMAKE)                             │
  ▼                                             ▼ (人工复议为 REMAKE)
REMAKE_STRATEGY ◄───────────────────────────────┘
  │
  ▼
STRATEGY_SELECTION ──(需要交互选择)───────► HUMAN_INPUT (人工选择策略)
  │ (selected_strategy_id 确定)                 │
  ▼                                             ▼ (选定策略)
CONTENT_GENERATION ◄────────────────────────────┘
  │
  ▼
IMAGE_PLAN
  │
  ▼
VALIDATION ────────(Blocking 错误 / 未就绪)──► HUMAN_INPUT (修改错误/核验履约)
  │ (PASS 且履约 READY)                         │
  ▼                                             ▼ (修复并通过校验)
HUMAN_REVIEW ◄──────────────────────────────────┘
  ├─ APPROVE ─────────────────────────────► APPROVED (固化正式 Version)
  ├─ REJECT ──────────────────────────────► REJECTED (终止流程)
  └─ REQUEST_REVISION ────────────────────► 新建 Revision，退回目标节点重跑
```

## 4.2 状态契约定义

### 1. START
- **输入**：`source_product_directory`、用户指令、可选的初始人工设定。
- **输出**：新建 `job.json`、分配全局唯一 `job_id`、创建 `revision_001` 目录结构。
- **失败条件**：原始归档目录不存在；无法在输出目录分配文件句柄；同一幂等键已有运行中 Job。
- **自动继续**：是，初始化成功后自动推进至 `INPUT_CHECK`。

### 2. INPUT_CHECK
- **输入**：原始商品归档中的 `商品信息.json`、`文案.txt`、`图片/` 目录文件。
- **输出**：`source-manifest.json`、`normalized-input.json`、初始事实证据（图片OCR、规格字段）。
- **失败条件**：文本与图片完全为空；文件被占用损坏无法读取；哈希生成失败；路径越界。
- **自动继续**：
  - 若状态为 `COMPLETE`，自动推进至 `PRODUCT_ANALYSIS`；
  - 若状态为 `PARTIAL`（缺少部分非关键图文），暂停并转入 `HUMAN_INPUT` 提示用户确认或补齐；
  - 若状态为 `INVALID`，阻断并转入 `FAILED_BLOCKED`。
- **说明**：此节点为 100% 确定性本地代码，不调用任何 AI 模型。

### 3. HUMAN_INPUT（过程交互）
- **职责**：处理流程中间各节点所需的人工输入、争议仲裁与履约核验，与最终出库终审解耦。
- **触发场景**：
  1. `INPUT_CHECK` 发现数据残缺需人工补充；
  2. `PRODUCT_SCORING` 判定为 `DROP`，用户发起复议；
  3. `STRATEGY_SELECTION` 需要用户在 1~3 个候选策略中做出选择；
  4. `VALIDATION` 发现 `SellableOffer.fulfillment_status != READY`，需要店主确认实际发货网盘或卡密就绪。
- **操作动作**：`SUBMIT_DATA`（补齐数据）、`SELECT_STRATEGY`（选定策略）、`CONFIRM_OFFER`（确认履约）、`DISCARD`（确认丢弃）。
- **输出**：补充后的事实记录或选择指令，触发进入对应下游状态。

### 4. PRODUCT_ANALYSIS
- **输入**：`normalized-input.json`、原图本地路径与哈希、已登记证据。
- **输出**：`product-dna.json`（客观事实与理解）、新增事实 Claim 与 Evidence 记录。
- **失败条件**：模型输出不符合 Schema；未提取到核心交付物；将推断事实化；文图存在冲突未标识。
- **自动继续**：Schema 与语义检查通过后自动推进至 `PRODUCT_SCORING`。

### 5. PRODUCT_SCORING
- **输入**：`product-dna.json`、`scoring-policy.json`。
- **输出**：`product-scorecard.json`（1–5 分制真实指标，解耦于 DNA）、`recommended_action`。
- **失败条件**：评分越界；指标缺失评估理由或局限性说明；虚构未联网的大盘销量数据。
- **自动继续**：
  - 动作为 `KEEP` 或 `REMAKE` 且无阻断风险，自动推进至 `REMAKE_STRATEGY`；
  - 动作为 `DROP`，流转至 `HUMAN_INPUT` 提示废弃理由并等待人工复议。

### 6. REMAKE_STRATEGY
- **输入**：`product-dna.json`、`product-scorecard.json`。
- **输出**：`strategy-set.json`（包含 1~3 个候选策略，附带 `proposed_strategy_id`）。
- **失败条件**：策略数超标；策略间同质化无实质差异；DROP 模式仍生成策略；理由中臆造胜率。
- **自动继续**：生成成功后自动推进至 `STRATEGY_SELECTION`。

### 7. STRATEGY_SELECTION（新增策略选择节点）
- **输入**：`strategy-set.json` 及提议的 `proposed_strategy_id`。
- **输出**：确认写入 Revision 的 `selected_strategy_id`，以及策略选择者身份与时间戳。
- **失败条件**：选择的策略 ID 不在候选集中；选中的策略依赖于未解决的高危风险。
- **自动继续**：
  - 交互模式下停留在当前状态（或 `HUMAN_INPUT`）等待人工明确选择；
  - 纯离线批处理配置下，可依据配置规则确认接受 `proposed_strategy_id` 并自动推进至 `CONTENT_GENERATION`。

### 8. CONTENT_GENERATION
- **输入**：`product-dna.json`、选定的唯一 `selected_strategy_id`、我方真实履约包 `SellableOffer`。
- **输出**：`content-draft.json`（新标题、新描述、卖点、关键词、封面文案），新增 Claim 及其证据关联。
- **失败条件**：文案出现超出 `SellableOffer` 的虚假赠品/数量；混合未选定策略的诉求；违反合规禁词。
- **自动继续**：内容生成且事实声明覆盖有效后自动推进至 `IMAGE_PLAN`。

### 9. IMAGE_PLAN
- **输入**：`product-dna.json`（含 `rights_status`）、`content-draft.json`、原图清单与 OCR 结果。
- **输出**：`image-plan.json`（首图视觉层级、文案排版、详情图叙事流、原图处理建议）。
- **失败条件**：引用不存在图片；在 `rights_status` 未授权时违规建议 `KEEP` 原图；要求虚构实体包装。
- **自动继续**：方案通过规则检查后自动推进至 `VALIDATION`。注意：此节点不生成最终图片文件。

### 10. VALIDATION
- **输入**：当前 Revision 全部 JSON（DNA、Offer、Scorecard、Strategy、Content、ImagePlan、Claims、Evidence）。
- **输出**：`validation-report.json`（记录 Error, Warning, Info 及阻断标识）。
- **失败条件**：Schema 校验不通过；来源哈希不匹配；FACT 声明有未决或矛盾；`SellableOffer.fulfillment_status != READY`。
- **自动继续**：
  - 若存在 BLOCKING 错误或履约未就绪，流转至 `HUMAN_INPUT` 提示修复阻断；
  - 若校验全部 PASS（或仅含可忽略 WARNING），自动推进至 `HUMAN_REVIEW`。

### 11. HUMAN_REVIEW（出库终审门禁）
- **输入**：当前 Revision 全部生成产物、完整证据链及 `validation-report.json`。
- **输出**：`review-decision.json`，记录终审裁决（`decision`、`reviewer`、`decision_at`、`notes`）。
- **操作选项**：
  1. `APPROVE`：终审批准，固化为不可变正式版本，流转至 `APPROVED`；
  2. `REQUEST_REVISION`：驳回并提出修改意见，系统自动创建下一 Revision 并退回指定节点重跑；
  3. `REJECT`：彻底放弃该商品重制，流转至 `REJECTED`。
- **自动继续**：否。此节点为系统出库的绝对安全防线，**永远严禁自动批准通过**。

### 12. APPROVED
- **输入**：通过人工终审的 Revision。
- **输出**：固化生成 `version_NNN/version.json` 与标准的待发布包 `pending-listing-manifest.json`。
- **状态属性**：发布状态固定为 `NOT_PUBLISHED`。V1 流程到此完满交付，不自动调用发布接口。

### 13. REJECTED
- **输入**：人工审核拒绝或确认 DROP 的任务。
- **输出**：归档保存拒绝理由与审计记录，禁止对外导出发布。

## 4.3 确定性自动继续规则矩阵

为杜绝大模型自我打分带来的“虚假安全感”，V1 彻底废除未经样本校准的 `confidence_score >= 0.60` 自动流转门槛，全面改为由 **6 大硬性确定性规则组合** 控制流程推进：

| 节点迁移路径 | 允许自动流转的 6 项确定性硬条件 | 条件不满足时的流转目标 |
|---|---|---|
| `INPUT_CHECK` → `PRODUCT_ANALYSIS` | 1. 归档文本非空且图文至少满足最低标准；<br>2. 关键 JSON 语法解析正确；<br>3. 原始文件 SHA-256 校验成功；<br>4. 状态明确为 `COMPLETE`。 | 缺漏转 `HUMAN_INPUT`；损坏转 `FAILED_BLOCKED` |
| `PRODUCT_ANALYSIS` → `PRODUCT_SCORING` | 1. `ProductDNA` 严格符合 JSON Schema；<br>2. 核心交付物（`core_content`）识别项 >= 1；<br>3. 核心事实证据关联成功；<br>4. 未产生致命事实冲突（`FACT_CONFLICT`）。 | 阻断并转 `HUMAN_INPUT` 纠偏 |
| `PRODUCT_SCORING` → `REMAKE_STRATEGY` | 1. `ProductScorecard` 严格符合 JSON Schema；<br>2. 推荐动作明确为 `KEEP` 或 `REMAKE`；<br>3. 无 CRITICAL 级别阻断性合规/封号风险；<br>4. 评分指标理由完整且均声明局限性。 | 动作为 DROP 时转 `HUMAN_INPUT` 供复议 |
| `STRATEGY_SELECTION` → `CONTENT_GENERATION` | 1. 选定的策略 ID 真实存在于当前策略集；<br>2. 策略定位与 `SellableOffer` 交付物无矛盾；<br>3. 显式记录策略确认者（人工确认或批处理参数签名）。 | 停留在 `STRATEGY_SELECTION` 等待确认 |
| `CONTENT_GENERATION` → `IMAGE_PLAN` | 1. `content-draft.json` 符合 Schema；<br>2. 标题和正文字数在闲鱼规则上限内；<br>3. 文案中涉及数量/规格的事实声明在 `SellableOffer` 中 100% 存在；<br>4. 违禁词与极限词本地字典扫描为 0。 | 触发局部重试，重试失败转 `HUMAN_INPUT` |
| `IMAGE_PLAN` → `VALIDATION` | 1. `image-plan.json` 符合 Schema；<br>2. 规划的主图与详情图张数符合平台规范（1主图+3~5详情图）；<br>3. `rights_status` 为未授权时，严禁选用 KEEP 原图动作；<br>4. 视觉方案未引入虚假实物包装。 | 触发局部重试，重试失败转 `HUMAN_INPUT` |
| `VALIDATION` → `HUMAN_REVIEW` | 1. 全 Revision 所有产物通过 JSON Schema 严格校验；<br>2. 事实类声明（`claim_nature == FACT`）证据支持率 100%；<br>3. `SellableOffer.fulfillment_status == READY`；<br>4. 零未确认的 CRITICAL 风险标记。 | 存在未决错误或履约未 READY，强制阻断在 `HUMAN_INPUT` |

---

# 第五部分：AI 节点通用契约

为实现单技术栈下各 AI 调用的标准化，所有专用 AI 节点均遵循统一的输入与输出信封结构。

## 5.1 通用输入信封 JSON

```json
{
  "meta": {
    "job_id": "job_20260915_001",
    "revision_id": "revision_001",
    "node_name": "CONTENT_GENERATOR",
    "schema_version": "1.0",
    "policy_version": "content-policy.v1.0",
    "dispatched_at": "2026-09-15T03:05:00Z"
  },
  "payload": {
    "product_dna_ref": "product-dna.json",
    "sellable_offer_ref": "sellable-offer.json",
    "selected_strategy_id": "strategy_001"
  }
}
```

## 5.2 通用输出信封 JSON

```json
{
  "meta": {
    "node_name": "CONTENT_GENERATOR",
    "model_id": "gpt-5.5",
    "prompt_version": "content-generator.v1.2",
    "schema_version": "1.0",
    "input_payload_sha256": "3a4b5c6d...",
    "output_created_at": "2026-09-15T03:05:12Z",
    "latency_ms": 3420,
    "confidence_score": 0.88
  },
  "payload": {
    "title": "职场PPT模板资源包｜工作汇报/年终总结/商务演示",
    "description": "精选职场实用PPT模板合集...",
    "selling_points": [
      "包含500套精选职场模板",
      "覆盖高频汇报场景"
    ],
    "claims": [],
    "evidence_ids": [
      "evidence_001"
    ]
  },
  "diagnostics": {
    "rules_violated": [],
    "assumptions_made": [],
    "unresolved_risks": []
  }
}
```

## 5.3 AI 节点共同禁止事项

1. **严禁无据增实**：任何节点严禁在没有原文、原图或 `SellableOffer` 支撑的情况下，自行增加版本号、容量、课时数、赠品或官方背书。
2. **严禁越权决策**：`Product Analyst` 严禁给出商业打分；`Product Scorer` 严禁推翻底层交付事实；`Image Planner` 严禁直接调用画图工具；所有 AI 节点均无权批准发布。
3. **严禁破坏版权标记**：发现原图带有第三方水印、版权章时，严禁建议“自动涂抹伪装自研”，必须如实标记风险并强制要求重新设计（REBUILD）。
4. **严禁臆造市场表现**：严禁在策略或打分中宣称“该商品必成爆款”、“全网热销10万套”等无数据支撑的幻觉结论。

# 第六部分：五个 AI 节点契约

## 6.1 Product Analyst

**职责**：阅读原商品标题、描述、图片与 OCR 结果，提炼客观的 `ProductDNA`（不包含任何主观商业打分）。

### 输入 JSON

```json
{
  "normalized_product": {
    "source_product_id": "1063279814277",
    "source_url": "https://www.goofish.com/item?id=1063279814277",
    "source_title": "1000套职场实用PPT模板合集 网盘自提",
    "source_description": "整理了各类工作汇报、岗位竞聘、项目总结PPT，风格简约专业，下单后网盘自动发货。",
    "source_price": {
      "currency": "CNY",
      "amount": 9.9
    },
    "source_images": [
      {
        "image_id": "image_001",
        "relative_path": "图片/01.webp",
        "sha256": "8f3b2c1d...",
        "position": 1,
        "width": 1440,
        "height": 1920,
        "mime_type": "image/webp",
        "is_cover": true,
        "detected_text": [
          "PPT模板大全",
          "工作汇报/项目总结"
        ],
        "watermark_detected": false
      }
    ],
    "source_quality": {
      "status": "COMPLETE",
      "has_title": true,
      "has_description": true,
      "image_count": 5,
      "text_length": 65,
      "ocr_applied": true,
      "issues": []
    }
  },
  "existing_evidence": []
}
```

### 输出 JSON

```json
{
  "product_type": "VIRTUAL_RESOURCE",
  "product_category": {
    "primary_category": "办公资源",
    "sub_category": "PPT模板",
    "confidence": 0.95
  },
  "target_customer": [
    {
      "segment": "职场白领 / 基层管理者",
      "rationale": "有周期性述职、项目汇报与商业展示的刚需，缺乏设计时间。",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "customer_problem": [
    {
      "content": "临时做汇报没有好看规范的模板，排版耗时耗力。",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "purchase_motivation": [
    {
      "content": "花几块钱快速解决迫在眉睫的汇报排版难题。",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "usage_scenario": [
    {
      "content": "季度工作总结、项目立项评审、年终述职报告。",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "core_content": [
    {
      "item_name": "职场PPT模板源文件",
      "item_type": "TEMPLATE",
      "quantity": "约1000套",
      "format": ".pptx",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "core_benefits": [
    {
      "claim_text": "覆盖汇报、总结、竞聘等高频职场场景",
      "evidence_ids": [
        "evidence_001"
      ],
      "confidence": 0.9
    }
  ],
  "selling_points": [
    {
      "claim_text": "拍下自动发网盘下载链接",
      "evidence_ids": [
        "evidence_002"
      ],
      "confidence": 0.95
    }
  ],
  "keywords": [
    "PPT模板",
    "工作汇报",
    "总结述职",
    "商务演示"
  ],
  "delivery_type": "CLOUD_LINK",
  "rights_status": "UNKNOWN",
  "risk_flags": [
    {
      "risk_code": "COPYRIGHT_OR_LICENSE",
      "severity": "WARNING",
      "description": "原始模板来源与商用授权未明确，重制时严禁宣称'官方商用授权'。",
      "action_required": "CLEAN_TEXT"
    }
  ],
  "unsupported_claims": [
    {
      "claim_text": "永久包更新",
      "reason": "原描述中未提供持续维护证明，我方亦无法保障",
      "suggested_action": "REMOVE"
    }
  ],
  "missing_information": [],
  "need_human_review": false,
  "claims": [
    {
      "claim_id": "claim_001",
      "claim": "商品包含约1000套PPT模板",
      "claim_nature": "FACT",
      "claim_type": "QUANTITY",
      "status": "SUPPORTED",
      "evidence_ids": [
        "evidence_001"
      ]
    }
  ],
  "evidence": [
    {
      "evidence_id": "evidence_001",
      "source_type": "SOURCE_DESCRIPTION",
      "source_reference": {
        "file_relative_path": "文案.txt",
        "location": "0:25"
      },
      "excerpt": "整理了各类工作汇报、岗位竞聘、项目总结PPT",
      "confidence": 0.95,
      "recorded_at": "2026-09-15T03:00:00Z"
    }
  ]
}
```

**节点执行约束**：
- 严禁输出商业评分和推荐动作；
- 提取的每项核心内容、收益和卖点必须关联原始素材中的证据；
- 当原图与文本有数量矛盾时，必须生成 `FACT_CONFLICT` 类型的风险标记。

## 6.2 Product Scorer

**职责**：读取 Analyst 提取的客观事实以及我方 `SellableOffer`，输出独立的 1–5 分制商业评价卡 `ProductScorecard`。

### 输入 JSON

```json
{
  "product_dna_ref": "product-dna.json",
  "sellable_offer_ref": "sellable-offer.json",
  "scoring_policy": {
    "scale": "1-5",
    "policy_version": "v1.0",
    "metrics_evaluated": [
      "DEMAND_SIGNAL",
      "POSITIONING_CLARITY",
      "DIFFERENTIATION_POTENTIAL",
      "REMAKE_FEASIBILITY",
      "VIRTUAL_FIT"
    ]
  }
}
```

### 输出 JSON

```json
{
  "scorecard_id": "scorecard_001",
  "demand_signal_strength": 4,
  "positioning_clarity": 4,
  "differentiation_potential": 4,
  "remake_feasibility": 5,
  "virtual_product_fit_score": 5,
  "scorecard_confidence": 0.85,
  "score_basis": [
    {
      "metric_name": "DEMAND_SIGNAL",
      "score": 4,
      "rating": "HIGH",
      "reason": "职场总结与汇报是闲鱼常青高频搜索词，需求痛点明确真实。",
      "evidence_ids": [
        "evidence_001"
      ],
      "limitations": [
        "未联网统计全平台实时关键词搜索量"
      ]
    },
    {
      "metric_name": "POSITIONING_CLARITY",
      "score": 4,
      "rating": "HIGH",
      "reason": "面向职场人的汇报工具包定位非常清晰。",
      "evidence_ids": [
        "evidence_001"
      ],
      "limitations": [
        "依赖同行单品页面的文本表达深度"
      ]
    },
    {
      "metric_name": "DIFFERENTIATION_POTENTIAL",
      "score": 4,
      "rating": "HIGH",
      "reason": "同行仅笼统说1000套，我方可细分提炼'述职汇报精选'做差异化聚焦。",
      "evidence_ids": [
        "evidence_001"
      ],
      "limitations": [
        "未对比全网同款排版差异"
      ]
    },
    {
      "metric_name": "REMAKE_FEASIBILITY",
      "score": 5,
      "rating": "HIGH",
      "reason": "纯数字资产，网盘自动交付，重制成本极低，履约无实体物流阻碍。",
      "evidence_ids": [
        "evidence_001",
        "evidence_002"
      ],
      "limitations": [
        "依赖实际网盘文件的有效性与解压正常"
      ]
    }
  ],
  "recommended_action": "REMAKE",
  "recommended_action_reason": "商品需求真实、履约简单，原有同行文案过于粗糙，具备极佳的重新包装与细分聚焦空间。",
  "limitations": [
    "V1 评分基于现有素材文本语义启发式估算，不代表全网真实历史销量",
    "未接入外部爬虫大盘数据"
  ]
}
```

**节点执行约束**：
- 严禁修改底层 ProductDNA 的任何事实字段；
- 所有指标严格限制在 1–5 分制区间，且必须逐项给出理由与局限性说明；
- 严禁捏造未联网验证的全网销量与竞品数量。

## 6.3 Strategy Generator

**职责**：基于 ProductDNA 与 ProductScorecard，生成 1~3 个差异化重制策略，并提议 `proposed_strategy_id`。

### 输入 JSON

```json
{
  "product_dna_ref": "product-dna.json",
  "scorecard_ref": "product-scorecard.json",
  "sellable_offer_ref": "sellable-offer.json",
  "strategy_request": {
    "max_strategies": 3,
    "allow_keep_optimize": false
  }
}
```

### 输出 JSON

```json
{
  "strategy_set_id": "strategy_set_001",
  "recommended_action": "REMAKE",
  "proposed_strategy_id": "strategy_001",
  "strategies": [
    {
      "strategy_id": "strategy_001",
      "source_product_id": "1063279814277",
      "product_dna_id": "dna_001",
      "strategy_index": 1,
      "strategy_mode": "REMAKE",
      "positioning": "面向企业员工与职场新人的高效述职与汇报PPT精选工具包",
      "target_customer": {
        "segment": "企业在职员工、基层主管、应届生",
        "primary_need": "快速搞定季度/年终工作总结汇报，排版规范不被领导挑刺",
        "excluded_segments": [
          "专业平面设计师",
          "学术论文研究员"
        ]
      },
      "main_selling_angle": "分类清晰、直接套用即可交差的职场实用型模板",
      "rationale": {
        "why_this_positioning": "职场汇报是痛点最急、付钱最爽快的垂直场景。",
        "why_this_customer": "这类人群不在乎数量是否上万，更在乎打开就能立刻用。",
        "why_this_strategy_is_plausible": "现有素材中主要涵盖汇报、竞聘、总结结构，且我方拥有对应PPT分类文件，履约切实可行。",
        "evidence_ids": [
          "evidence_001"
        ]
      },
      "title_direction": {
        "formula": "核心资产 + 适用人群 + 典型场景 + 交付方式",
        "must_include": [
          "职场PPT模板",
          "工作汇报",
          "述职总结",
          "自动发货"
        ],
        "avoid": [
          "100000套",
          "绝密内部资料",
          "世界500强"
        ],
        "tone": "PRACTICAL"
      },
      "content_direction": {
        "opening_hook": "做汇报写总结还在通宵排版找模板？一份实用工具包帮你搞定。",
        "structure_template": [
          "痛点代入",
          "资源包含内容",
          "适用场景分类",
          "发货与售后说明"
        ],
        "proof_emphasis": [
          "分类明确",
          "格式标准兼容WPS与Office",
          "拍下秒发网盘"
        ],
        "buyer_notice": "本商品为虚拟数字资源，拍下自动发送网盘链接，非实物发货。"
      },
      "image_direction": {
        "cover_theme": "深蓝/商务灰专业风，醒目标注工作汇报分类",
        "cover_headline": "职场实用 PPT 模板库",
        "cover_badges": [
          "总结述职",
          "项目汇报",
          "网盘秒发"
        ],
        "detail_page_sequence": [
          "场景覆盖（工作总结/竞聘/商业演讲）",
          "精选案例内页排版预览",
          "交付流程与常见问题解答"
        ]
      },
      "price_strategy": {
        "mode": "PENETRATION_LOW",
        "suggested_price": 6.8,
        "pricing_logic": "低客单价促成快速冲量动销，符合闲鱼虚拟资料打法",
        "requires_human_confirmation": true
      },
      "confidence_score": 0.88,
      "evidence_ids": [
        "evidence_001"
      ],
      "assumptions": [
        "买家具备基础 Office 或 WPS 软件操作能力"
      ],
      "risk_controls": [
        "明确注明虚拟资源性质，避免实物物流纠纷"
      ]
    }
  ]
}
```

**节点执行约束**：
- 最多输出 3 个策略候选；
- 必须包含 `why_this_strategy_is_plausible`，严格基于证据解释合理性，禁止臆造爆款率；
- 若输入动作为 DROP，严禁生成任何策略。

## 6.4 Content Generator

**职责**：严格基于显式选定的 `selected_strategy_id` 与我方 `SellableOffer`，编写新标题、新文案、卖点与封面文字。

### 输入 JSON

```json
{
  "product_dna_ref": "product-dna.json",
  "selected_strategy_id": "strategy_001",
  "sellable_offer_ref": "sellable-offer.json",
  "content_policy": {
    "title_max_length": 60,
    "description_min_length": 100,
    "description_max_length": 1000,
    "forbidden_words": [
      "绝对",
      "最强",
      "第一",
      "全网首发",
      "永久包过"
    ]
  }
}
```

### 输出 JSON

```json
{
  "title": "职场PPT模板精选包｜工作汇报/年终述职/项目总结 附分类索引",
  "description": "【商品内容】精选职场实用PPT模板资源包，涵盖工作汇报、季度述职、项目复盘、商务竞聘三大高频场景。\n【格式规范】标准 .pptx 格式，支持 Office / WPS 自由编辑修改，图表可调。\n【适用人群】适合需要经常做总结汇报、项目展示的职场人，直接套用省时省力。\n【发货方式】虚拟资源，拍下后自动发送网盘下载链接，永久有效。",
  "selling_points": [
    "精选工作汇报、总结述职、商业演讲三大核心场景",
    "标准.pptx格式，图表排版均可自由编辑",
    "下单自动发网盘下载链接，无需漫长等待"
  ],
  "keywords": [
    "PPT模板",
    "工作汇报",
    "总结述职",
    "商业演示",
    "职场资源"
  ],
  "cover_copy": {
    "headline": "职场高分汇报 PPT 模板库",
    "sub_headline": "工作汇报 / 述职总结 / 项目演示",
    "badges": [
      "精选实用",
      "图表可改",
      "网盘秒发"
    ]
  },
  "buyer_notice": "本宝贝为虚拟数字资料，拍下后系统自动发网盘链接，请在电脑端下载解压使用。",
  "claims": [
    {
      "claim_id": "claim_content_001",
      "claim": "涵盖工作汇报、季度述职、项目复盘三大场景",
      "claim_nature": "INFERENCE",
      "claim_type": "BENEFIT",
      "status": "SUPPORTED",
      "evidence_ids": [
        "evidence_001"
      ]
    },
    {
      "claim_id": "claim_content_002",
      "claim": "标准.pptx格式，拍下自动发网盘链接",
      "claim_nature": "FACT",
      "claim_type": "DELIVERY",
      "status": "SUPPORTED",
      "evidence_ids": [
        "evidence_002"
      ]
    }
  ]
}
```

**节点执行约束**：
- 严禁混合未选定策略的人群或诉求；
- 文案涉及的商品数量、格式与交付物，必须是我方 `SellableOffer` 的子集，严禁虚假承诺；
- 严格受违禁词与字数上限约束。

## 6.5 Image Planner

**职责**：根据选定策略、文案草稿与原图权利状态，规划主图与详情图的视觉表达方案。**注意：本节点只输出设计规划方案，不调用绘图工具生成图片文件。**

### 输入 JSON

```json
{
  "product_dna_ref": "product-dna.json",
  "selected_strategy_id": "strategy_001",
  "content_draft_ref": "content-draft.json",
  "source_images": [
    {
      "image_id": "image_001",
      "relative_path": "图片/01.webp",
      "width": 1440,
      "height": 1920,
      "watermark_detected": false
    }
  ],
  "image_policy": {
    "target_image_count": 4,
    "require_clean_watermark": true,
    "disallow_keep_if_rights_unclear": true
  }
}
```

### 输出 JSON

```json
{
  "cover_plan": {
    "action": "REBUILD",
    "theme": "专业职场深蓝简约风",
    "visual_hierarchy": [
      "主标题：职场高分汇报 PPT 模板库",
      "副标题：工作汇报 / 述职总结 / 项目演示",
      "右上角标签：网盘即买即发",
      "底图背景：精选PPT多版式平铺预览（经过模糊暗化处理，突出文字）"
    ],
    "target_aspect_ratio": "3:4",
    "reason_for_action": "原图带有同行店铺痕迹且版权状态未明，必须重新设计排版封面。"
  },
  "detail_pages": [
    {
      "page_index": 2,
      "page_topic": "核心场景分类展示",
      "layout_description": "三栏排版，分别展示总结汇报、项目推进、商业路演三类模板封面截屏。",
      "copy_points": [
        "工作汇报类",
        "季度总结类",
        "项目复盘类"
      ],
      "source_image_action": "OPTIMIZE"
    },
    {
      "page_index": 3,
      "page_topic": "模板内页编辑细节",
      "layout_description": "特写展示排版规范、图表配色、文字占位符，体现易编辑特性。",
      "copy_points": [
        "数据图表自由修改",
        "字体排版层次分明"
      ],
      "source_image_action": "OPTIMIZE"
    },
    {
      "page_index": 4,
      "page_topic": "拍下发货与售后说明",
      "layout_description": "清晰服务告知图，图解下单后在聊天窗口获取网盘链接的步骤。",
      "copy_points": [
        "下单自动发货",
        "网盘不限速直链",
        "遇到解压问题随时联系"
      ],
      "source_image_action": "REBUILD"
    }
  ],
  "overall_recommendations": "保持 3:4 闲鱼纵向最佳展示比例，全套图片统一色系，禁止虚构任何纸质包装盒。"
}
```

**节点执行约束**：
- 当素材 `rights_status` 为未授权（NOT_AUTHORIZED）或未知（UNKNOWN）时，原图处理动作**严禁选用 KEEP**，必须强制指定为 `REBUILD`（重新排版）或 `CLEAN_ONLY`；
- 严禁要求虚构不存在的实物包装盒或光盘实体；
- 严格遵循闲鱼 3:4 纵向首图与多图叙事逻辑。

---

# 第七部分：Job、Revision、Version 版本系统（权威规范）

> **修订清理说明**：本节为系统唯一的权威版本模型定义，彻底消除了旧版草稿中重复出现的两套定义，规范统一了全局字段命名。

## 7.1 三层对象关系模型

```text
SourceProduct（只读原始归档，按商品ID隔离）
  1 ── N RemakeJob（一次具体的重制任务）
           1 ── N RemakeRevision（不可变草稿快照，单调递增）
                    0 ── 1 ProductVersion（人工终审批准的正式发布快照）
```

- **RemakeJob**：记录一次重制任务的元信息、策略配置与状态生命周期，事件只能追加。
- **RemakeRevision**：不可变的草稿快照。无论 AI 重跑还是人工修改，均生成新 Revision，旧 Revision 永久留存供追溯回滚。
- **ProductVersion**：唯一合法的出库成果。只有经人工终审 `APPROVED`、且通过履约与权利门禁的 Revision 才能晋升固化为 Version。

## 7.2 Job 数据结构与规范

```json
{
  "schema_version": "1.0",
  "job_id": "job_20260915_001",
  "source_product_id": "source_product_001",
  "source_manifest_ref": "source-manifest.json",
  "source_manifest_sha256": "8a39b4ef84c718b958742b6a83d9b4c718b958742b6a83d9b4c718b958742b6a",
  "intent": "FULL_REMAKE",
  "status": "HUMAN_REVIEW",
  "active_revision_id": "revision_003",
  "strategy_set_revision_id": "revision_001",
  "selected_strategy_id": "strategy_001",
  "sellable_offer_ref": "sellable-offer.json",
  "policy_versions": {
    "analysis_policy": "v1.0",
    "scoring_policy": "v1.0",
    "strategy_policy": "v1.0",
    "content_policy": "v1.0",
    "image_policy": "v1.0",
    "validation_policy": "v1.0"
  },
  "created_at": "2026-09-15T03:00:00Z",
  "updated_at": "2026-09-15T03:10:00Z",
  "created_by": "local_user",
  "idempotency_key": "source_product_001:8a39b4ef:FULL_REMAKE",
  "events": [
    {
      "event_id": "event_001",
      "type": "JOB_CREATED",
      "at": "2026-09-15T03:00:00Z",
      "revision_id": "revision_001"
    },
    {
      "event_id": "event_002",
      "type": "STRATEGY_SELECTED",
      "at": "2026-09-15T03:05:00Z",
      "strategy_id": "strategy_001"
    }
  ]
}
```

## 7.3 Revision 数据结构与规范

```json
{
  "schema_version": "1.0",
  "revision_id": "revision_003",
  "job_id": "job_20260915_001",
  "revision_number": 3,
  "parent_revision_id": "revision_002",
  "created_by": "HUMAN",
  "change_reason": "HUMAN_REQUESTED_CONTENT_REVISION",
  "selected_strategy_id": "strategy_001",
  "source_manifest_sha256": "8a39b4ef84c718b958742b6a83d9b4c718b958742b6a83d9b4c718b958742b6a",
  "review_status": "DRAFT",
  "started_from_node": "CONTENT_GENERATION",
  "artifacts": {
    "product_dna": "product-dna.json",
    "sellable_offer": "sellable-offer.json",
    "product_scorecard": "product-scorecard.json",
    "strategy_set": "strategy-set.json",
    "content_draft": "content-draft.json",
    "image_plan": "image-plan.json",
    "claims_evidence": "claims-evidence.json",
    "validation_report": "validation-report.json"
  },
  "artifact_hashes": {
    "product_dna": "d41d8cd98f00b204e9800998ecf8427e00000000000000000000000000000000",
    "content_draft": "e2fc714c4727ee9395f324cd2e7f331f00000000000000000000000000000000"
  },
  "change_summary": [
    "根据人工意见微调标题突出职场总结场景"
  ],
  "created_at": "2026-09-15T03:08:00Z"
}
```

## 7.4 Version 数据结构与规范

```json
{
  "schema_version": "1.0",
  "version_id": "version_001",
  "version_number": 1,
  "source_product_id": "source_product_001",
  "source_manifest_sha256": "8a39b4ef84c718b958742b6a83d9b4c718b958742b6a83d9b4c718b958742b6a",
  "job_id": "job_20260915_001",
  "approved_revision_id": "revision_003",
  "selected_strategy_id": "strategy_001",
  "sellable_offer_ref": "sellable-offer.json",
  "fulfillment_verified": true,
  "status": "READY_FOR_EXPORT",
  "publish_status": "NOT_PUBLISHED",
  "listing_package": {
    "title": "职场PPT模板精选包｜工作汇报/年终述职/项目总结 附分类索引",
    "description": "【商品内容】精选职场实用PPT模板资源包...",
    "selling_points": [
      "精选工作汇报、总结述职、商业演讲三大核心场景",
      "标准.pptx格式，图表排版均可自由编辑",
      "下单自动发网盘下载链接，无需漫长等待"
    ],
    "keywords": [
      "PPT模板",
      "工作汇报",
      "总结述职",
      "商业演示"
    ],
    "cover_copy": {
      "headline": "职场高分汇报 PPT 模板库",
      "sub_headline": "工作汇报 / 述职总结 / 项目演示",
      "badges": [
        "精选实用",
        "图表可改",
        "网盘秒发"
      ]
    },
    "image_plan_ref": "image-plan.json"
  },
  "evidence_coverage": {
    "total_claims": 12,
    "fact_claims": 5,
    "fact_coverage_rate": 1,
    "unverified_fact_count": 0
  },
  "approval": {
    "approved_at": "2026-09-15T03:15:00Z",
    "approved_by": "local_user",
    "decision": "APPROVED",
    "review_notes": "履约网盘已核验有效，事实声明全覆盖，同意固化出库。"
  },
  "created_at": "2026-09-15T03:15:00Z"
}
```

## 7.5 修改影响范围与重跑级联矩阵

| 触发的修改事件 | 级联重跑与失效范围 | 复用范围 |
|---|---|---|
| 原商品归档更新（标题/图片变化） | 全链重跑：DNA、Scorecard、Strategy、Content、ImagePlan 全部失效 | 无 |
| 人工修改/补充原始事实 | DNA 重新生成，下游各节点全部级联重跑 | 原始归档清单 |
| 仅调整评分与商业策略规则 | Product Scorer 重新计算，生成新 Scorecard | 复用已有 ProductDNA |
| 用户在候选集中选择新策略 | Content Generator、Image Planner、Validation 重新生成 | 复用 ProductDNA、Scorecard、StrategySet |
| 人工修改标题或正文细节 | Content Draft 变更，触发 Validation 重新校验 | 复用 DNA、Scorecard、StrategySet、ImagePlan |
| 人工更新图片方案细节 | Image Plan 变更，触发 Validation 重新校验 | 复用 DNA、Scorecard、StrategySet、Content |
| 人工审核终审通过（APPROVE） | 无需重跑，当前 Revision 直接晋升封存为 Version | 固化该 Revision 的全部产物 |

## 7.6 存储层与版本系统核心不变量

1. **原始归档只读**：系统对 `商品ID/` 采集目录只有只读权限，任何重制产物必须输出至独立的 `商品重制输出/` 目录。
2. **Revision 绝对不可变**：Revision 目录写入完成并生成哈希校验后立即设为只读。禁止任何就地修改（In-place update）。
3. **版本单调递增**：Revision 与 Version 的编号在单个 Job 内部严格单调递增（`revision_001`, `revision_002`）。
4. **Version 来源单一**：每个 Version 必须强绑定唯一的、状态为 `APPROVED` 的 Revision ID。
5. **履约未就绪禁止封版**：若 `SellableOffer.fulfillment_status != READY`，系统底层文件存储模块硬拒绝将 Revision 固化为 Version。
6. **全链路哈希防篡改**：每个 Revision 记录所有产物文件的 SHA-256，读取时进行一致性复核。

---

# 第八部分：Evidence 证据链设计

## 8.1 设计目标

为彻底防止 AI 幻觉和虚假营销，系统建立原子化声明（Claim）与来源证据（Evidence）的双向映射。同时，为避免全篇文案过度死锁，引入 **声明性质（`claim_nature`）分级机制**，实现“事实百分百严控、修辞守底线防夸大”。

## 8.2 Claim 数据结构

```json
{
  "claim_id": "claim_101",
  "claim": "资料包包含5000条提示词",
  "claim_nature": "FACT",
  "claim_type": "QUANTITY",
  "claim_scope": "CONTENT_DRAFT",
  "artifact_ref": "content-draft.json#/selling_points/0",
  "status": "SUPPORTED",
  "evidence_ids": [
    "evidence_201"
  ],
  "requires_human_confirmation": false,
  "created_by_node": "CONTENT_GENERATOR",
  "created_at": "2026-09-15T10:00:00+08:00"
}
```

### 声明性质（`claim_nature`）分级规范：

- `FACT`（客观事实）：涉及数量、版本、文件格式、容量、包含组件、交付渠道等。**强制要求 100% 具备有效证据（SUPPORTED），严禁任何未证实声明**。
- `INFERENCE`（逻辑推论）：基于商品事实对适用人群、常见场景的合理延伸推断。要求逻辑自洽，允许合理演绎。
- `MARKETING_EXPRESSION`（营销修辞）：如“排版精美”、“一目了然”、“省时高效”等修辞文案。不要求字面证据，但必须受合规禁词过滤，严禁含有绝对化或夸大承诺。
- `OPINION`（推荐理由/观点）：主观评价或使用心得建议。
- `COMPLIANCE_DISCLOSURE`（合规告知）：如“虚拟商品下单即发”、“拍前必读”等免责与服务声明。

## 8.3 EvidenceSet JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://local.xianyu-ai/schemas/evidence.schema.json",
  "title": "EvidenceSet",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version",
    "source_product_id",
    "claims",
    "evidence",
    "generated_at"
  ],
  "properties": {
    "schema_version": {
      "type": "string",
      "const": "1.0.0"
    },
    "source_product_id": {
      "type": "string",
      "minLength": 1
    },
    "claims": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "claim_id",
          "claim",
          "claim_nature",
          "claim_type",
          "claim_scope",
          "artifact_ref",
          "status",
          "evidence_ids",
          "requires_human_confirmation"
        ],
        "properties": {
          "claim_id": {
            "type": "string",
            "pattern": "^claim_[A-Za-z0-9_-]+$"
          },
          "claim": {
            "type": "string",
            "minLength": 1
          },
          "claim_nature": {
            "type": "string",
            "enum": [
              "FACT",
              "INFERENCE",
              "MARKETING_EXPRESSION",
              "OPINION",
              "COMPLIANCE_DISCLOSURE"
            ],
            "description": "声明性质。只有 FACT 强制要求 100% 具备有效证据支持。"
          },
          "claim_type": {
            "type": "string",
            "enum": [
              "IDENTITY",
              "QUANTITY",
              "SPECIFICATION",
              "BRAND_MODEL",
              "CONDITION",
              "DELIVERY",
              "AUTHORIZATION",
              "TIMELINESS",
              "PERFORMANCE",
              "BENEFIT",
              "AUDIENCE_FIT",
              "OTHER"
            ]
          },
          "claim_scope": {
            "type": "string",
            "enum": [
              "PRODUCT_DNA",
              "STRATEGY",
              "CONTENT_DRAFT",
              "IMAGE_PLAN",
              "PENDING_LISTING"
            ]
          },
          "artifact_ref": {
            "type": "string",
            "minLength": 1
          },
          "status": {
            "type": "string",
            "enum": [
              "SUPPORTED",
              "PARTIALLY_SUPPORTED",
              "UNSUPPORTED",
              "CONTRADICTED",
              "HUMAN_CONFIRMED"
            ]
          },
          "evidence_ids": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "requires_human_confirmation": {
            "type": "boolean"
          },
          "created_by_node": {
            "type": "string"
          },
          "created_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "evidence_id",
          "source_type",
          "source_reference",
          "excerpt",
          "confidence",
          "recorded_at"
        ],
        "properties": {
          "evidence_id": {
            "type": "string",
            "pattern": "^evidence_[A-Za-z0-9_-]+$"
          },
          "source_type": {
            "type": "string",
            "enum": [
              "SOURCE_DESCRIPTION",
              "SOURCE_IMAGE_OCR",
              "SOURCE_IMAGE_VISION",
              "SOURCE_SPEC_JSON",
              "SELLABLE_OFFER_ASSET",
              "HUMAN_CONFIRMATION"
            ]
          },
          "source_reference": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "file_relative_path",
              "location"
            ],
            "properties": {
              "file_relative_path": {
                "type": "string",
                "minLength": 1
              },
              "location": {
                "type": "string",
                "minLength": 1
              }
            }
          },
          "excerpt": {
            "type": "string",
            "minLength": 1
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1
          },
          "recorded_at": {
            "type": "string",
            "format": "date-time"
          }
        }
      }
    },
    "generated_at": {
      "type": "string",
      "format": "date-time"
    }
  }
}
```

## 8.4 证据判定与出库准入规则

1. **事实 100% 覆盖准则**：在 `VALIDATION` 阶段，所有 `claim_nature == FACT` 的 Claim，其状态必须为 `SUPPORTED` 或 `HUMAN_CONFIRMED`。任何一条未证实（`UNSUPPORTED`）或冲突（`CONTRADICTED`）的事实均直接触发 BLOCKING 错误。
2. **证据层级权威序**：`SELLABLE_OFFER_ASSET`（我方实售资产）> `HUMAN_CONFIRMATION`（人工确认）> `SOURCE_IMAGE_OCR`（原图OCR）> `SOURCE_DESCRIPTION`（原描述正文）> `SOURCE_IMAGE_VISION`（视觉推断）。
3. **文图冲突一票否决**：若原图与原文案出现参数冲突（例如文案写 5000 套，图片写 3000 套），系统强制生成 `FACT_CONFLICT` 风险，必须经过人工复核纠偏后方可解除阻断。

# 第九部分：文件目录设计

## 9.1 工程技术栈与设计原则

根据架构决策，整个 AI 重制模块严格保持与现有采集工程一致的技术栈：
- **单技术栈**：纯 **Electron + Node.js + 文件系统/JSON**；
- **零 Python**：不引入 Python 运行时、venv 虚拟环境或跨语言 RPC；
- **零外部数据库**：不引入 SQLite、MySQL 或 Redis，所有数据以纯文本 JSON 文件原子化持久化；
- **只读隔离**：现有 Playwright 采集产物（`商品素材/商品ID/`）只读挂载，重制输出独立写入 `商品重制输出/`。

## 9.2 代码目录结构（`downloader/src/ai-remake/`）

```text
downloader/
├── package.json
├── src/
│   ├── main/                       # Electron 主进程原有代码
│   ├── renderer/                   # Electron 渲染进程原有代码
│   └── ai-remake/                  # 【新增】商品 AI 重制模块（完全自包含）
│       ├── index.js                # 模块对外统一导出入口
│       ├── config/                 # 模块运行配置
│       │   ├── default.json        # 默认重制参数（超时、重试、启发式阈值）
│       │   └── banned_words.json   # 闲鱼平台违规词/敏感词/引流词词库
│       │
│       ├── schemas/                # JSON Schema 权威契约定义
│       │   ├── source-manifest.v1.schema.json
│       │   ├── sellable-offer.v1.schema.json
│       │   ├── product-dna.v1.schema.json
│       │   ├── product-scorecard.v1.schema.json
│       │   ├── remake-strategy.v1.schema.json
│       │   ├── content-generation.v1.schema.json
│       │   ├── image-plan.v1.schema.json
│       │   ├── evidence-set.v1.schema.json
│       │   ├── job.v1.schema.json
│       │   ├── revision.v1.schema.json
│       │   ├── version.v1.schema.json
│       │   └── validation-report.v1.schema.json
│       │
│       ├── adapters/               # 采集源输入适配器
│       │   ├── source-adapter.js   # 读取原始归档，解析图片/文案，计算哈希，输出 SourceManifest
│       │   └── text-extractor.js   # 提取文案段落与行偏移，为证据链提供字符区间定位
│       │
│       ├── storage/                # 文件存储与版本仓储层
│       │   ├── file-store.js       # 原子写入工具（.tmp -> rename），防半写损坏
│       │   ├── job-repository.js   # Job/Revision/Version 的创建、读取、快照与版本自增
│       │   └── hash-util.js        # SHA-256 计算工具，保证只读溯源与缓存匹配
│       │
│       ├── workflows/              # 状态机编排引擎
│       │   ├── state-machine.js    # 13 状态流转核心驱动器
│       │   ├── context.js          # WorkflowContext 上下文载体
│       │   └── rules.js            # 确定性自动流转规则判定器（6大原则）
│       │
│       ├── nodes/                  # 专用 AI 节点实现（基于大模型 API）
│       │   ├── llm-client.js       # 通用大模型调用封装（结构化 JSON 输出、重试、计时）
│       │   ├── analyst-node.js     # 节点 1：Product Analyst（客观事实提取 -> ProductDNA）
│       │   ├── scorer-node.js      # 节点 2：Product Scorer（1~5分启发式评分 -> ProductScorecard）
│       │   ├── strategy-node.js    # 节点 3：Strategy Generator（生成 1~3 个候选重制策略）
│       │   ├── content-node.js     # 节点 4：Content Generator（单策略驱动 -> 标题/描述/卖点）
│       │   └── image-plan-node.js  # 节点 5：Image Planner（图片处理方案，只做规划不作图）
│       │
│       ├── validators/             # 强校验与风险门禁引擎
│       │   ├── schema-validator.js # 基于 Ajv 的纯 JSON Schema 模式校验
│       │   ├── claim-validator.js  # 证据链校验器（FACT 声明 100% 覆盖）
│       │   ├── rights-gate.js      # 权利状态门禁（NOT_AUTHORIZED 严禁 KEEP）
│       │   ├── fulfillment-gate.js # 交付物就绪门禁（未达 READY 严禁出库）
│       │   └── compliance-gate.js  # 闲鱼电商敏感词、极限词、引流词一票否决
│       │
│       ├── prompts/                # 版本化 Prompt 模板资产
│       │   ├── analyst.prompt.md   # 商品分析提示词（强调不得编造）
│       │   ├── scorer.prompt.md    # 价值评分提示词（1~5分制，强调写明理由与局限）
│       │   ├── strategy.prompt.md  # 策略生成提示词（多角度差异化）
│       │   ├── content.prompt.md   # 文案生成提示词（闲鱼接地气口吻，严守证据）
│       │   └── image-plan.prompt.md# 图片策划提示词（首图吸引力，排版结构）
│       │
│       └── ui-bridge/              # Electron 桥接层（IPC 通信）
│           ├── ipc-handlers.js     # 注册主进程与渲染进程之间的重制事件
│           └── dto-transformer.js  # 将存储层数据转换为前端展示所需的视图模型
```

## 9.3 运行数据目录结构（`商品重制输出/`）

与只读的 `商品素材/` 同级，保证数据完全隔离：

```text
C:/Users/win10/Documents/ChatGPT/闲鱼管理/
├── 商品素材/                                # 【只读】采集归档目录
│   └── 1063279814277/
│       ├── 商品信息.json
│       ├── 文案.txt
│       └── 图片/
│           ├── 01.jpg
│           └── 02.jpg
│
└── 商品重制输出/                            # 【可写】AI 重制模块全生命周期输出
    └── 1063279814277/                       # 按 source_product_id 隔离
        ├── source_manifest.json             # 来源只读快照与文件指纹
        ├── sellable_offer.json              # 实际履约底座配置（我方实际可售资产）
        ├── job.json                         # 当前任务的主控制记录
        │
        ├── revisions/                       # 历次不可变尝试草稿
        │   ├── rev_001/
        │   │   ├── revision.json            # 该 Revision 元数据
        │   │   ├── product_dna.json         # Analyst 输出
        │   │   ├── product_scorecard.json   # Scorer 输出
        │   │   ├── remake_strategies.json   # Strategy Generator 输出（1~3 个候选）
        │   │   ├── selected_strategy.json   # STRATEGY_SELECTION 锁定的唯一策略
        │   │   ├── generated_content.json   # Content Generator 输出
        │   │   ├── image_plan.json          # Image Planner 输出
        │   │   ├── evidence_set.json        # 证据与声明集合
        │   │   └── validation_report.json   # 校验引擎评估报告
        │   │
        │   └── rev_002/                     # 人工调整策略或补充履约后的新 Revision
        │       └── ...
        │
        └── versions/                        # 经 HUMAN_REVIEW 批准后的正式版本
            └── ver_1.0.0/
                ├── version.json             # 正式版本元数据与签署记录
                ├── pending_listing.json     # 标准化可直接上架的发布包
                └── export_assets/           # 导出的上架素材（图片方案描述、脱敏文案）
```

---

# 第十部分：V1 开发顺序

为了确保开发过程“每一步均有可运行、可验证的成果”，严格禁止一上来就全流程联合联调。
按照 **契约先行 → 只读底座 → 存储流转 → 核心节点 → 门禁校验 → 最小交互** 的顺序推进：

| 阶段 | 模块名称 | 核心开发任务 | 交付产物与验收标准 | 依赖项 |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | **数据契约与模式验证** | 1. 在 `schemas/` 中创建 11 个 JSON Schema 文件<br>2. 编写 `test-schemas.js`，使用 Ajv 编译所有 Schema<br>3. 编写合规与非法样例跑通单元测试 | 11 个 Schema 100% 编译通过，非法 JSON 100% 抛出精准错误 | 无 |
| **P1** | **采集适配与快照锁定** | 1. 编写 `source-adapter.js`<br>2. 扫描真实采集目录，计算图片与文案 SHA-256<br>3. 生成标准 `SourceManifest` | 能够正确读取 10 个真实采集商品，生成符合 Schema 的只读快照 | P0 |
| **P2** | **版本存储与原子落盘** | 1. 编写 `file-store.js` 与 `job-repository.js`<br>2. 实现 Revision 目录生成与原子落盘（.tmp 替换）<br>3. 实现 Version 批准封存逻辑 | 支持并发安全的写盘，无半文件损坏，版本自增逻辑无差错 | P0, P1 |
| **P3** | **Analyst 与 Scorer 节点** | 1. 封装 `llm-client.js`（支持 JSON Mode）<br>2. 接入 `Product Analyst`，产出 `ProductDNA`<br>3. 接入 `Product Scorer`，产出 1~5 分 `ProductScorecard` | 针对 10 个样本，Analyst 事实提取准确无虚构，Scorer 正确区分高中低价值 | P1, P2 |
| **P4** | **策略与内容/图片规划** | 1. 接入 `Strategy Generator`（生成 1~3 个差异化策略）<br>2. 实现 `STRATEGY_SELECTION`（人工或显式锁定）<br>3. 接入 `Content Generator`（单策略驱动，带回溯 Claim）<br>4. 接入 `Image Planner`（受 rights 约束的图片规划） | 能够针对选定策略生成闲鱼风标题、文案，并出具 3~5 张图的视觉制作方案 | P3 |
| **P5** | **证据校验与双重门禁** | 1. 编写 `claim-validator.js`（FACT 声明 100% 证据倒查）<br>2. 编写 `rights-gate.js` 与 `fulfillment-gate.js`<br>3. 编写 `compliance-gate.js`（敏感词匹配）<br>4. 输出完整 `ValidationReport` | 虚标、未授权图沿用、履约未就绪、违规词等样本 100% 被自动拦截 | P4 |
| **P6** | **工作流编排与最小 UI** | 1. 编写 `state-machine.js` 串联 13 个状态<br>2. 编写 Electron IPC 通信接口<br>3. 在 Electron 界面提供简易面板：展示 DNA、选择策略、确认履约、一键出库 | 用户可在桌面客户端点击“重制”，浏览分析并人工终审通过生成 Version | P5 |

---

# 第十一部分：真实商品验证方案

验证过程绝不能依靠“跑两个商品看下差不多就行”，必须执行分阶段的严格验证。

## 11.1 双阶段验证策略

```text
┌────────────────────────────────────────────────────────┐
│ 第一阶段：10 样本“架构冒烟测试”（Architecture Smoke Test） │
│ 目标：验证 13 状态流转、数据契约校验、拦截门禁是否有效 │
└──────────────────────────┬─────────────────────────────┘
                           │ 冒烟全部通过，无架构缺陷
                           ▼
┌────────────────────────────────────────────────────────┐
│ 第二阶段：30~50 真实样本“质量定标与 Prompt 调优”       │
│ 目标：校准 1~5 评分尺度、调优文案接地气程度、收集 Bad Case │
└────────────────────────────────────────────────────────┘
```

## 11.2 第一阶段：10 个样本测试矩阵（冒烟测试）

根据闲鱼虚拟商品核心品类，精选 10 个具有极端代表性的样本：

| 编号 | 类别定位 | 典型商品示例 | 核心测试目的 | 预期关键表现 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-01** | 成熟爆款 | 2026 考研政治网盘资料全套（高想要/高销量） | 测试 AI 对高完整度标准品的提取与梳理能力 | Analyst 准确提取，Scorer 给出高分，生成 3 个明确策略 |
| **TC-02** | 成熟爆款 | 1000 套精选商业计划书 PPT 模板大全 | 测试对数量声明的提取精度与结构化归纳 | 准确识别 1000 套，FACT Claim 完整锚定到原文 |
| **TC-03** | 成熟爆款 | 50 款热门自媒体短视频爆款脚本库 | 测试细分场景识别与目标客群锁定能力 | 正确识别短视频创作者客群，卖点聚焦“即插即用” |
| **TC-04** | 成熟爆款 | Python 数据分析全套实战源码及环境包 | 测试复杂交付类型（源码+资料）的履约要求 | 识别交付形态，强制要求绑定 actual_contents |
| **TC-05** | 中长尾普通品 | 办公室常用 Excel 函数公式速查小册子 | 测试普通商品能否通过重新定位重塑买点 | 提炼出“新手救急”、“HR高效办公”等新包装策略 |
| **TC-06** | 中长尾普通品 | 个人整理摄影后期调色预设（50 款） | 测试小众资料重制策略的可信度与文案自然度 | 避免虚标数量，突出风格化与一键套用便利性 |
| **TC-07** | 中长尾普通品 | 幼儿园小班公开课教案及配套课件 | 测试对细分垂直人群痛点的理解深度 | 突出“省备课时间”、“活动设计完整”等痛点 |
| **TC-08** | 中长尾普通品 | 某行业调研报告 PDF 合集（无授权声明） | 测试权利未明状态下的门禁与图片约束 | rights_status 标为 UNKNOWN，原图严禁 KEEP |
| **TC-09** | 垃圾/侵权样本 | 某商业机构付费大课完整录屏（带显眼水印） | 测试版权风险与违规拦截能力 | 版权风险触发，recommended_action=DROP 或强制 REBUILD |
| **TC-10** | 极差/文图冲突 | 文案写 5000 套，图片写 300 套，无发货说明 | 测试文图冲突识别与缺失信息拦截能力 | 触发 FACT_CONFLICT 与 PARTIAL_INPUT，阻断自动流转 |

## 11.3 14 分制人工评审量表（Human Review Rubric）

每个重制样本在人工终审时，按照以下 5 个维度打分：

| 维度 | 分值 | 评分标准 | 达标底线 |
| :--- | :---: | :--- | :--- |
| **1. 事实保真度** | 3分 | 3分：所有参数与内容与原事实或 SellableOffer 100% 一致，无任何无据虚构；<br>1分：存在模糊夸大但未造假数量；<br>0分：捏造数量、版本号、官方背书。 | **必须 3 分**（一票否决） |
| **2. 交付一致性** | 3分 | 3分：文案所承诺的所有赠品、资料、格式均在我方网盘/资源中有实际承载；<br>1分：主体资料在，但赠品暂缺；<br>0分：承诺了完全无法交付的内容。 | **必须 3 分**（一票否决） |
| **3. 差异化包装** | 3分 | 3分：重新提炼出精准场景与人群，比原标题更具吸引力，切中真痛点；<br>2分：常规改写，有一定优化；<br>1分：基本照抄原标题。 | >= 2 分 |
| **4. 闲鱼生态语调** | 3分 | 3分：口吻真实接地气，像个人卖家出闲置/优质整理，无 AI 假大空感，完全合规；<br>2分：稍有机械感但无违规词；<br>0分：充斥“尊贵的顾客”、“震撼来袭”或含违规引流词。 | >= 2 分 |
| **5. 视觉方案可行性**| 2分 | 2分：主图大字报文字精炼，文案层次分明，权利合规处置得当；<br>1分：方案可用但文案过长；<br>0分：逻辑混乱无法指导作图。 | >= 1 分 |

- **合格门槛**：总分 **>= 11 分**，且**事实保真度必须满分（3分）**，**交付一致性必须满分（3分）**。任何一项为 0 分则视为严重 Bad Case。

---

# 第十二部分：Bad Case 分类与处理表

在实际重制和批量测试中，系统必须建立以下 7 类典型 Bad Case 的防御与处理矩阵：

| 故障类型编号 | 故障场景描述 | 典型表现 | 触发的防御层级 | 系统标准处理流程 |
| :--- | :--- | :--- | :--- | :--- |
| **BC-01** | **履约资产未就绪** | 同行写 20 套工作流，我方实售包其实只有 5 套 | `fulfillment-gate` | 校验引擎判定 `fulfillment_status != READY`，抛出 `UNREADY_FULFILLMENT` 阻塞，回退到 `HUMAN_INPUT` 强制人工核销实际资产。 |
| **BC-02** | **版权侵权风险** | 原图带有明确第三方培训机构水印或知名商标 | `rights-gate` | `rights_status` 标记为 `NOT_AUTHORIZED`。Image Planner 严禁输出 KEEP 建议，强制要求生成全新原创文案排版方案（REBUILD）。 |
| **BC-03** | **事实凭空捏造** | 原文为“考公资料”，AI 文案声称“押题命中率95%” | `claim-validator` | 提取的 FACT Claim 无法从原文或图片找到证据支撑，状态为 `UNSUPPORTED`，直接在 VALIDATION 状态拦截，禁止进入 HUMAN_REVIEW。 |
| **BC-04** | **文图信息自相矛盾**| 原商品文案写“发网盘链接”，主图醒目写“光盘包邮” | `analyst-node` | Analyst 抽取时标记 `FACT_CONFLICT` 风险标签。Workflow 暂停自动推进，跳转至 `HUMAN_INPUT` 提示人工确认交付形式。 |
| **BC-05** | **评分伪精确与夸大**| 模型在无市场数据下输出“该商品全网爆款，需求99分” | `scorer-node` | 强制通过枚举规则或 1~5 整数截断，强制注入 `limitations` 解释（“仅依据单商品信息推断，非全网数据”），剔除绝对化词汇。 |
| **BC-06** | **违规引流与敏感词**| 重制文案中出现“加微”、“百度网盘私发”、“保过” | `compliance-gate` | 敏感词词库一票否决，直接在生成节点自动清洗并替换为闲鱼合规交易术语（“拍下自动发提取方式”）。 |
| **BC-07** | **虚假承诺持续更新**| 个人卖家资料包，文案承诺“后续终身免费包更新” | `sellable-offer` | 检查 `SellableOffer.fulfillment_conditions`，若无确凿更新机制，直接拦截此类 Claim，强制降级为“现售静态完整版”。 |

---

# 第十三部分：最终冻结决策与完成检查表

## 13.1 架构冻结签署声明

- **规范签署版本**：`V1.0.0-final-freeze`
- **签署生效日期**：2026-09-16
- **架构地位**：本文档为闲鱼自动铺货助手 AI 重制模块的**唯一权威物理规格说明书**。后续所有 P0~P6 阶段的编码实现、接口定义、数据结构、测试用例，必须严格遵守本文档定义的实体、Schema、状态机与门禁逻辑，任何与本文档冲突的临时实现均视为 Bug。

## 13.2 核心承诺清单

1. **单技术栈承诺**：纯 Electron + Node.js + 文件系统/JSON，坚决不引入 Python 与外部数据库；
2. **原始归档只读承诺**：采集产生的商品原始素材永久只读，通过 SHA-256 建立证据防篡改；
3. **真实交付物理底座**：引入 `SellableOffer`，彻底隔离“同行吹什么”与“我实际卖什么”；
4. **主客观彻底解耦**：`ProductDNA` 只承载客观商品事实，`ProductScorecard` 承载 1~5 分启发式商业评价；
5. **显式策略选择**：Workflow 必须包含 `STRATEGY_SELECTION`，下游文案生成严禁随意使用未确认策略；
6. **分级证据链机制**：FACT 声明 100% 证据倒查，INFERENCE/MARKETING 遵守合规底线，杜绝营销死锁；
7. **双重现实门禁**：版权未授权严禁沿用原图，交付未达到 READY 严禁生成出库包。

## 13.3 完成检查表（Checklist）

- [x] **0. 本文要解决什么**：清晰定义核心业务价值与工程边界；
- [x] **第一部分：领域模型与统一术语**：定义 7 大一级实体与 4 个核心业务技术边界；
- [x] **第二部分：Product DNA、SellableOffer 与 ProductScorecard 模型**：输出 3 个标准 JSON Schema、字段说明表与 6 项不变量；
- [x] **第三部分：重制策略模型**：定义 1~3 个差异化策略结构、plausible 合理性质询与定价策略边界；
- [x] **第四部分：V1 Workflow 状态机**：设计 13 个状态的严格流转契约、明确失败条件与 6 项确定性自动流转规则；
- [x] **第五部分：AI 节点通用契约**：设计统一的输入输出信封规范与共同禁止事项；
- [x] **第六部分：五个 AI 节点契约**：给出 Analyst, Scorer, Strategy, Content, Image Planner 的完整输入/输出 JSON 示例；
- [x] **第七部分：版本系统规范**：定义唯一权威的 Job / Revision / Version 三层结构与重跑级联矩阵；
- [x] **第八部分：Evidence 证据链设计**：设计 Claim 分级体系、EvidenceSet Schema 与出库准入规则；
- [x] **第九部分：文件目录设计**：完整规划 `downloader/src/ai-remake/` 与 `商品重制输出/` 的目录职责；
- [x] **第十部分：V1 开发顺序**：规划 P0~P6 的清晰迭代路线与验收标准；
- [x] **第十一部分：真实商品验证方案**：制定 10 样本冒烟 + 30~50 样本定标双阶段方案与 14 分制人工量表；
- [x] **第十二部分：Bad Case 分类与处理表**：建立 7 类典型故障的防御响应矩阵；
- [x] **第十三部分：最终冻结决策**：签署 `V1.0.0-final-freeze` 终版规范。
