import type {
  ImageGenerationAdapter,
  ImageGenerationConnection,
  ImageJournalPort,
  ToolArtifactStorePort,
  TraceContext,
} from "@zcode/contracts";
import type { ImageGenerationSettings, ImageGenerationInput } from "@zcode/shared/image-generation";

export interface ImageTaskServiceOptions {
  trace?: TraceContext;
  available?: boolean;
  sessionId: string;
  journal: ImageJournalPort;
  artifacts: ToolArtifactStorePort;
  adapter: ImageGenerationAdapter;
  initialSettings?: Partial<ImageGenerationSettings>;
  connection: (providerId?: string) => ImageGenerationConnection;
  onSettingsChanged?: (enabled: boolean) => void;
  assertUserSubmission?: () => void;
  beforeUserSubmission?: (input: ImageGenerationInput) => Promise<void>;
  onJobCompleted?: () => void;
}
