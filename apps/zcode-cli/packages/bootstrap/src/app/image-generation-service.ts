import { createHash } from "node:crypto";
import {
  ImageGenerationError,
  type ImageGenerationConnection,
  type ImageGenerationPort,
  type TraceContext,
} from "@zcode/contracts";
import {
  IMAGE_CHUNK_BYTES,
  imageGenerationInputSchema,
  imageGenerationSettingsSchema,
  getImageReferenceCapacity,
  imageReferenceCapacityMessage,
  type ImageArtifact,
  type ImageGenerationInput,
  type ImageGenerationRequest,
  type ImageGenerationReply,
  type ImageGenerationSettings,
  type ImageJob,
} from "@zcode/shared/image-generation";
import { resolveImageTaskInput } from "./image-task-input.js";

import { ImageTaskArtifacts, describeRecentImageJobs } from "./image-task-artifacts.js";

import type { ImageTaskServiceOptions } from "./image-task-options.js";
export type { ImageTaskServiceOptions } from "./image-task-options.js";

/** The sole owner of accepted image jobs; clients read snapshots, never own queues. */
export class ImageTaskService implements ImageGenerationPort {
  private settings = imageGenerationSettingsSchema.parse({});
  private readonly jobs = new Map<string, ImageJob>();
  private readonly references = new Map<string, ImageArtifact>();
  private readonly flights = new Map<string, Promise<ImageJob>>();
  private readonly controllers = new Map<string, AbortController>();
  private tail: Promise<unknown> = Promise.resolve();
  private admission: Promise<unknown> = Promise.resolve();
  private readonly ready: Promise<void>;
  private readonly binaries: ImageTaskArtifacts;

  constructor(private readonly options: ImageTaskServiceOptions) {
    this.binaries = new ImageTaskArtifacts(options);
    this.ready = this.restore();
  }

  initialize(): Promise<void> {
    return this.ready;
  }
  isEnabled(): boolean {
    return this.options.available !== false && this.settings.enabled;
  }
  hasRunningTasks(): boolean {
    return [...this.jobs.values()].some(
      (job) => job.status === "queued" || job.status === "running",
    );
  }
  describeRecentImages(): string {
    return describeRecentImageJobs(this.jobs.values());
  }
  async close(): Promise<void> {
    await this.ready;
    for (const job of this.jobs.values()) {
      if (job.status !== "queued" && job.status !== "running") continue;
      job.status = "interrupted";
      job.updatedAt = Date.now();
      job.error = {
        code: "owner_closed",
        message: "Image worker closed. Retry explicitly to start another request.",
      };
      this.controllers.get(job.id)?.abort("owner_closed");
      await this.options.journal.writeJob(job);
    }
    await Promise.allSettled(this.flights.values());
  }

  private async restore(): Promise<void> {
    const saved = await this.options.journal.load();
    this.settings = imageGenerationSettingsSchema.parse({
      ...saved.settings,
      ...this.options.initialSettings,
    });
    for (const artifact of saved.references) this.references.set(artifact.id, artifact);
    for (const job of saved.jobs) {
      if (job.status === "queued" || job.status === "running") {
        job.status = "interrupted";
        job.updatedAt = Date.now();
        job.error = {
          code: "owner_restarted",
          message: "The image worker restarted. Retry explicitly to start a new request.",
        };
        await this.options.journal.writeJob(job);
      }
      this.jobs.set(job.id, job);
    }
  }

