import { useEffect, useRef, useState } from "react";
import {
  imageGenerationSettingsSchema,
  type ImageGenerationInput,
  type ImageJob,
} from "@zcode/shared/image-generation";
import {
  useImageArtifactUrl,
  useImageWorkbench,
  useLatestAgentImage,
} from "./useImageWorkbench.js";
import type { ImageMaskEditorHandle } from "@/image-generation/ImageMaskEditor.js";

const freshDraft = (): ImageGenerationInput => ({
  operation: "generate",
  prompt: "",
  references: [],
  size: "1024x1024",
  outputFormat: "png",
  guidanceScale: 1,
});

export function useImageWorkbenchDraft(sessionId: string, open: boolean, zh: boolean) {
  const workbench = useImageWorkbench(sessionId, open);
  const [repaintId, setRepaintId] = useState<string>();
  const [maskReady, setMaskReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const maskEditor = useRef<ImageMaskEditorHandle>(null);
  const submitLock = useRef(false);
  const draftEpoch = useRef(0);
  const busy = workbench.pending || submitting;
  const [draft, setDraft] = useState<ImageGenerationInput>(freshDraft);
  const [selectedId, setSelectedId] = useState<string>();
  const [comparisonId, setComparisonId] = useState<string>();
  const [zoom, setZoom] = useState(100);
  const [notice, setNotice] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const jobs = workbench.snapshot.jobs ?? [];
  useLatestAgentImage(jobs, sessionId, setSelectedId);
  const selected =
    selectedId === "new" ? undefined : (jobs.find((job) => job.id === selectedId) ?? jobs.at(-1));
  const comparison = jobs.find((job) => job.id === comparisonId);
  const settings = workbench.snapshot.settings ?? imageGenerationSettingsSchema.parse({});
  const repaint = jobs.find((job) => job.id === repaintId);
  useEffect(() => {
    if (selected?.id !== repaintId) {
      setRepaintId(undefined);
      setMaskReady(false);
    }
  }, [selected?.id, repaintId]);
  const running = selected?.status === "queued" || selected?.status === "running";
  const { url: downloadUrl } = useImageArtifactUrl(
    sessionId,
    open ? selected?.artifact : undefined,
  );
  const change = (patch: Partial<ImageGenerationInput>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(undefined);
  };
  useEffect(() => {
    draftEpoch.current++;
    setRepaintId(undefined);
    setMaskReady(false);
    setDraft(freshDraft());
    setSelectedId(undefined);
    setComparisonId(undefined);
  }, [sessionId]);
  useEffect(() => {
    if (!open || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, running]);
  const edit = (job: ImageJob, regional = false) => {
    draftEpoch.current++;
    setRepaintId(regional ? job.id : undefined);
    setMaskReady(false);
    setDraft({
      ...job.input,
      operation: "edit",
      prompt: "",
      parentId: job.id,
      references: [job.id],
      mask: undefined,
      ...(regional
        ? {
            size: `${job.artifact!.width}x${job.artifact!.height}`,
            outputFormat: "png",
            outputCompression: undefined,
          }
        : {}),
      seed: undefined,
      background: job.input.background ?? "auto",
    });
    setSelectedId(job.id);
  };
  const upload = async (files: FileList | File[]) => {
    const remaining = 5 - draft.references.length;
    if (files.length > remaining) {
      setNotice(
        zh
          ? "最多五张参考图，编辑目标也计入限制。"
          : "At most five references, including the edit target.",
      );
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    const epoch = draftEpoch.current;
    try {
      const added: string[] = [];
      for (const file of Array.from(files)) {
        const artifact = await workbench.upload(file);
        if (epoch !== draftEpoch.current) return;
        if (!artifact) break;
        added.push(artifact.id);
      }
      if (added.length)
        setDraft((current) => ({
          ...current,
          operation: "edit",
          references: [...current.references, ...added],
        }));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };

  const submit = async () => {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    const epoch = draftEpoch.current;
    try {
      let input = draft;
      if (repaint) {
        if (!maskReady || !maskEditor.current) return;
        const artifact = await workbench.upload(await maskEditor.current.exportMask());
        if (!artifact || epoch !== draftEpoch.current) return;
        input = { ...draft, mask: artifact.id };
      }
      const job = await workbench.submit(input);
      if (job && epoch === draftEpoch.current) {
        setSelectedId(job.id);
        setRepaintId(undefined);
        setMaskReady(false);
        setNotice(undefined);
      }
    } catch (cause) {
      if (epoch === draftEpoch.current)
        setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };
  const remove = (index: number) => {
    const id = draft.references[index];
    const references = draft.references.filter((_, i) => i !== index);
    change({
      references,
      parentId: draft.parentId === id ? undefined : draft.parentId,
      operation: references.length ? "edit" : "generate",
      mask: undefined,
    });
  };
  const sessionImages = jobs.flatMap((job, index) =>
    job.status === "succeeded" && job.artifact ? [{ ...job.artifact, name: `V${index + 1}` }] : [],
  );
  const move = (index: number, delta: number) => {
    const references = [...draft.references];
    const other = index + delta;
    if (other < 0 || other >= references.length) return;
    [references[index], references[other]] = [references[other]!, references[index]!];
    change({ references });
  };
  const newImage = () => {
    draftEpoch.current++;
    setRepaintId(undefined);
    setMaskReady(false);
    setDraft(freshDraft());
    setSelectedId("new");
    setComparisonId(undefined);
  };
  const selectVersion = (id: string) => {
    draftEpoch.current++;
    setSelectedId(id);
    setRepaintId(undefined);
    setMaskReady(false);
  };
  const reuse = (job: ImageJob) => {
    draftEpoch.current++;
    setRepaintId(undefined);
    setMaskReady(false);
    change({ ...job.input, references: [...job.input.references] });
  };
  const toggleReference = (id: string) => {
    const index = draft.references.indexOf(id);
    if (index >= 0) remove(index);
    else if (draft.references.length < 5)
      change({ operation: "edit", references: [...draft.references, id] });
  };
  const stopRepaint = () => {
    setRepaintId(undefined);
    setMaskReady(false);
    change({ mask: undefined });
  };
  return {
    workbench,
    draft,
    change,
    selected,
    selectedId,
    comparison,
    comparisonId,
    setComparisonId,
    zoom,
    setZoom,
    notice,
    setNotice,
    now,
    jobs,
    settings,
    repaint,
    running,
    downloadUrl,
    busy,
    maskReady,
    maskEditor,
    setMaskReady,
    edit,
    upload,
    submit,
    remove,
    move,
    sessionImages,
    newImage,
    selectVersion,
    reuse,
    toggleReference,
    stopRepaint,
  };
}
