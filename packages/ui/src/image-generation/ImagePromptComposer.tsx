import type { ReactNode } from "react";
import { ArrowUp, ImagePlus, LoaderCircle, Square } from "lucide-react";
import type { ImageArtifact } from "@zcode/shared/image-generation";
import { Button } from "@/components/ui/button.js";
import { useImageArtifactUrl } from "@/hooks/useImageWorkbench.js";
import { ImageEditorButton } from "./ImageEditorButton.js";

export function ImagePromptComposer({
  sessionId,
  prompt,
  change,
  references,
  submit,
  disabled,
  busy,
  running,
  cancel,
  edit,
  regional,
  zh,
  openReferences,
  openSettings,
  needsSetup,
  referenceControl,
  parameterControl,
}: {
  sessionId: string;
  prompt: string;
  change(prompt: string): void;
  references: Array<{ artifact: ImageArtifact; position: number }>;
  submit(): void;
  disabled: boolean;
  busy: boolean;
  running: boolean;
  cancel(): void;
  edit: boolean;
  regional: boolean;
  zh: boolean;
  openReferences(): void;
  openSettings(): void;
  needsSetup: boolean;
  referenceControl: ReactNode;
  parameterControl: ReactNode;
}) {
  const action = edit ? (zh ? "应用调整" : "Apply adjustment") : zh ? "生成图片" : "Generate image";
  return (
    <div
      className="z-10 w-full shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5"
      data-testid="image-composer"
    >
      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-popover p-3 shadow-sm focus-within:border-border-hover sm:p-4">
        {needsSetup && (
          <Button variant="link" size="sm" className="mb-2 px-0 text-ui-sm" onClick={openSettings}>
            {zh ? "配置生图服务后开始创作" : "Connect an image provider to get started"}
          </Button>
        )}
        {references.length > 0 && (
          <div className="mb-2 flex items-center gap-2 overflow-x-auto">
            {references.map(({ artifact, position }) => (
              <ComposerReference
                key={`${artifact.id}-${position}`}
                artifact={artifact}
                sessionId={sessionId}
                label={`${zh ? "参考图" : "Reference"} ${position}`}
                position={position}
                onClick={openReferences}
              />
            ))}
          </div>
        )}
        <textarea
          data-testid="image-prompt"
          aria-label={zh ? "提示词 / 调整说明" : "Prompt / adjustment"}
          rows={2}
          className="block max-h-28 min-h-14 w-full resize-none border-0 bg-transparent text-mobile-input-safe leading-relaxed text-foreground outline-none placeholder:text-foreground-subtlest sm:text-ui-base"
          placeholder={
            regional
              ? zh
                ? "描述选中区域需要怎样修改…"
                : "Describe how to change the selected area…"
              : edit
                ? zh
                  ? "描述你想调整的内容…"
                  : "Describe your changes…"
                : zh
                  ? "描述你想生成的图像…"
                  : "Describe the image you want to create…"
          }
          value={prompt}
          disabled={busy}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "Enter" &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (!disabled && !running) submit();
            }
          }}
        />
        <div className="mt-2 flex min-w-0 items-center gap-1">
          {referenceControl}
          {parameterControl}
          <div className="flex-1" />
          {running ? (
            <ImageEditorButton
              label={zh ? "取消请求" : "Cancel request"}
              variant="secondary"
              onClick={cancel}
            >
              <Square className="size-3 fill-current" />
            </ImageEditorButton>
          ) : (
            <ImageEditorButton
              label={action}
              data-testid="image-submit"
              variant="default"
              disabled={disabled}
              onClick={submit}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
            </ImageEditorButton>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerReference({
  sessionId,
  artifact,
  label,
  onClick,
  position,
}: {
  sessionId: string;
  artifact: ImageArtifact;
  label: string;
  onClick(): void;
  position: number;
}) {
  const { url } = useImageArtifactUrl(sessionId, artifact, "reference");
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface"
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <ImagePlus className="size-4 text-foreground-subtle" />
      )}
      <span className="absolute right-0 bottom-0 rounded-tl-md bg-popover/90 px-1 text-ui-xs">
        {position}
      </span>
    </button>
  );
}