  async request(request: ImageGenerationRequest): Promise<ImageGenerationReply> {
    await this.ready;
    if (request.sessionId !== this.options.sessionId)
      throw new ImageGenerationError("not_found", "Image session not found");
    switch (request.action) {
      case "list":
        return structuredClone({
          capabilities: { maskEditing: true },
          settings: this.settings,
          jobs: [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt),
          references: [...this.references.values()],
        });
      case "configure": {
        this.options.assertUserSubmission?.();
        const settings = imageGenerationSettingsSchema.parse(request.settings);
        if (settings.enabled && this.options.available === false)
          throw new ImageGenerationError(
            "missing_resources",
            "The bundled image-generation skill is missing. Repair the application package to enable images.",
          );
        await this.options.journal.writeSettings(settings);
        this.settings = settings;
        this.options.onSettingsChanged?.(settings.enabled);
        return { settings };
      }
      case "submit": {
        this.options.assertUserSubmission?.();
        await this.options.beforeUserSubmission?.(request.input);
        return { job: await this.submit(request.input, request.commandId, "user") };
      }
      case "cancel":
        return { job: await this.cancel(request.jobId) };
      case "import": {
        this.options.assertUserSubmission?.();
        const id = `ref-${request.uploadId}`;
        const previous = this.references.get(id);
        if (previous) return { artifact: previous };
        const artifact = await this.binaries.importChunk(request);
        if (!artifact) return {};
        this.references.set(id, artifact);
        return { artifact };
      }
      case "read": {
        const artifact = this.artifact(request.artifactId);
        const bytes = request.preview
          ? await this.binaries.preview(artifact, request.preview)
          : await this.binaries.read(artifact);
        const end = Math.min(bytes.length, request.offset + IMAGE_CHUNK_BYTES);
        return {
          artifact,
          data: Buffer.from(bytes.subarray(request.offset, end)).toString("base64"),
          totalBytes: bytes.length,
          nextOffset: end >= bytes.length ? null : end,
        };
      }
      case "export": {
        this.options.assertUserSubmission?.();
        const artifact = this.artifact(request.artifactId);
        return {
          path: await this.options.journal.exportImage(
            artifact,
            await this.binaries.read(artifact),
          ),
        };
      }
    }
  }

