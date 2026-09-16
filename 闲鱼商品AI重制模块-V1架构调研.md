# 闲鱼商品 AI 重制模块：开源调研与 V1 架构方案

> 调研日期：2026-09-15  
> 适用项目：当前工作区 `downloader/` Electron 闲鱼素材下载器  
> 范围：只设计“商品采集完成之后”的 AI 重制模块；不重做采集、账号、发布和 ERP。  
> V1 边界：输出商品分析、新标题、新描述、图片制作方案；**暂不自动生成最终图片，也不自动发布**。

---

## 1. 先给结论

当前没有一个成熟开源仓库能直接覆盖：

`闲鱼采集结果 → 多模态商品理解 → 重新定位卖点 → 文案重写 → 图片策划/生成 → 人工审核 → 发布素材包`

现有项目各自只覆盖一部分，而且大多创建于 2026 年、社区规模很小或仍处于 alpha。因此不建议 Fork 某个项目作为新底座，也不建议在现有 Electron 项目旁边再搭一套 Python/Supabase 系统。

**推荐方案：一个用户可见的「闲鱼商品重制 Skill」，内部运行固定、可追踪的 Workflow。**

- **Skill**：作为统一入口，负责接收商品目录、选择重制动作、展示结果；
- **Workflow**：负责稳定执行“归一化 → 事实提取 → 重制策略 → 文案 → 图片方案 → 校验 → 待审核”；
- **Agent**：V1 不使用。以后只有“联网竞品调研、开放式选品分析”这类不可预先穷举的任务，才作为可选旁路加入；
- **技术栈**：继续使用 Node.js + Electron，不新增 Python 服务，不引入 Supabase；
- **数据保存**：先采用文件夹 + 版本化 JSON。批量规模或查询需求出现后，再考虑 SQLite；
- **质量核心**：模型只负责理解和生成草稿，程序必须负责字段限制、事实引用、状态、版本、去重和审核门。

推荐 V1 主链：

```text
现有商品归档目录
  ├─ 商品信息.json
  └─ 图片/*
          │
          ▼
[1 输入适配与真实性检查]
          │  normalized-input.json
          ▼
[2 多模态商品理解]
          │  product-understanding.json
          ▼
[3 重制策略]
          │  remake-strategy.json
          ▼
[4 标题/描述生成]
          │  copy-draft.json
          ▼
[5 图片制作方案]
          │  image-plan.json
          ▼
[6 硬规则与事实一致性检查]
          │  review.json
          ▼
[7 人工审核]
          │
          ├─ 通过 → result.json / 可发布素材草稿
          └─ 驳回 → 保留原因，定向重跑某一步
```

---

## 2. 当前项目真实基础与约束

### 2.1 已有能力可直接复用

当前 `downloader/` 已具备：

- Electron 桌面入口；
- Playwright 登录态采集；
- 商品标题、描述、来源 URL、采集时间归档；
- 图片下载、尺寸、SHA-256、顺序和失败记录；
- `expanded`、`expected`、`complete`、`uniqueImages` 等完整性信息；
- Sharp 图片处理依赖；
- 便携 Windows 构建基础。

现有商品归档已经是合适的 V1 输入，不需要另造采集数据库。例如：

```json
{
  "id": "1063279814277",
  "title": "拆开了，算是没用过，大疆pocket3",
  "description": "……",
  "url": "https://www.goofish.com/item?id=1063279814277",
  "capturedAt": "2026-09-13T13:41:33.018Z",
  "expanded": true,
  "expected": 3,
  "complete": true,
  "uniqueImages": 3,
  "images": [
    {
      "position": 1,
      "file": "图片/01.webp",
      "width": 1440,
      "height": 1920,
      "sha256": "..."
    }
  ],
  "failed": []
}
```

### 2.2 不能忽略的真实性边界

部分虚拟商品样本可能出现：

- `expanded=false`；
- `complete=false`；
- 图片下载完成，但正文是否展开完整仍待确认。

因此，V1 输入适配器必须产生 `sourceQuality`，而不是把所有归档都当成完整事实。建议：

```json
{
  "sourceQuality": {
    "status": "complete | partial | invalid",
    "textExpanded": true,
    "imageSetComplete": true,
    "missingFields": [],
    "warnings": [],
    "allowGeneration": true,
    "requiresHumanCheck": false
  }
}
```

默认规则：

- `invalid`：阻止生成；
- `partial`：允许生成“待核对草稿”，但禁止标记为可发布；
- `complete`：进入正常流程；
- 模型不得用猜测补齐缺失的品牌、规格、授权、交付内容或售后承诺。

