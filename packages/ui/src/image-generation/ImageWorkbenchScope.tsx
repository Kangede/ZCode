import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useImageWorkbenchSession } from "@/hooks/useImageWorkbenchSession.js";
import { useImageWorkbenchStore } from "@/store/imageWorkbenchStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { ImageWorkbench } from "./ImageWorkbench.js";

const ImageWorkbenchContext = createContext<{ open(): void } | null>(null);
export const useImageWorkbenchScope = () => useContext(ImageWorkbenchContext);

export function ImageWorkbenchScope({
  paneId = "workspace-main",
  children,
  sessionId,
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  onSessionCreated,
  readOnly,
}: {
  paneId?: string;
  children: ReactNode;
  sessionId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  onSessionCreated?: (id: string) => void;
  readOnly?: boolean;
}) {
  const { locale } = useZCodeIntl();
  const { supported, create } = useImageWorkbenchSession(
    workspacePath,
    workspaceIdentity,
    remoteSessionId,
  );
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => setCreated(undefined), [sessionId]);
  const actualSession = sessionId ?? created;
  const scope = `${workspaceIdentity ?? workspacePath}:${actualSession ?? "draft"}:${paneId}`;
  const { openScope, show, hide } = useImageWorkbenchStore();
  const open = async () => {
    if (!supported || creating || readOnly) return;
    setError(undefined);
    if (actualSession) {
      show(scope);
      return;
    }
    setCreating(true);
    try {
      const id = await create();
      setCreated(id);
      onSessionCreated?.(id);
      show(`${workspaceIdentity ?? workspacePath}:${id}:${paneId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  };
  return (
    <ImageWorkbenchContext value={{ open: () => void open() }}>
      <div className="flex min-h-0 flex-1 flex-col">
        {supported && !readOnly && (
          <div className="flex shrink-0 items-center justify-end gap-2 px-3 py-1">
            {error && (
              <span role="alert" className="text-ui-caption text-destructive">
                {error}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={creating}
              onClick={() => void open()}
              data-testid="image-workbench-open"
            >
              <ImagePlus className="size-4" />
              {locale === "zh-CN" ? "新建图像" : "New image"}
            </Button>
          </div>
        )}
        {children}
        {actualSession && (
          <ImageWorkbench
            sessionId={actualSession}
            open={openScope === scope}
            onOpenChange={(next) => (next ? show(scope) : hide())}
          />
        )}
      </div>
    </ImageWorkbenchContext>
  );
}
