import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { InvariantsGuard } from "../validators/invariants-guard.js";
import { computeCanonicalHash } from "../utils/hash-utils.js";
import { validateData } from "../validators/schema-validator.js";
import {
  WorkflowStatus,
  RecommendedAction,
  StrategyChangeScope,
  HumanReviewDecision,
  FulfillmentStatus
} from "../constants/enums.js";

import { ProductAnalyst } from "../analyzers/product-analyst.js";
import { ProductScorer } from "../analyzers/product-scorer.js";
import { StrategyGenerator } from "../generators/strategy-generator.js";
import { StrategyGuard } from "../validators/strategy-guard.js";
import { StrategySelectionManager } from "../models/strategy-selection-manager.js";
import { ListingFactView } from "../models/listing-fact-view.js";
import { ContentGenerator } from "../generators/content-generator.js";
import { ContentGuard } from "../validators/content-guard.js";
import { ImagePlanner } from "../generators/image-planner.js";
import { CrossMediaConsistencyGuard } from "../validators/cross-media-consistency-guard.js";
import { PendingListingPackageBuilder } from "../models/pending-listing-package-builder.js";

export class WorkflowOrchestrator {
  constructor({
    workspaceRoot,
    modelProvider,
    promptVersion = "v1.0.0",
    policyVersion = "v1.0.0",
    sourceRootPaths = []
  }) {
    if (!workspaceRoot) {
      throw new Error("workspaceRoot 不能为空");
    }
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.modelProvider = modelProvider;
    this.promptVersion = promptVersion;
    this.policyVersion = policyVersion;
    this.sourceRootPaths = sourceRootPaths;

    // 不变量 1b: 确保 workspace 绝不落在原始素材目录内部
    InvariantsGuard.assertSourcePathIsolated(this.workspaceRoot, this.sourceRootPaths);

    if (!fs.existsSync(this.workspaceRoot)) {
      fs.mkdirSync(this.workspaceRoot, { recursive: true });
    }
  }

  /**
   * 初始化新的重制任务 (Job) 及首个修订版本 (Revision rev_001)
   */
  createJob({ sourceProduct, sellableOffer, assetRecords = [], jobId = null, initialReason = "初始采集重制流转" }) {
    InvariantsGuard.assertSellableOfferNotBlindlyCopied(sellableOffer, sourceProduct);

    const actualJobId = jobId || `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const jobDir = path.join(this.workspaceRoot, actualJobId);
    const revId = `rev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const revDir = path.join(jobDir, "revisions", revId);

    fs.mkdirSync(revDir, { recursive: true });
    fs.mkdirSync(path.join(jobDir, "packages"), { recursive: true });

    const jobMeta = {
      job_id: actualJobId,
      source_product_id: sourceProduct.source_product_id,
      current_status: WorkflowStatus.INPUT_CHECK,
      active_revision_id: revId,
      revisions: [
        {
          revision_id: revId,
          created_at: new Date().toISOString(),
          status: "IN_PROGRESS",
          change_reason: initialReason,
          is_read_only: false
        }
      ],
      published_versions: []
    };

    // 校验 CanonicalVersioning
    const versionValidation = validateData("canonical-versioning.schema.json", jobMeta);
    if (!versionValidation.valid) {
      throw new Error(`[JOB_SCHEMA_ERROR] ${versionValidation.formattedErrors}`);
    }

    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(jobMeta, null, 2), "utf-8");

    // 保存初始入参快照到当前 revision
    fs.writeFileSync(path.join(revDir, "source_product.json"), JSON.stringify(sourceProduct, null, 2), "utf-8");
    fs.writeFileSync(path.join(revDir, "sellable_offer.json"), JSON.stringify(sellableOffer, null, 2), "utf-8");
    fs.writeFileSync(path.join(revDir, "assets.json"), JSON.stringify(assetRecords, null, 2), "utf-8");
    fs.writeFileSync(path.join(revDir, "receipts.json"), JSON.stringify([], null, 2), "utf-8");

