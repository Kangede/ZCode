import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMAGE_CHUNK_BYTES,
  imageGenerationInputSchema,
  type ImageArtifact,
  type ImageGenerationInput,
  type ImageGenerationReply,
  type ImageGenerationSettings,
  type ImageJob,
} from "@zcode/shared/image-generation";
import { useV4Conversation } from "@/v4/V4ConversationContext.js";

function encode(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
}

export function useImageWorkbench(sessionId: string, active: boolean) {
  const { imageGeneration } = useV4Conversation();
  const [snapshot, setSnapshot] = useState<ImageGenerationReply>({});
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const generation = useRef(0);
  const pendingAction = useRef(false);
  const refresh = useCallback(async () => {
    const token = generation.current;
    const next = await imageGeneration({ action: "list", sessionId });
    if (token === generation.current) setSnapshot(next);
  }, [imageGeneration, sessionId]);
  useEffect(() => {
    generation.current++;
    setSnapshot({});
    setError(undefined);
    if (!active) return;
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await refresh();
      } catch (cause) {
        if (!closed) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!closed) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      closed = true;
      clearTimeout(timer);
      generation.current++;
    };
  }, [active, refresh]);
  const act = useCallback(
    async <T>(action: () => Promise<T>): Promise<T | undefined> => {
      if (pendingAction.current) return undefined;
      const token = generation.current;
      pendingAction.current = true;
      setPending(true);
      setError(undefined);
      try {
        const result = await action();
        if (token !== generation.current) return undefined;
        await refresh();
        return token === generation.current ? result : undefined;
      } catch (cause) {
        if (token === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause));
        return undefined;
      } finally {
        pendingAction.current = false;
        setPending(false);
      }
    },
    [refresh],
  );
  return {
    snapshot,
    error,
    pending,
    configure: (settings: ImageGenerationSettings) =>
      act(() => imageGeneration({ action: "configure", sessionId, settings })),
    submit: (input: ImageGenerationInput) =>
      act(async () => {
        const result = await imageGeneration({
          action: "submit",
          sessionId,
          commandId: crypto.randomUUID(),
          input: imageGenerationInputSchema.parse(input),
        });
        return result.job;
      }),
    cancel: (job: ImageJob) =>
      act(() => imageGeneration({ action: "cancel", sessionId, jobId: job.id })),
    exportImage: (artifact: ImageArtifact) =>
      act(() => imageGeneration({ action: "export", sessionId, artifactId: artifact.id })),
    upload: (file: File) =>
      act(async () => {
        if (file.size === 0) throw new Error("Reference image is empty");
        if (file.size > 50 * 1024 * 1024) throw new Error("Reference image exceeds 50 MiB");
        const uploadId = crypto.randomUUID();
        let artifact: ImageArtifact | undefined;
        for (let offset = 0; offset < file.size; offset += IMAGE_CHUNK_BYTES) {
          const bytes = new Uint8Array(
            await file.slice(offset, offset + IMAGE_CHUNK_BYTES).arrayBuffer(),
          );
          const reply = await imageGeneration({
            action: "import",
            sessionId,
            uploadId,
            name: file.name,
            offset,
            data: encode(bytes),
            final: offset + bytes.length >= file.size,
          });
          artifact = reply.artifact ?? artifact;
        }
        return artifact;
      }),
  };
}

export function useImageArtifactUrl(
  sessionId: string,
  artifact?: ImageArtifact,
  preview?: "canvas" | "reference",
) {
  const { imageGeneration } = useV4Conversation();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError(undefined);
    if (!artifact) return;
    void (async () => {
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let offset: number | null = 0;
      while (offset !== null) {
        const result = await imageGeneration({
          action: "read",
          sessionId,
          artifactId: artifact.id,
          preview,
          offset,
        });
        if (cancelled) return;
        if (
          (!preview && result.totalBytes !== artifact.bytes) ||
          (preview && (!result.totalBytes || result.totalBytes > 128 * 1024 * 1024)) ||
          !result.data ||
          (result.nextOffset !== null &&
            (result.nextOffset === undefined || result.nextOffset <= offset))
        )
          throw new Error("Invalid image transfer");
        chunks.push(Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0)));
        offset = result.nextOffset ?? null;
      }
      if (cancelled) return;
      objectUrl = URL.createObjectURL(new Blob(chunks, { type: artifact.mimeType }));
      setUrl(objectUrl);
    })().catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact?.id, artifact?.sha256, sessionId, imageGeneration, preview]);
  return { url, error };
}

/** A newly accepted native tool call selects its own canvas without overriding later browsing. */
export function useLatestAgentImage(
  jobs: ImageJob[],
  sessionId: string,
  select: (id: string) => void,
) {
  const observed = useRef<string | undefined>(undefined);
  const id = jobs.at(-1)?.id;
  const origin = jobs.at(-1)?.origin;
  useEffect(() => {
    observed.current = undefined;
  }, [sessionId]);
  useEffect(() => {
    if (!id || id === observed.current) return;
    observed.current = id;
    if (origin === "agent") select(id);
  }, [id, origin, sessionId, select]);
}
