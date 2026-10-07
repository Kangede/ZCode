import { useV4Conversation } from "@/v4/V4ConversationContext.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { completeNewModelSelection } from "@zcode/provider";
import { useCallback, useEffect, useState } from "react";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { ensureAgentV4ConnectionHandshake } from "@/v4/agentV4ConnectionHandshake.js";

export function useImageWorkbenchSession(
  workspacePath: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) {
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId ?? null,
    workspaceIdentity,
  );
  const { zcodeAgentService, modelSelectionService } = resolution.services;
  const { sendCommand } = useV4Conversation();
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let current = true;
    void ensureAgentV4ConnectionHandshake(zcodeAgentService)
      .then((hello) => {
        if (current) setSupported(hello.capabilities.imageGenerationV1 === true);
      })
      .catch(() => {
        if (current) setSupported(false);
      });
    return () => {
      current = false;
    };
  }, [zcodeAgentService]);
  const create = useCallback(async () => {
    const view = await modelSelectionService.getView();
    if (!view.preferredSelection)
      throw new Error("Select a conversation model before creating an image workspace");
    // 新会话必须像普通草稿一样补齐推理档位，否则已有会话的严格校验会禁止发送。
    const model = completeNewModelSelection(view, view.preferredSelection);
    if (!model) throw new Error("The selected model is unavailable");
    // V4 owns draft promotion and the command ledger. Legacy session/create does
    // not seed that ledger and can leave the first sendText with a missing FK.
    const ack = await sendCommand(
      createCommandEnvelope({
        sessionId: null,
        type: "createSession",
        payload: {
          workspaceId: workspaceIdentity?.trim() || workspacePath,
          config: {
            provider: model.providerId,
            model: model.modelId,
            thought: model.options?.reasoningLevel,
            mode: "build",
            planEnabled: false,
          },
        },
      }),
    );
    if (ack.status !== "accepted" || ack.result?.type !== "createSession")
      throw new Error(ack.message ?? ack.reasonCode ?? "Image workspace creation failed");
    return ack.result.sessionId;
  }, [workspacePath, workspaceIdentity, zcodeAgentService, modelSelectionService, sendCommand]);
  return { supported, create };
}
