import type { ImageGenerationInput, ImageJob } from "@zcode/shared/image-generation";
import type { TraceContext } from "../tracing/tracer.js";

/** Session-owned execution. Credentials and binary results never cross this port. */
export interface ImageGenerationPort {
  isEnabled(): boolean;
  hasRunningTasks(): boolean;
  describeRecentImages(): string;
  execute(
    input: ImageGenerationInput,
    options: { commandId: string; signal?: AbortSignal; trace?: TraceContext },
  ): Promise<ImageJob>;
}

export interface ImageGenerationConnection {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

export interface ImageGenerationBinary {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  transparent: boolean;
  encoding?: { sourceFormat: "png"; quality: number; matte: "white" };
}

export interface ImageGenerationAdapter {
  generate(input: {
    request: ImageGenerationInput;
    connection: ImageGenerationConnection;
    model: string;
    timeoutMs: number;
    references: ImageGenerationBinary[];
    mask?: ImageGenerationBinary;
    signal?: AbortSignal;
    trace?: TraceContext;
  }): Promise<ImageGenerationBinary>;
}

export class ImageGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}
