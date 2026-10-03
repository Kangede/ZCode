import type {
  ImageArtifact,
  ImageGenerationSettings,
  ImageJob,
} from "@zcode/shared/image-generation";

export interface ImageJournalPort {
  load(): Promise<{
    jobs: ImageJob[];
    references: ImageArtifact[];
    settings?: ImageGenerationSettings;
  }>;
  writeJob(job: ImageJob): Promise<void>;
  writeReference(artifact: ImageArtifact): Promise<void>;
  writeSettings(settings: ImageGenerationSettings): Promise<void>;
  readWorkspaceImage(path: string): Promise<Uint8Array>;
  uploadChunk(
    id: string,
    offset: number,
    bytes: Uint8Array,
    final: boolean,
  ): Promise<Uint8Array | undefined>;
  removeUpload(id: string): Promise<void>;
  exportImage(artifact: ImageArtifact, bytes: Uint8Array): Promise<string>;
}
