import { createHash } from "node:crypto";
import {
  ImageGenerationError,
  type ToolArtifactStorePort,
  type ImageJournalPort,
  type ImageGenerationBinary,
  type TraceContext,
  type SessionId,
} from "@zcode/contracts";
import {
  IMAGE_CHUNK_BYTES,
  type ImageArtifact,
  type ImageJob,
  type ImageGenerationRequest,
} from "@zcode/shared/image-generation";
import {
  decodeImageBase64,
  inspectImage,
  createImagePreview,
} from "@zcode/adapters/image-generation";

/** Binary persistence and integrity; the session service owns all version indexes. */
export class ImageTaskArtifacts {
  private readonly previews = new Map<string, Promise<Uint8Array>>();
  async preview(artifact: ImageArtifact, size: "canvas" | "reference"): Promise<Uint8Array> {
    const key = `${artifact.sha256}:${size}`;
    let value = this.previews.get(key);
    if (!value) {
      value = this.read(artifact).then((bytes) =>
        createImagePreview(bytes, artifact.mimeType, size === "canvas" ? 1024 : 128),
      );
      this.previews.set(key, value);
      void value.catch(() => this.previews.delete(key));
      if (this.previews.size > 16) this.previews.delete(this.previews.keys().next().value!);
    }
    return value;
  }
  constructor(
    private readonly options: {
      trace?: TraceContext;
      sessionId: string;
      artifacts: ToolArtifactStorePort;
      journal: ImageJournalPort;
    },
  ) {}
  async importChunk(
    request: Extract<ImageGenerationRequest, { action: "import" }>,
  ): Promise<ImageArtifact | undefined> {
    const bytes = await this.options.journal.uploadChunk(
      request.uploadId,
      request.offset,
      decodeImageBase64(request.data, IMAGE_CHUNK_BYTES),
      request.final,
    );
    if (!bytes) return undefined;
    try {
      const artifact = await this.persist(
        `ref-${request.uploadId}`,
        await inspectImage(bytes),
        request.name,
      );
      await this.options.journal.writeReference(artifact);
      return artifact;
    } finally {
      await this.options.journal.removeUpload(request.uploadId);
    }
  }
  async read(artifact: ImageArtifact): Promise<Uint8Array> {
    const read = this.options.artifacts.readToolResultBinaryArtifact;
    if (!read)
      throw new ImageGenerationError("storage_unavailable", "Binary image storage is unavailable");
    const bytes = (await read.call(this.options.artifacts, { uri: artifact.uri })).bytes;
    if (
      bytes.length !== artifact.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== artifact.sha256
    )
      throw new ImageGenerationError(
        "artifact_changed",
        "Stored image bytes no longer match this version",
      );
    return bytes;
  }
  async persist(
    id: string,
    image: ImageGenerationBinary,
    name: string,
    seed?: number,
    trace?: TraceContext,
  ): Promise<ImageArtifact> {
    const write = this.options.artifacts.writeToolResultBinaryArtifact;
    if (!write)
      throw new ImageGenerationError("storage_unavailable", "Binary image storage is unavailable");
    const saved = await write.call(this.options.artifacts, {
      sessionId: this.options.sessionId as SessionId,
      toolCallId: id,
      toolName: "GenerateImage",
      content: image.bytes,
      contentType: image.mimeType,
      extension: image.mimeType === "image/png" ? "png" : "jpg",
      retention: "session",
      trace: trace ?? this.options.trace,
    });
    return {
      id,
      name,
      uri: saved.uri,
      path: saved.path,
      bytes: image.bytes.length,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      transparent: image.transparent,
      encoding: image.encoding,
      seed,
      sha256: createHash("sha256").update(image.bytes).digest("hex"),
    };
  }
}

export function describeRecentImageJobs(values: Iterable<ImageJob>): string {
  const jobs = [...values].filter((job) => job.status === "succeeded").slice(-3);
  return jobs.length
    ? "Recently saved images in this session (latest last):\n" +
        jobs
          .map((job) => `${job.id}: ${job.input.size}, ${job.input.prompt.slice(0, 160)}`)
          .join("\n")
    : "";
}