---

## 3. 开源项目调研

> 成熟度判断不能只看 README 功能列表。这里同时考虑：创建/更新情况、社区规模、许可证、架构完整性、测试证据，以及与本项目技术栈和目标的贴合度。仓库状态为 2026-09-15 核对结果，之后可能变化。

### 3.1 对比总表

| 项目 | 主要覆盖 | 值得借鉴 | 主要问题 | 能否直接做基础 |
|---|---|---|---|---|
| [ImgToProduct](https://github.com/zhl0701/ImgToProduct) | 多图理解、结构化 Listing、竞品分析 | 固定 Chain 与 ReAct Agent 分离；多图理解；JSON；人工确认 | Python + Vue；项目很新；无重制策略层；文本事实利用不足 | **否**，借鉴理解链路 |
| [Product Listing AI](https://github.com/KemiZHANG/product-listing-ai) | 商品事实、SEO、文案、图片任务、审核工作台 | 事实/规则/Prompt/输出分层；版本；单任务重跑；候选确认 | Supabase/Auth/Realtime 对本地 V1 过重；无明确许可证；偏跨境电商 | **否**，借鉴数据模型 |
| [product-shots](https://github.com/motiful/product-shots) | 商品图片 Skills | 图片 Brief；图片职责拆分；跨图一致性；硬约束前置 | alpha；只解决视觉；平台场景偏 Amazon/社媒 | **否**，V1 借鉴 `image-plan` |
| [Xianyu Automation](https://github.com/harringtonwalker/xianyu-automation) | 闲鱼内容生成、审核、状态机、发布保护 | 事实约束；revision；状态机；审核门；严格发布回执 | Python + Chrome 扩展；图片只是模板排版；发布超出当前范围；真实发布证据有限 | **否**，借鉴工程护栏 |
| [FishClaw](https://github.com/haiyuzhong1980/FishClaw) | 闲鱼客服、自动回复、自动发货 | 消息任务适配层 | 不是商品重制；Cookie/设备指纹/stealth 风险高；许可证需复核 | **否**，V1 不采用 |

### 3.2 ImgToProduct

**解决什么问题**

将多张商品图片交给视觉模型，生成标题、描述、SEO 标签、价格区间、材质、目标人群和使用场景；另有联网竞品分析。

**核心架构**

- Python/Flask 后端 + Vue 前端；
- 固定 Chain 完成图片到结构化商品 JSON；
- ReAct Agent 只负责开放式竞品分析；
- SQLite 保存用户确认后的结果；
- 前端可编辑模型输出。

代表文件：

- `backend/withLC.py`
- `backend/agent.py`
- `backend/Product.py`
- `backend/database.py`

**值得借鉴**

1. **稳定任务走固定链，开放调查才用 Agent**；
2. 多张图综合判断，而不是逐图各写一份互相冲突的结论；
3. 强制结构化 JSON；
4. 生成后先人工编辑/确认，再持久化。

**不适合本项目的部分**

- 需要新增 Python + Vue 第二套运行时；
- 输入主要依赖图片，而本项目已经拥有文本、图片、来源和完整性状态；
- 缺少“事实 → 重制策略 → 所有输出共享策略”的中间层；
- 社区规模与维护历史不足以称为成熟底座。

**判断**

不 Fork。仅吸收其“固定理解链 + 可选调研 Agent”的边界设计。

### 3.3 Product Listing AI

**解决什么问题**

提供商品 Listing 工作台，结构化保存商品事实、卖点、SEO、规则、类目 Prompt、文案副本、图片任务、生成记录、审核和上品状态。

**核心架构**

- Next.js 14 + TypeScript；
- Supabase 数据库、鉴权和实时数据；
- 文案与图片生成分别形成任务和输出；
- 候选图确认后才替换正式图；
- 支持单张图片重生和失败重试。

代表文件：

- `src/lib/types.ts`
- `src/lib/seo-keywords.ts`
- `supabase/schema.sql`
- `supabase/product_workflow.sql`

**值得借鉴**

1. 商品事实、规则、Prompt、生成结果分层；
2. 一次生成对应一个独立版本，而不是覆盖原结果；
3. 图片按职责建任务，可单独失败、单独重跑；
4. 候选内容经过人工确认后才成为正式输出；
5. 保留失败原因、备注和审核状态，便于 Bad Case 分析。

**不适合本项目的部分**

- Supabase/Auth/Realtime/Vercel 会把本地 Electron V1 变成云端业务系统；
- 多语言、Shopee 和复杂 SEO 不是当前核心；
- GitHub 未明确识别许可证，不应复制其代码；
- 当前只需要单机验证商业价值，不需要运营后台全套能力。

**判断**

不 Fork、不复制代码。借鉴“版本化输出 + 人审 + 可定向重跑”的数据设计。

### 3.4 product-shots

**解决什么问题**

用一组 Agent Skills 组织商品视觉生产，包括主图、详情页、多角度图、广告图和社交图。

**核心架构**

- 一个总路由 Skill；
- 独立图片生成引擎 Skill；
- 按图片职责拆分多个业务 Skill；
- 先形成 Creative Brief，再执行生成；
- 在 Brief 中前置平台约束、行业视觉 DNA、禁用项和跨图一致性锚点；
- 支持 provider fallback 与失败重试。

代表参考：

- `docs/how-it-works.md`
- `skills/product-shots/SKILL.md`
- `skills/product-shots/references/brief-output-and-routing.md`
- `defaults-and-state-machine.md`
- `hard-constraints.md`
- `industry-visual-dna.md`

**值得借鉴**

1. V1 先生成 `image-plan.json`，而不是马上出图；
2. 图片按职责划分：封面、卖点、详情/交付说明；
3. 同一 SKU 共用颜色、字体、主体表现和事实锚点；
4. 尺寸、比例、禁用声明等在生成前写入硬约束；
5. 图片业务规划与具体图片供应商/模型解耦。

**不适合本项目的部分**

- 不负责商品文本事实与文案闭环；
- Amazon/跨境平台规则不能直接套到闲鱼；
- README 明确为 alpha；
- V1 还不生成图片，不需要现在拆出 7 个独立 Skill。

**判断**

不 Fork。只借鉴 Creative Brief 和图片任务职责，等 V2 真正出图时再拆图片执行器。

### 3.5 Xianyu Automation

**解决什么问题**

从商品事实导入开始，生成内容和 3 张方图，经人工审核后进入闲鱼发布流程，并使用状态机、页面契约和严格回执降低误操作。

**核心架构**

- Python 本地服务；
- SQLite 状态机；
- Pillow 模板图/水印；
- 人工审批队列；
- Chrome MV3 最小权限扩展；
- 页面契约和漂移保护；
- 不确定时停止，避免盲目重试发布。

代表文件：

- `docs/architecture.md`
- `xianyu_ops/content.py`
- `xianyu_ops/imaging.py`
- `xianyu_ops/policy.py`
- `xianyu_ops/store.py`
- `tests/test_store_workflow.py`

**值得借鉴**

1. 生成内容必须绑定来源事实和 revision；
2. 建议状态：`INGESTED → GENERATED → NEEDS_REVIEW → APPROVED/REJECTED/FAILED`；
3. 人工审核是正式输出前的硬门；
4. 输入事实变化后，旧生成结果自动过期；
5. 失败即停并保留错误，不重复执行可能产生副作用的动作；
6. 将来发布时必须核对 URL、item ID、标题和价格等真实回执。

**不适合本项目的部分**

- Python 与 Chrome 扩展会重复现有 Electron/Node 能力；
- 图片模块主要是模板排版和水印，不是视觉重制；
- 自动发布不在本次范围内；
- 仓库虽有测试自述，但未提供足够的真实商品发布成功证据；主要验证环境也不是 Windows；
- 其素材授权边界提醒应保留，但不能照搬其完整发布系统。

**判断**

不 Fork。借鉴状态机、事实哈希、审核门和严格回执思想。

### 3.6 FishClaw

**解决什么问题**

闲鱼多账号智能客服、WebSocket 消息接入、自动回复和自动发货，并对接 MCP/OpenClaw。

**核心架构**

- FastAPI + SQLite；
- 多账号 Cookie 管理；
- 消息监听和任务执行；
- 包含设备指纹、反检测、滑块等方向。

**值得借鉴**

只可抽象参考“外部消息 → 标准任务 → 执行器”的适配层。

**不适合本项目的部分**

- 解决的是客服/履约，不是商品重制；
- Cookie 导出、设备指纹和 stealth 会扩大账号与风控风险；
- GitHub 许可证元数据与 README 声明需复核；
- 与 V1 完全无关。

**判断**

不采用，不把反检测和自动发货能力纳入本项目。

---

## 4. 推荐技术路线：Skill 外壳 + 固定 Workflow

### 4.1 三种路线对比

| 维度 | 单个 Skill，内部自由发挥 | 固定 Workflow | 自主 Agent |
|---|---:|---:|---:|
| 任务稳定性 | 中 | **高** | 低到中 |
| 批量处理 | 中 | **高** | 低 |
| 调试和复现 | 中 | **高** | 低 |
| 输出一致性 | 中 | **高** | 低 |
| 定向重跑 | 较弱 | **强** | 较弱 |
| 成本和调用次数可控 | 中 | **高** | 低 |
| V1 开发复杂度 | 低 | **低到中** | 高 |
| 适合开放式竞品研究 | 低 | 中 | **高** |

### 4.2 最终选择

不是三选一，而是明确分层：

```text
用户看到：一个「闲鱼商品重制」Skill
                  │
                  ▼
程序内部：确定性的 Workflow
                  │
                  └─ 以后可选：竞品研究 Agent（旁路，不进入默认批量链）
```

**为什么不能只有一个大 Prompt**

- 商品理解错了，很难判断是输入问题还是文案问题；
- 标题、描述和图片方向可能各自生成、互相矛盾；
- 无法只重跑“标题”或“图片方案”；
- 无法积累是哪一步经常产生 Bad Case；
- 批量任务中断后难以恢复。

**为什么 V1 不用 Agent**

- 步骤顺序可预先确定；
- 工具和输出字段可预先确定；
- 需要稳定批量处理，而不是探索未知路径；
- Agent 会增加不可复现工具选择、循环、成本和失败面；
- “更智能”不等于“更可卖、更真实”。

---

## 5. V1 数据契约

### 5.1 输入：`normalized-input.json`

输入适配器从当前 `商品信息.json` 和图片目录生成统一格式，原文件保持只读。

```json
{
  "schemaVersion": "1.0",
  "jobId": "remake-<sourceId>-<timestamp>",
  "source": {
    "platform": "xianyu",
    "itemId": "1063279814277",
    "url": "https://www.goofish.com/item?id=1063279814277",
    "capturedAt": "2026-09-13T13:41:33.018Z",
    "sourceDirectory": "...",
    "sourceManifestSha256": "..."
  },
  "product": {
    "title": "原始标题",
    "description": "原始描述",
    "category": null,
    "price": null,
    "attributes": {},
    "delivery": null
  },
  "assets": [
    {
      "assetId": "img-01",
      "position": 1,
      "relativePath": "图片/01.webp",
      "width": 1440,
      "height": 1920,
      "sha256": "...",
      "mimeType": "image/webp"
    }
  ],
  "sourceQuality": {
    "status": "complete",
    "textExpanded": true,
    "imageSetComplete": true,
    "missingFields": [],
    "warnings": [],
    "allowGeneration": true,
    "requiresHumanCheck": false
  },
  "rights": {
    "sourceOwnership": "unknown",
    "allowTransform": "unknown",
    "notes": []
  }
}
```

说明：

- `sourceManifestSha256` 将标题、描述、图片哈希和采集状态组合计算；源事实变化后可使旧结果失效；
- `category/price/attributes` 当前采集不到时允许为 `null`，禁止模型凭空补齐；
- `rights` 先记录未知，不假定采集到即拥有二创/发布权；
- V1 不需要迁移原归档，只生成适配副本。

### 5.2 中间一：`product-understanding.json`

```json
{
  "schemaVersion": "1.0",
  "sourceManifestSha256": "...",
  "productType": "实物 | 虚拟资源 | 服务 | 不确定",
  "canonicalName": "商品规范名称",
  "brand": { "value": "DJI", "evidence": ["title", "img-01"], "confidence": 0.98 },
  "model": { "value": "Pocket 3", "evidence": ["title", "img-01"], "confidence": 0.92 },
  "facts": [
    {
      "factId": "fact-001",
      "field": "condition",
      "value": "已拆封，卖家称未使用",
      "evidence": [{ "type": "text", "quote": "拆开了，算是没用过" }],
      "confidence": 0.9
    }
  ],
  "uncertainties": ["是否激活", "配件是否齐全"],
  "forbiddenClaims": ["全新未拆封", "官方授权", "全国联保"],
  "targetUsers": ["需要便携拍摄设备的用户"],
  "useCases": ["旅行记录", "日常拍摄"],
  "currentStrengths": [],
  "currentWeaknesses": [],
  "summary": "仅由已知事实组成的商品理解"
}
```

关键要求：每项重要事实必须带 `evidence`，不确定内容进入 `uncertainties`，不能偷偷写进卖点。

### 5.3 中间二：`remake-strategy.json`

```json
{
  "schemaVersion": "1.0",
  "strategyId": "strategy-001",
  "positioning": "面向什么人，用什么核心价值重新表达",
  "primaryAudience": "核心人群",
  "primaryUseCase": "核心场景",
  "corePromise": "只能由事实支持的核心价值",
  "sellingPoints": [
    {
      "point": "卖点表达",
      "supportedByFactIds": ["fact-001"],
      "priority": 1
    }
  ],
  "deemphasize": ["无证据、低价值或会引发误解的信息"],
  "tone": "自然、可信、非机构化",
  "copyRules": {
    "avoid": ["极限词", "虚假稀缺", "无依据承诺", "伪造销量评价"],
    "mustMentionUncertainty": true
  },
  "visualDirection": {
    "mode": "rebuild | optimize | clean_only",
    "rationale": "为什么这种改动有转化价值",
    "style": "真实商品感，不伪造官方视觉"
  }
}
```

这是整个模块最重要的文件。标题、描述和图片方案都必须引用同一个 `strategyId`，防止三个输出各说各话。

图片处理建议分级：

1. `rebuild`：原图信息表达差，重做主视觉确有价值；
2. `optimize`：主体和信息可信，只需裁切、排版、光色或局部增强；
3. `clean_only`：不需要无意义“二创”，仅在权利允许时清理普通卖家的头像、昵称、二维码等身份痕迹。

版权/作者标识不能当普通卖家身份痕迹自动移除。

### 5.4 中间三：`copy-draft.json`

```json
{
  "schemaVersion": "1.0",
  "strategyId": "strategy-001",
  "titleCandidates": [
    {
      "text": "候选标题",
      "length": 12,
      "factIds": ["fact-001"],
      "score": { "clarity": 4, "appeal": 4, "factuality": 5 }
    }
  ],
  "selectedTitle": "候选标题",
  "description": {
    "text": "新商品描述",
    "factIds": ["fact-001"],
    "sections": ["是什么", "适合谁", "已知状态", "交付/交易说明", "待确认项"]
  },
  "claims": [
    {
      "text": "文案中的声明",
      "supportedByFactIds": ["fact-001"],
      "status": "supported | uncertain | unsupported"
    }
  ]
}
```

V1 建议生成 3 个标题候选，但只生成 1 份完整描述。这样既能比较标题方向，又不会让审核成本成倍增加。

### 5.5 中间四：`image-plan.json`

V1 只输出策划，不调用图片模型。

```json
{
  "schemaVersion": "1.0",
  "strategyId": "strategy-001",
  "globalVisualAnchor": {
    "subject": "必须保持一致的商品主体",
    "colors": ["#F5F5F2", "#1C1C1C"],
    "typography": "清晰、少字、非官方品牌模板",
    "tone": "真实可信",
    "doNotInvent": ["不存在的包装", "不存在的配件", "销量", "评价", "授权标识"]
  },
  "tasks": [
    {
      "taskId": "cover-01",
      "role": "cover",
      "goal": "一眼说明卖什么和核心状态",
      "sourceAssetIds": ["img-01"],
      "operation": "optimize",
      "aspectRatio": "1:1",
      "headline": "建议的图中文字",
      "supportingText": [],
      "composition": "主体位置与留白说明",
      "mustShow": ["真实商品主体"],
      "mustNotShow": ["虚构包装", "伪造官方背书"],
      "manualNotes": []
    },
    {
      "taskId": "detail-01",
      "role": "detail",
      "goal": "展示真实状态或交付内容",
      "sourceAssetIds": ["img-02"],
      "operation": "clean_only",
      "aspectRatio": "3:4",
      "headline": null,
      "composition": "保留原始细节",
      "mustShow": [],
      "mustNotShow": [],
      "manualNotes": []
    }
  ]
}
```

### 5.6 最终：`review.json` 与 `result.json`

```json
{
  "schemaVersion": "1.0",
  "jobId": "...",
  "status": "NEEDS_REVIEW",
  "checks": {
    "sourceComplete": true,
    "titleWithinLimit": true,
    "descriptionWithinLimit": true,
    "allClaimsSupported": false,
    "strategyConsistent": true,
    "imagePlanFactSafe": true,
    "rightsReviewed": false
  },
  "blockingIssues": ["存在 unsupported 声明", "素材权利未确认"],
  "warnings": [],
  "humanDecision": null,
  "humanNotes": null
}
```

`result.json` 只汇总通过校验的当前候选，不覆盖中间文件：

```json
{
  "jobId": "...",
  "sourceManifestSha256": "...",
  "strategyId": "strategy-001",
  "title": "新标题",
  "description": "新描述",
  "imagePlanFile": "image-plan.json",
  "reviewStatus": "NEEDS_REVIEW",
  "publishable": false
}
```

V1 的“最终输出”仍是草稿包，只有人工审核后才能把 `publishable` 变为 `true`。即使变为 true，也只代表内容审核通过，不代表已发布。

---

## 6. 模块划分

建议新增一个独立目录，但复用当前 Electron 工程：

1. **Input Adapter**
   - 读取现有商品 JSON；
   - 校验图片存在、哈希和完整性；
   - 生成 `normalized-input.json`；
   - 不修改原始归档。

2. **Understanding Service**
   - 将标题、描述和多张图一次性提交给多模态模型；
   - 输出事实、证据、不确定项和禁写声明；
   - 只负责“这是什么”，不直接写营销文案。

3. **Strategy Service**
   - 基于理解结果选择目标人群、使用场景、卖点优先级和图片处理等级；
   - 所有后续输出共享同一 `strategyId`。

4. **Copy Service**
   - 生成 3 个标题候选和 1 份描述；
   - 为每项声明附事实引用；
   - 不负责硬限制的最终判定。

5. **Image Planning Service**
   - 根据策略和原图职责形成图片清单；
   - 只写策划，不生成图片；
   - 明确重做、优化或仅净化。

6. **Validator**
   - JSON Schema 校验；
   - 标题/描述长度检查；
   - `claim → factId` 完整性检查；
   - 源输入 partial/invalid 门控；
   - 禁用词、虚构声明和策略一致性检查；
   - 后续平台规则变化时只改规则文件，不改 Prompt 主体。

7. **Versioned Job Store**
   - 每次运行创建新目录；
   - 中间结果只追加或生成新 revision，不覆盖来源；
   - 保存模型、Prompt 版本、耗时和错误；
   - V1 用文件即可。

8. **Review UI**
   - 左侧原始事实/原图，右侧分析、策略和生成草稿；
   - 支持编辑、通过、驳回、只重跑某一步；
   - 默认状态 `NEEDS_REVIEW`。

---

## 7. 文件结构建议

保持现有 `downloader/` 入口，不复制一套应用：

```text
downloader/
├─ core.mjs                       # 现有采集/归档，尽量不动
├─ server.mjs                     # 现有本地服务，增加少量重制 API 路由
├─ desktop.cjs                    # 现有 Electron 主进程
├─ index.html                     # 现有界面；后续增加“AI 重制”入口
├─ remake/
│  ├─ index.mjs                   # Workflow 统一入口
│  ├─ workflow.mjs                # 确定性步骤编排/恢复
│  ├─ adapters/
│  │  └─ xianyu-archive.mjs       # 当前商品归档 → normalized input
│  ├─ services/
│  │  ├─ understand.mjs
│  │  ├─ strategize.mjs
│  │  ├─ write-copy.mjs
│  │  └─ plan-images.mjs
│  ├─ validators/
│  │  ├─ input.mjs
│  │  ├─ facts.mjs
│  │  ├─ copy.mjs
│  │  └─ review.mjs
│  ├─ schemas/
│  │  ├─ normalized-input.schema.json
│  │  ├─ product-understanding.schema.json
│  │  ├─ remake-strategy.schema.json
│  │  ├─ copy-draft.schema.json
│  │  ├─ image-plan.schema.json
│  │  └─ review.schema.json
│  ├─ prompts/
│  │  ├─ understand.v1.md
│  │  ├─ strategy.v1.md
│  │  ├─ copy.v1.md
│  │  └─ image-plan.v1.md
│  ├─ rules/
│  │  ├─ xianyu.v1.json
│  │  ├─ forbidden-claims.json
│  │  └─ rights-policy.json
│  └─ tests/
│     ├─ fixtures/
│     ├─ adapter.test.mjs
│     ├─ validator.test.mjs
│     └─ golden-cases.test.mjs
└─ 商品重制输出/
   └─ <source-id>/
      └─ <job-id>/
         ├─ normalized-input.json
         ├─ product-understanding.json
         ├─ remake-strategy.json
         ├─ copy-draft.json
         ├─ image-plan.json
         ├─ review.json
         ├─ result.json
         └─ run.json
```

V1 不建议：

- 新建 Python 后端；
- 上 Supabase；
- 把每一步做成独立 Skill；
- 引入消息队列；
- 自动发布；
- 先做复杂 Prompt 管理平台；
- 为了“AI 二创”强制每张图都重生成。

---

## 8. Workflow 状态与失败恢复

建议最小状态：

```text
INGESTED
  → UNDERSTOOD
  → STRATEGIZED
  → COPY_DRAFTED
  → IMAGE_PLANNED
  → NEEDS_REVIEW
  → APPROVED | REJECTED

任一步骤可进入 FAILED
源事实哈希变化后进入 STALE
```

规则：

- 每一步只有在上一步 JSON 通过 Schema 和语义校验后才能继续；
- 同一 `sourceManifestSha256 + promptVersion + model` 可复用缓存；
- 修改标题只产生 `copyRevision`，不必重跑商品理解；
- 修改重制策略后，文案和图片方案都标记 `STALE` 并重新生成；
- 源图片/正文变化后，所有下游结果标记 `STALE`；
- 失败保留已完成步骤，允许从失败点继续；
- 不使用一个“成功/失败”布尔值覆盖全流程。

---

## 9. V1 UI 最小闭环

Electron 中只增加一个清晰入口：

```text
商品归档列表
  → 选择一个商品
  → 点击“AI 重制”
  → 显示运行步骤
  → 审核页
```

审核页建议四块：

1. **原始信息**：标题、描述、原图、来源完整性；
2. **AI 理解**：事实、证据、不确定项、禁写内容；
3. **重制结果**：定位、标题候选、描述；
4. **图片方案**：每张图的职责、源图、处理等级和构图说明。

最小操作：

- 编辑选中标题；
- 编辑描述；
- 通过/驳回；
- 填写驳回原因；
- 只重跑“理解 / 策略 / 文案 / 图片方案”之一；
- 导出草稿 JSON/文本。

V1 不需要：拖拽画布、在线团队协作、自动上架、图片生成模型选择器。

---

## 10. 开发优先级与验收标准

### P0：先定义真值和数据契约

交付：

- 6 个 JSON Schema；
- 输入完整性门控；
- 事实、证据、不确定项、禁写声明结构；
- 10 个真实商品测试集，覆盖：实物、虚拟资料、正文不完整、图片缺失、品牌/型号不确定等。

验收：

- 原始归档只读；
- partial 输入不会误标可发布；
- Schema 可捕获缺字段、错误枚举和无效事实引用。

### P1：只跑商品理解

交付：

- 多模态理解 Prompt；
- `product-understanding.json`；
- 审核页面可看到每项事实证据。

验收重点不是文案好不好，而是：

- 商品类型和交付物是否理解正确；
- 是否区分已知事实与推测；
- 是否遗漏关键限制；
- 是否虚构品牌、规格、授权或状态。

建议 10 个样本中：关键事实准确率 ≥ 90%，严重虚构为 0；否则不进入 P2。

### P2：重制策略

交付：

- `remake-strategy.json`；
- 人工可选“采用 / 修改 / 驳回”；
- 图片处理分级。

验收：

- 策略能解释“卖给谁、解决什么、为什么这样表达”；
- 每个卖点均有事实支持；
- 不是无意义同义改写；
- 不为了二创强制改图。

### P3：新标题与描述

交付：

- 3 个标题候选；
- 1 份描述；
- claim-to-fact 检查；
- 规则校验和人工编辑。

验收：

- 标题/描述符合当前配置的长度限制；
- 标题、描述与策略一致；
- 没有销量、评价、官方授权、效果和持续服务等无依据承诺；
- 10 个样本中至少 7 个无需重写核心定位，只需轻微编辑即可接受。

### P4：图片制作方案

交付：

- `image-plan.json`；
- 每张图明确职责、源图、处理等级、比例、必须/禁止内容；
- 人工可修改。

验收：

- 图片方案与同一策略一致；
- 不虚构包装、配件、Logo 或证明；
- 能明确判断重做、局部优化或仅净化；
- V1 到这里结束，不调用图片生成 API。

### P5：V1 批量与复盘

先小批量，不是一开始无限批处理：

- 10 个真实商品跑完全链；
- 记录每一步接受、修改、驳回原因；
- 保存模型/Prompt 版本、耗时、费用和错误；
- 输出 Bad Case 汇总。

V1 商业验证指标：

| 指标 | 建议阈值 |
|---|---:|
| 严重事实虚构 | 0 |
| 商品理解关键事实准确率 | ≥ 90% |
| 策略核心方向直接可接受率 | ≥ 70% |
| 标题/描述仅轻改可用率 | ≥ 70% |
| 单商品人工审核时间 | ≤ 3 分钟 |
| 失败后可从断点恢复 | 100% |

这些是 V1 建议门槛，不是当前已验证成绩。

---

## 11. 后续升级路线

### V1：理解和策划闭环

- 单商品运行；
- 分步结构化输出；
- 人工审核；
- 不出图、不发布；
- 用 10 个真实商品验证理解和策略。

### V1.1：批量、版本和 Bad Case

- 批量队列；
- 文件版 job store，必要时升级 SQLite；
- Prompt/模型版本对比；
- 按商品类型统计驳回原因；
- 建立 golden cases 回归集。

### V2：图片执行器

- 依据 `image-plan` 定向处理；
- 先支持低风险的裁切、尺寸、排版、光色、身份痕迹人工标记；
- 再接图片生成/编辑 provider；
- 图片任务独立重跑，保持跨图一致性；
- 生成结果仍需人工确认；
- 保留原图和每个候选版本。

### V2.1：类目策略模板

- 实物、虚拟资源、服务分别使用策略规则；
- 模板只定义结构和禁区，不把商品事实写死；
- 从实际 Bad Case 反推规则，不凭想象扩展。

### V3：可选竞品研究 Agent

只在用户主动选择时运行：

- 搜索公开同类商品/趋势；
- 输出“外部观察”和来源；
- 不能直接覆盖内部事实；
- 竞品信息只能影响定位建议，不能变成当前商品属性；
- 默认批量重制链不依赖 Agent。

### V4：发布适配

只有前面内容质量稳定后再做：

- 将 APPROVED 结果映射为闲管家/闲鱼字段；
- 发布前重新核验平台字段、尺寸和权限；
- 人工最终确认；
- 幂等键、防重复发布、严格回执；
- 发布完成必须读取真实 item ID/URL 和关键字段，不把“点击了发布”当成功。

---

## 12. 风险与诚实边界

1. **素材权利**：采集成功不代表拥有复制、删除水印或二次发布权；必须区分普通卖家身份痕迹与版权/作者标识。
2. **事实幻觉**：不得凭空增加销量、评价、授权、功能、成色、配件、效果、持续服务或售后承诺。
3. **虚拟商品**：尤其要核对真实交付物、格式、数量、更新方式和授权范围；正文未展开时只可输出待核对草稿。
4. **平台规则会变化**：当前观察到的标题、描述、图片限制应进入可配置规则，发布前重新核验，不能硬编码为永恒事实。
5. **模型输出非真值**：即使 JSON 格式正确也可能语义错误；Schema 校验不能替代人工事实审核。
6. **无意义二创**：不是每张图都应重做。改动必须能提高信息清晰度、可信度或转化表达，否则保留原图更好。
7. **自动发布风险**：V1 不做发布。未来也必须经过审核、幂等和真实回执验证。

---

## 13. 最终决策清单

- [x] 保留现有 Electron + Node 项目作为唯一宿主；
- [x] 不重做采集系统；
- [x] 一个 Skill 对外，不拆成五个用户入口；
- [x] Skill 内部采用固定 Workflow；
- [x] V1 不采用 Agent；
- [x] V1 不自动生成图片；
- [x] 原归档只读，新结果按 job/revision 保存；
- [x] 商品事实与重制策略分开；
- [x] 标题、描述、图片方案共享同一个策略；
- [x] 所有营销声明必须可追溯到事实；
- [x] partial 输入默认不能变成可发布状态；
- [x] 人工审核是正式输出硬门；
- [x] 先用 10 个真实商品验证，再扩展图片和发布。

**一句话方案：**

> 在现有 Electron 下载器中新增一个「闲鱼商品重制」入口，用版本化 JSON 驱动固定 Workflow；先把“商品理解 → 重制策略 → 标题/描述 → 图片策划 → 人审”跑准，再加入图片执行和发布能力。

---

## 14. 参考仓库

- ImgToProduct：<https://github.com/zhl0701/ImgToProduct>
- Product Listing AI：<https://github.com/KemiZHANG/product-listing-ai>
- product-shots：<https://github.com/motiful/product-shots>
- Xianyu Automation：<https://github.com/harringtonwalker/xianyu-automation>
- FishClaw：<https://github.com/haiyuzhong1980/FishClaw>

仓库的 Stars、维护状态、许可证和文件结构均可能变化；正式采用代码前应重新核对许可证和最新提交。当前方案主要借鉴架构思想，不要求复制这些项目代码。