  async execute(
    input: ImageGenerationInput,
    options: { commandId: string; signal?: AbortSignal; trace?: TraceContext },
  ): Promise<ImageJob> {
    await this.ready;
    if (options.signal?.aborted)
      throw new ImageGenerationError("cancelled", "Image request cancelled");
    const job = await this.submit(input, options.commandId, "agent", options.trace);
    const abort = () => {
      void this.cancel(job.id);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    try {
      const result = await (this.flights.get(job.id) ?? Promise.resolve(this.jobs.get(job.id)!));
      if (result.status !== "succeeded")
        throw new ImageGenerationError(
          result.error?.code ?? result.status,
          result.error?.message ?? `Image request ${result.status}`,
          result.error?.status,
        );
      return structuredClone(result);
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }

  private submit(
    input: ImageGenerationInput,
    commandId: string,
    origin: ImageJob["origin"],
    trace?: TraceContext,
  ): Promise<ImageJob> {
    const accepted = this.admission
      .catch(() => {})
      .then(() => this.admit(input, commandId, origin, trace ?? this.options.trace));
    this.admission = accepted;
    return accepted;
  }

  private async admit(
    raw: ImageGenerationInput,
    commandId: string,
    origin: ImageJob["origin"],
    trace?: TraceContext,
  ): Promise<ImageJob> {
    if (this.options.available === false)
      throw new ImageGenerationError(
        "missing_resources",
        "The bundled image-generation skill is missing. Repair the application package.",
      );
    if (!this.settings.enabled)
      throw new ImageGenerationError(
        "disabled",
        "Enable image generation in the image workbench or CLI configuration",
      );
    const input = imageGenerationInputSchema.parse(raw);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const id = `image-${createHash("sha256").update(`${this.options.sessionId}\0${commandId}`).digest("hex").slice(0, 32)}`;
    const previous = this.jobs.get(id);
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ImageGenerationError(
          "command_conflict",
          "This command ID already identifies a different request",
        );
      return structuredClone(previous);
    }
    // 重放先返回原任务；只限制新请求，并把自动插入的编辑目标计入数量。
    const capacity = getImageReferenceCapacity(input);
    if (capacity.exceeded)
      throw new ImageGenerationError(
        "reference_capacity_exceeded",
        imageReferenceCapacityMessage(input.size, capacity.limit!),
      );
    // Capture the resolved provider and secret once. Neither is written into the journal.
    const settings = { ...this.settings };
    const connection = this.options.connection(settings.providerId);
    const job: ImageJob = {
      schemaVersion: 1,
      id,
      commandId,
      requestHash,
      origin,
      status: "queued",
      input,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(id, job);
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      await this.options.journal.writeJob(job);
    } catch (error) {
      this.jobs.delete(id);
      this.controllers.delete(id);
      throw error;
    }
    const flight = this.tail
      .catch(() => {})
      .then(() => this.run(job, connection, settings, controller, trace));
    this.tail = flight;
    this.flights.set(id, flight);
    void flight
      .finally(() => {
        this.controllers.delete(id);
        this.flights.delete(id);
      })
      .catch(() => {});
    return structuredClone(job);
  }

  private async run(
    job: ImageJob,
    connection: ImageGenerationConnection,
    settings: ImageGenerationSettings,
    controller: AbortController,
    trace?: TraceContext,
  ): Promise<ImageJob> {
    if (job.status !== "queued") return job;
    const timeout = setTimeout(() => controller.abort("timeout"), settings.timeoutMs);
    try {
      job.status = "running";
      job.updatedAt = Date.now();
      await this.options.journal.writeJob(job);
      const { input, references, mask } = await resolveImageTaskInput(job, {
        artifact: (id) => this.findArtifact(id),
        job: (id) => this.jobs.get(id),
        read: (artifact) => this.binaries.read(artifact),
        readWorkspace: (path) => this.options.journal.readWorkspaceImage(path),
      });
      job.input = input;
      if (controller.signal.aborted)
        throw new ImageGenerationError("cancelled", "Image request cancelled");
      const image = await this.options.adapter.generate({
        request: job.input,
        connection,
        model: settings.model,
        timeoutMs: settings.timeoutMs,
        references,
        mask,
        signal: controller.signal,
        trace,
      });
      if (job.status !== "running") return job;
      if (controller.signal.aborted)
        throw new ImageGenerationError("timeout", "Image request deadline exceeded");
      const artifact = await this.binaries.persist(
        job.id,
        image,
        `qwen-${job.id}`,
        input.seed,
        trace,
      );
      if (job.status !== "running") return job;
      if (controller.signal.aborted)
        throw new ImageGenerationError("timeout", "Image request deadline exceeded");
      const completed: ImageJob = { ...job, artifact, status: "succeeded", updatedAt: Date.now() };
      await this.options.journal.writeJob(completed);
      // 提交期间可能收到取消；旧成功结果不能覆盖先被接受的终止状态。
      if (job.status !== "running") {
        await this.options.journal.writeJob(job);
        return job;
      }
      if (controller.signal.aborted)
        throw new ImageGenerationError("timeout", "Image request deadline exceeded");
      Object.assign(job, completed);
      this.options.onJobCompleted?.();
    } catch (error) {
      if (new Set<string>(["cancelled", "interrupted"]).has(job.status)) return job;
      job.status = "failed";
      job.artifact = undefined;
      const code =
        controller.signal.reason === "timeout"
          ? "timeout"
          : error instanceof ImageGenerationError
            ? error.code
            : "image_operation_failed";
      job.error = {
        code,
        message:
          error instanceof ImageGenerationError
            ? error.message
            : "Image operation failed. Check the provider connection and storage availability.",
        ...(error instanceof ImageGenerationError && error.status ? { status: error.status } : {}),
      };
      job.updatedAt = Date.now();
      await this.options.journal.writeJob(job);
    } finally {
      clearTimeout(timeout);
    }
    return job;
  }

  private async cancel(id: string): Promise<ImageJob> {
    const job = this.jobs.get(id);
    if (!job) throw new ImageGenerationError("not_found", "Image task not found");
    if (job.status === "queued" || job.status === "running") {
      job.status = "cancelled";
      job.updatedAt = Date.now();
      job.error = {
        code: "cancelled",
        message: "Request cancelled; upstream GPU cancellation is not guaranteed.",
      };
      this.controllers.get(id)?.abort("cancelled");
      await this.options.journal.writeJob(job);
    }
    return structuredClone(job);
  }

  private findArtifact(id: string): ImageArtifact | undefined {
    return this.references.get(id) ?? this.jobs.get(id)?.artifact;
  }
  private artifact(id: string): ImageArtifact {
    const artifact = this.findArtifact(id);
    if (!artifact)
      throw new ImageGenerationError("not_found", "Image artifact not found in this session");
    return artifact;
  }
}