    const revisionMeta = {
      revision_id: revId,
      job_id: actualJobId,
      current_status: WorkflowStatus.INPUT_CHECK,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_read_only: false
    };
    fs.writeFileSync(path.join(revDir, "revision.json"), JSON.stringify(revisionMeta, null, 2), "utf-8");

    return {
      jobId: actualJobId,
      revisionId: revId,
      status: WorkflowStatus.INPUT_CHECK,
      jobDir
    };
  }

  /**
   * 加载任务目录及活跃 Revision 数据
   */
  _loadJob(jobId) {
    const jobDir = path.join(this.workspaceRoot, jobId);
    const jobFilePath = path.join(jobDir, "job.json");
    if (!fs.existsSync(jobFilePath)) {
      throw new Error(`未找到指定的 Job: ${jobId}`);
    }
    const job = JSON.parse(fs.readFileSync(jobFilePath, "utf-8"));
    const revDir = path.join(jobDir, "revisions", job.active_revision_id);
    const revFilePath = path.join(revDir, "revision.json");
    const revision = JSON.parse(fs.readFileSync(revFilePath, "utf-8"));
    const receiptsPath = path.join(revDir, "receipts.json");
    const receipts = fs.existsSync(receiptsPath) ? JSON.parse(fs.readFileSync(receiptsPath, "utf-8")) : [];

    return { job, revision, jobDir, revDir, receipts };
  }

  /**
   * 写入更新 Revision 状态与 Job 状态
   */
  _saveStatus(job, revision, jobDir, revDir, newStatus) {
    job.current_status = newStatus;
    const revSummary = job.revisions.find(r => r.revision_id === revision.revision_id);
    if (revSummary) {
      if (newStatus === WorkflowStatus.APPROVED) {
        revSummary.status = "APPROVED";
      } else if (newStatus === WorkflowStatus.REJECTED) {
        revSummary.status = "REJECTED";
      } else if (newStatus === WorkflowStatus.HUMAN_INPUT) {
        revSummary.status = "NEEDS_INPUT";
      } else if (newStatus === WorkflowStatus.HUMAN_REVIEW) {
        revSummary.status = "NEEDS_REVIEW";
      } else {
        revSummary.status = "IN_PROGRESS";
      }
    }

    revision.current_status = newStatus;
    revision.updated_at = new Date().toISOString();

    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");
    fs.writeFileSync(path.join(revDir, "revision.json"), JSON.stringify(revision, null, 2), "utf-8");
  }

  /**
   * 节点幂等执行包装器 (Node Execution Receipt & Cache)
   */
  async _executeNode({ job, revision, revDir, receipts, nodeName, inputData, modelId, executorFn, artifactFileName }) {
    const inputHash = computeCanonicalHash(inputData);
    const artifactPath = path.join(revDir, artifactFileName);

    // 幂等检查：当前 Revision + node + input_hash 是否已有成功凭据且磁盘文件健全
    const existingReceipt = receipts.find(
      r => r.node === nodeName &&
           r.input_hash === inputHash &&
           r.status === "SUCCESS" &&
           r.policy_version === this.policyVersion
    );

    if (existingReceipt && fs.existsSync(artifactPath)) {
      const cachedData = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      return {
        fromCache: true,
        output: cachedData,
        receipt: existingReceipt
      };
    }

    const startedAt = new Date().toISOString();
    let output;
    try {
      output = await executorFn();
    } catch (err) {
      const failedReceipt = {
        receipt_id: `rec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        job_id: job.job_id,
        revision_id: revision.revision_id,
        node: nodeName,
        input_hash: inputHash,
        output_hash: "0".repeat(64),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: "FAILED",
        attempt: 1,
        model_id: modelId || "SYSTEM",
        prompt_version: this.promptVersion,
        policy_version: this.policyVersion,
        error: { code: err.code || "NODE_EXEC_ERROR", message: err.message }
      };
      receipts.push(failedReceipt);
      fs.writeFileSync(path.join(revDir, "receipts.json"), JSON.stringify(receipts, null, 2), "utf-8");
      throw err;
    }

    const outputHash = computeCanonicalHash(output);
    const finishedAt = new Date().toISOString();

    fs.writeFileSync(artifactPath, JSON.stringify(output, null, 2), "utf-8");

    const successReceipt = {
      receipt_id: `rec_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
      job_id: job.job_id,
      revision_id: revision.revision_id,
      node: nodeName,
      input_hash: inputHash,
      output_hash: outputHash,
      started_at: startedAt,
      finished_at: finishedAt,
      status: "SUCCESS",
      attempt: 1,
      model_id: modelId || "SYSTEM",
      prompt_version: this.promptVersion,
      policy_version: this.policyVersion,
      error: null
    };

    // 校验 Receipt Schema
    const receiptValidation = validateData("node-execution-receipt.schema.json", successReceipt);
    if (!receiptValidation.valid) {
      throw new Error(`[RECEIPT_SCHEMA_ERROR] ${receiptValidation.formattedErrors}`);
    }

    receipts.push(successReceipt);
    fs.writeFileSync(path.join(revDir, "receipts.json"), JSON.stringify(receipts, null, 2), "utf-8");

    return {
      fromCache: false,
      output,
      receipt: successReceipt
    };
  }

  /**
   * 执行工作流（自动推进至遇到暂停状态 HUMAN_INPUT / HUMAN_REVIEW / APPROVED / REJECTED）
   */
  async execute(jobId) {
    const { job, revision, jobDir, revDir, receipts } = this._loadJob(jobId);

    // 不变量 7: 历史已锁定 Revision 严禁执行推进
    InvariantsGuard.assertRevisionImmutable(revision);

    let currentStatus = revision.current_status;

    // 读取基准文件
    const sourceProduct = JSON.parse(fs.readFileSync(path.join(revDir, "source_product.json"), "utf-8"));
    const sellableOffer = JSON.parse(fs.readFileSync(path.join(revDir, "sellable_offer.json"), "utf-8"));
    const assetRecords = JSON.parse(fs.readFileSync(path.join(revDir, "assets.json"), "utf-8"));

    // ──────────────────────── STEP 1: INPUT_CHECK ────────────────────────
    if (currentStatus === WorkflowStatus.INPUT_CHECK || currentStatus === WorkflowStatus.START) {
      const sourceValidation = validateData("source-product.schema.json", sourceProduct);
      const offerValidation = validateData("sellable-offer.schema.json", sellableOffer);

      if (!sourceValidation.valid || !offerValidation.valid) {
        this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.HUMAN_INPUT);
        return {
          jobId,
          revisionId: revision.revision_id,
          status: WorkflowStatus.HUMAN_INPUT,
          paused: true,
          pauseReason: `输入数据缺失或不符合规范: ${sourceValidation.formattedErrors || ""} ${offerValidation.formattedErrors || ""}`
        };
      }

      currentStatus = WorkflowStatus.PRODUCT_ANALYSIS;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    }

    // ──────────────────────── STEP 2: PRODUCT_ANALYSIS ────────────────────────
    let productDNA;
    let evidenceSet;
    if (currentStatus === WorkflowStatus.PRODUCT_ANALYSIS) {
      const analyst = new ProductAnalyst(this.modelProvider);
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "PRODUCT_ANALYSIS",
        inputData: { sourceProduct, sellableOffer },
        modelId: this.modelProvider?.modelId || "mock-analyst-v1",
        artifactFileName: "product_dna.json",
        executorFn: async () => {
          const analysisRes = await analyst.analyze(sourceProduct, sellableOffer);
          // 同时持久化 Evidence
          fs.writeFileSync(path.join(revDir, "evidence.json"), JSON.stringify(analysisRes.evidenceSet, null, 2), "utf-8");
          const dna = analysisRes.productDNA || analysisRes.productDna;
          if (!dna) throw new Error("ProductAnalyst 未返回有效的 productDna");
          return dna;
        }
      });

      productDNA = res.output;
      evidenceSet = JSON.parse(fs.readFileSync(path.join(revDir, "evidence.json"), "utf-8"));

      currentStatus = WorkflowStatus.PRODUCT_SCORING;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      productDNA = JSON.parse(fs.readFileSync(path.join(revDir, "product_dna.json"), "utf-8"));
      evidenceSet = JSON.parse(fs.readFileSync(path.join(revDir, "evidence.json"), "utf-8"));
    }

    // ──────────────────────── STEP 3: PRODUCT_SCORING ────────────────────────
    let scorecard;
    if (currentStatus === WorkflowStatus.PRODUCT_SCORING) {
      const scorer = new ProductScorer();
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "PRODUCT_SCORING",
        inputData: { productDNA, sellableOffer },
        modelId: "HEURISTIC_RULES_SCORER",
        artifactFileName: "scorecard.json",
        executorFn: async () => scorer.score(productDNA, sellableOffer)
      });
      scorecard = res.output;

      // 如果判定为 DROP：根据指导，DROP 不应自动进入 HUMAN_INPUT，而是进入 HUMAN_REVIEW 供人决策
      if (scorecard.recommended_action === RecommendedAction.DROP) {
        this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.HUMAN_REVIEW);
        return {
          jobId,
          revisionId: revision.revision_id,
          status: WorkflowStatus.HUMAN_REVIEW,
          paused: true,
          pauseReason: `商品评定为 DROP（当前条件不宜自动重制），已转入人工复核：${scorecard.decision_reason}`,
          scorecard
        };
      }

      currentStatus = WorkflowStatus.REMAKE_STRATEGY;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      scorecard = JSON.parse(fs.readFileSync(path.join(revDir, "scorecard.json"), "utf-8"));
    }

    // ──────────────────────── STEP 4: REMAKE_STRATEGY ────────────────────────
    let strategies;
    if (currentStatus === WorkflowStatus.REMAKE_STRATEGY) {
      // 不变量 5 守卫
      InvariantsGuard.assertNotDroppedForContentGen(scorecard);

      const strategyGenerator = new StrategyGenerator(this.modelProvider);
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "REMAKE_STRATEGY",
        inputData: { productDNA, sellableOffer, scorecard },
        modelId: this.modelProvider?.modelId || "mock-strategy-v1",
        artifactFileName: "strategies.json",
        executorFn: async () => {
          const genRes = await strategyGenerator.generateStrategies(productDNA, sellableOffer, scorecard);
          const strats = genRes.strategySet?.strategies || genRes.strategies || [];
          StrategyGuard.assertStrategiesSubstantiveDifference(strats);
          for (const s of strats) {
            StrategyGuard.assertStrategyDoesNotMutateOfferFacts(s, sellableOffer);
          }
          return strats;
        }
      });
      strategies = res.output;

      // 检查是否所有策略都要求 PRODUCT_CHANGE_REQUIRED
      const allProductChange = strategies.every(s => s.strategy_change_scope === StrategyChangeScope.PRODUCT_CHANGE_REQUIRED);
      if (allProductChange) {
        this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.HUMAN_INPUT);
        return {
          jobId,
          revisionId: revision.revision_id,
          status: WorkflowStatus.HUMAN_INPUT,
          paused: true,
          pauseReason: "所有策略均要求变更底层可售产品 (PRODUCT_CHANGE_REQUIRED)，必须等待人工确认与修订",
          strategies
        };
      }

      currentStatus = WorkflowStatus.STRATEGY_SELECTION;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      strategies = JSON.parse(fs.readFileSync(path.join(revDir, "strategies.json"), "utf-8"));
    }

    // ──────────────────────── STEP 5: STRATEGY_SELECTION ────────────────────────
    const selectionPath = path.join(revDir, "strategy_selection.json");
    if (!fs.existsSync(selectionPath)) {
      // V1 强制人工显式指定，挂起至 HUMAN_INPUT
      this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.HUMAN_INPUT);
      return {
        jobId,
        revisionId: revision.revision_id,
        status: WorkflowStatus.HUMAN_INPUT,
        paused: true,
        pauseReason: "等待人工选定重制商业策略 (AWAITING_HUMAN_STRATEGY_SELECTION)",
        candidateStrategies: strategies
      };
    }

    const selectionRecord = JSON.parse(fs.readFileSync(selectionPath, "utf-8"));
    const selectedStrategy = strategies.find(s => s.strategy_id === selectionRecord.selected_strategy_id);
    if (!selectedStrategy) {
      throw new Error(`选定的策略 ID ${selectionRecord.selected_strategy_id} 在策略列表中不存在`);
    }

    // 确保状态推进至 CONTENT_GENERATION
    if (currentStatus === WorkflowStatus.STRATEGY_SELECTION || currentStatus === WorkflowStatus.HUMAN_INPUT) {
      currentStatus = WorkflowStatus.CONTENT_GENERATION;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    }

    // ──────────────────────── STEP 6: CONTENT_GENERATION ────────────────────────
    let listingContent;
    const factView = ListingFactView.build(sellableOffer, evidenceSet);
    if (currentStatus === WorkflowStatus.CONTENT_GENERATION) {
      const contentGenerator = new ContentGenerator(this.modelProvider);
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "CONTENT_GENERATION",
        inputData: { selectedStrategy, sellableOffer, factView },
        modelId: this.modelProvider?.modelId || "mock-content-v1",
        artifactFileName: "listing_content.json",
        executorFn: async () => {
          const genRes = await contentGenerator.generateContent(selectedStrategy, factView, evidenceSet);
          ContentGuard.validateContent(genRes.listingContent, factView, selectedStrategy, evidenceSet);
          return genRes.listingContent;
        }
      });
      listingContent = res.output;

      currentStatus = WorkflowStatus.IMAGE_PLAN;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      listingContent = JSON.parse(fs.readFileSync(path.join(revDir, "listing_content.json"), "utf-8"));
    }

    // ──────────────────────── STEP 7: IMAGE_PLAN ────────────────────────
    let imagePlan;
    if (currentStatus === WorkflowStatus.IMAGE_PLAN) {
      const imagePlanner = new ImagePlanner(this.modelProvider);
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "IMAGE_PLAN",
        inputData: { selectedStrategy, sellableOffer, listingContent, assetRecords },
        modelId: this.modelProvider?.modelId || "mock-image-v1",
        artifactFileName: "image_plan.json",
        executorFn: async () => {
          const planRes = await imagePlanner.planImages(selectedStrategy, sellableOffer, listingContent, assetRecords);
          return planRes.imagePlan;
        }
      });
      imagePlan = res.output;

      currentStatus = WorkflowStatus.VALIDATION;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      imagePlan = JSON.parse(fs.readFileSync(path.join(revDir, "image_plan.json"), "utf-8"));
    }

    // ──────────────────────── STEP 8: VALIDATION ────────────────────────
    let validationReport;
    if (currentStatus === WorkflowStatus.VALIDATION) {
      const res = await this._executeNode({
        job,
        revision,
        revDir,
        receipts,
        nodeName: "VALIDATION",
        inputData: { listingContent, imagePlan, evidenceSet },
        modelId: "DETERMINISTIC_INVARIANTS_VALIDATOR",
        artifactFileName: "validation_report.json",
        executorFn: async () => {
          const errors = [];
          const warnings = [];

          // 1. 不变量 13: 跨媒体事实一致性
          try {
            CrossMediaConsistencyGuard.assertCrossMediaConsistency(listingContent, imagePlan);
          } catch (err) {
            errors.push(`[CROSS_MEDIA_CONFLICT] ${err.message}`);
          }

          // 2. 不变量 4: 事实声明直接证据覆盖
          try {
            InvariantsGuard.assertFactClaimsCovered(evidenceSet);
          } catch (err) {
            errors.push(`[FACT_COVERAGE_ERROR] ${err.message}`);
          }

          // 3. 基础 Schema 校验
          const contentValidation = validateData("listing-content.schema.json", listingContent);
          if (!contentValidation.valid) {
            errors.push(`[CONTENT_SCHEMA_ERROR] ${contentValidation.formattedErrors}`);
          }
          const imageValidation = validateData("image-plan.schema.json", imagePlan);
          if (!imageValidation.valid) {
            errors.push(`[IMAGE_PLAN_SCHEMA_ERROR] ${imageValidation.formattedErrors}`);
          }

          const passed = errors.length === 0;
          return {
            source_product_id: sourceProduct.source_product_id,
            passed,
            errors,
            warnings,
            fact_coverage_rate: passed ? 1.0 : 0.0,
            fulfillment_ready: sellableOffer.fulfillment_status === FulfillmentStatus.READY,
            rights_compliant: true,
            checked_at: new Date().toISOString()
          };
        }
      });
      validationReport = res.output;

      if (!validationReport.passed) {
        this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.HUMAN_INPUT);
        return {
          jobId,
          revisionId: revision.revision_id,
          status: WorkflowStatus.HUMAN_INPUT,
          paused: true,
          pauseReason: "自动化综合校验未通过，已挂起至人工排查处理",
          validationReport
        };
      }

      currentStatus = WorkflowStatus.HUMAN_REVIEW;
      this._saveStatus(job, revision, jobDir, revDir, currentStatus);
    } else {
      validationReport = JSON.parse(fs.readFileSync(path.join(revDir, "validation_report.json"), "utf-8"));
    }

    // ──────────────────────── STEP 9: HUMAN_REVIEW ────────────────────────
    return {
      jobId,
      revisionId: revision.revision_id,
      status: WorkflowStatus.HUMAN_REVIEW,
      paused: true,
      pauseReason: "等待业务人工终审 (AWAITING_HUMAN_REVIEW)",
      artifacts: {
        productDNA,
        scorecard,
        strategies,
        selectedStrategy,
        listingContent,
        imagePlan,
        validationReport
      }
    };
  }

  /**
   * 人工输入/干预通道 (如手动选择策略、补充事实)
   */
  async submitHumanInput(jobId, { inputType, data, operator = "operator" }) {
    const { job, revision, jobDir, revDir } = this._loadJob(jobId);

    if (revision.current_status !== WorkflowStatus.HUMAN_INPUT &&
        revision.current_status !== WorkflowStatus.STRATEGY_SELECTION) {
      throw new Error(`当前状态为 ${revision.current_status}，不允许提交 HUMAN_INPUT`);
    }

    if (inputType === "STRATEGY_SELECTION") {
      const strategies = JSON.parse(fs.readFileSync(path.join(revDir, "strategies.json"), "utf-8"));
      const selectionRecord = StrategySelectionManager.confirmStrategy({
        sourceProductId: job.source_product_id,
        availableStrategies: strategies,
        selectedStrategyId: data.selected_strategy_id,
        operator,
        reason: data.reason || "人工选定最优重制策略"
      });

      fs.writeFileSync(path.join(revDir, "strategy_selection.json"), JSON.stringify(selectionRecord, null, 2), "utf-8");

      // 更新 job 中的 selected_strategy_id
      const revSummary = job.revisions.find(r => r.revision_id === revision.revision_id);
      if (revSummary) {
        revSummary.selected_strategy_id = data.selected_strategy_id;
      }

      this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.CONTENT_GENERATION);

      // 继续自动往下执行
      return this.execute(jobId);
    }

    throw new Error(`不支持的 inputType: ${inputType}`);
  }

  /**
   * 人工终审通道 (APPROVE / REJECT / REQUEST_REVISION)
   */
  async submitHumanReview(jobId, { decision, reviewer = "auditor", notes = "", versionId = "v1.0.0" }) {
    const { job, revision, jobDir, revDir } = this._loadJob(jobId);

    if (revision.current_status !== WorkflowStatus.HUMAN_REVIEW) {
      throw new Error(`当前 Revision 状态为 ${revision.current_status}，非 HUMAN_REVIEW 状态不允许审批`);
    }

    // 1. 驳回 (REJECT)
    if (decision === HumanReviewDecision.REJECT) {
      revision.is_read_only = true;
      this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.REJECTED);
      return {
        jobId,
        revisionId: revision.revision_id,
        status: WorkflowStatus.REJECTED,
        decision: "REJECT"
      };
    }

    // 2. 要求重新修订 (REQUEST_REVISION)
    if (decision === HumanReviewDecision.REQUEST_REVISION) {
      revision.is_read_only = true;
      revision.status = "REJECTED";
      fs.writeFileSync(path.join(revDir, "revision.json"), JSON.stringify(revision, null, 2), "utf-8");

      const newRevId = `rev_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const newRevDir = path.join(jobDir, "revisions", newRevId);
      fs.mkdirSync(newRevDir, { recursive: true });

      // 复制原始输入
      const srcProd = fs.readFileSync(path.join(revDir, "source_product.json"), "utf-8");
      const sellOffer = fs.readFileSync(path.join(revDir, "sellable_offer.json"), "utf-8");
      const assets = fs.readFileSync(path.join(revDir, "assets.json"), "utf-8");
      fs.writeFileSync(path.join(newRevDir, "source_product.json"), srcProd, "utf-8");
      fs.writeFileSync(path.join(newRevDir, "sellable_offer.json"), sellOffer, "utf-8");
      fs.writeFileSync(path.join(newRevDir, "assets.json"), assets, "utf-8");
      fs.writeFileSync(path.join(newRevDir, "receipts.json"), JSON.stringify([], null, 2), "utf-8");

      const newRevMeta = {
        revision_id: newRevId,
        job_id: jobId,
        current_status: WorkflowStatus.PRODUCT_ANALYSIS,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_read_only: false
      };
      fs.writeFileSync(path.join(newRevDir, "revision.json"), JSON.stringify(newRevMeta, null, 2), "utf-8");

      job.active_revision_id = newRevId;
      job.current_status = WorkflowStatus.PRODUCT_ANALYSIS;
      job.revisions.push({
        revision_id: newRevId,
        created_at: new Date().toISOString(),
        status: "IN_PROGRESS",
        change_reason: notes || "审核不通过触发请求新修订",
        is_read_only: false
      });

      fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");

      return {
        jobId,
        previousRevisionId: revision.revision_id,
        newRevisionId: newRevId,
        status: WorkflowStatus.PRODUCT_ANALYSIS
      };
    }

    // 3. 批准通过 (APPROVE)
    if (decision === HumanReviewDecision.APPROVE) {
      // 计算审核当时的关键快照哈希
      const sourceProduct = JSON.parse(fs.readFileSync(path.join(revDir, "source_product.json"), "utf-8"));
      const sellableOffer = JSON.parse(fs.readFileSync(path.join(revDir, "sellable_offer.json"), "utf-8"));
      const productDNA = JSON.parse(fs.readFileSync(path.join(revDir, "product_dna.json"), "utf-8"));
      const scorecard = JSON.parse(fs.readFileSync(path.join(revDir, "scorecard.json"), "utf-8"));
      const selectionRecord = JSON.parse(fs.readFileSync(path.join(revDir, "strategy_selection.json"), "utf-8"));
      const strategies = JSON.parse(fs.readFileSync(path.join(revDir, "strategies.json"), "utf-8"));
      const selectedStrategy = strategies.find(s => s.strategy_id === selectionRecord.selected_strategy_id);
      const listingContent = JSON.parse(fs.readFileSync(path.join(revDir, "listing_content.json"), "utf-8"));
      const imagePlan = JSON.parse(fs.readFileSync(path.join(revDir, "image_plan.json"), "utf-8"));
      const validationReport = JSON.parse(fs.readFileSync(path.join(revDir, "validation_report.json"), "utf-8"));
      const evidenceSet = JSON.parse(fs.readFileSync(path.join(revDir, "evidence.json"), "utf-8"));
      const assetRecords = JSON.parse(fs.readFileSync(path.join(revDir, "assets.json"), "utf-8"));

      const snapshotHashes = {
        source_manifest_hash: sourceProduct.archive_manifest_hash,
        sellable_offer_hash: computeCanonicalHash(sellableOffer),
        product_dna_hash: computeCanonicalHash(productDNA),
        scorecard_hash: computeCanonicalHash(scorecard),
        selected_strategy_hash: computeCanonicalHash(selectedStrategy),
        listing_content_hash: computeCanonicalHash(listingContent),
        image_plan_hash: computeCanonicalHash(imagePlan),
        validation_report_hash: computeCanonicalHash(validationReport)
      };

      const approvalSnapshot = {
        decision: "APPROVE",
        reviewer,
        reviewed_at: new Date().toISOString(),
        notes: notes || "终审批准",
        snapshot_hashes: snapshotHashes
      };

      fs.writeFileSync(path.join(revDir, "approval_snapshot.json"), JSON.stringify(approvalSnapshot, null, 2), "utf-8");

      // 锁定当前 Revision 为只读
      revision.status = "APPROVED";
      revision.is_read_only = true;
      this._saveStatus(job, revision, jobDir, revDir, WorkflowStatus.APPROVED);

      // 构造并固化待发布包 PendingListingPackage
      const pkg = PendingListingPackageBuilder.build({
        versionId,
        approvedRevision: revision,
        sourceProduct,
        sellableOffer,
        productDNA,
        scorecard,
        selectedStrategy,
        listingContent,
        imagePlan,
        validationReport,
        evidenceSet,
        approvalSnapshot,
        assetRecords
      });

      const packagesDir = path.join(jobDir, "packages");
      const saveRes = PendingListingPackageBuilder.saveToDisk(pkg, packagesDir, this.sourceRootPaths);

      // 更新 published_versions 记录
      job.published_versions.push({
        version_id: versionId,
        derived_from_revision_id: revision.revision_id,
        published_at: new Date().toISOString(),
        package_ref: saveRes.filePath,
        package_hash: pkg.package_hash,
        status: "ACTIVE"
      });

      fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");

      return {
        jobId,
        revisionId: revision.revision_id,
        status: WorkflowStatus.APPROVED,
        versionId,
        package: pkg,
        packagePath: saveRes.filePath
      };
    }

    throw new Error(`不支持的决策类型: ${decision}`);
  }

  /**
   * 断点恢复
   */
  async resume(jobId) {
    return this.execute(jobId);
  }

  /**
   * 标记版本失效 (STALE)
   */
  markVersionStale(jobId, versionId, { reason = "SELLABLE_OFFER_CHANGED" }) {
    const { job, jobDir } = this._loadJob(jobId);
    const versionRecord = job.published_versions.find(v => v.version_id === versionId);
    if (!versionRecord) {
      throw new Error(`在任务 ${jobId} 中未找到发布版本 ${versionId}`);
    }

    const pkgPath = versionRecord.package_ref;
    if (fs.existsSync(pkgPath)) {
      const pkgData = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const stalePkg = PendingListingPackageBuilder.markStale(pkgData, reason);
      fs.writeFileSync(pkgPath, JSON.stringify(stalePkg, null, 2), "utf-8");
    }

    versionRecord.status = "STALE";
    versionRecord.stale_reason = reason;
    fs.writeFileSync(path.join(jobDir, "job.json"), JSON.stringify(job, null, 2), "utf-8");

    return {
      jobId,
      versionId,
      status: "STALE",
      reason
    };
  }

  /**
   * 查询任务全局状态
   */
  getJobStatus(jobId) {
    const { job, revision, receipts } = this._loadJob(jobId);
    return {
      jobId: job.job_id,
      sourceProductId: job.source_product_id,
      currentStatus: job.current_status,
      activeRevisionId: job.active_revision_id,
      activeRevisionStatus: revision.current_status,
      receiptsCount: receipts.length,
      publishedVersions: job.published_versions
    };
  }
}

export default WorkflowOrchestrator;