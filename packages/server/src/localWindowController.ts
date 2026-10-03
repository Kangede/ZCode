import { randomUUID } from "node:crypto";
import { isRemoteWorkspaceIdentity } from "@zcode/shared";
import {
  IWindowControllerService,
  IZCodeAgentService,
  IZCodeTaskService,
  type ServiceCollection,
} from "@zcode/services";
import { createWindowHostControllerRuntime } from "@zcode/services/window-controller/windowHostControllerService.js";

/** Standalone Web uses the same controller as Desktop; attached hosts keep theirs. */
export function registerLocalWindowController(
  services: ServiceCollection,
): { dispose(): void } | undefined {
  if (services.getOptional(IWindowControllerService)) return undefined;
  const tasks = services.getOptional(IZCodeTaskService);
  if (!tasks) return undefined;
  const runtime = createWindowHostControllerRuntime({
    createId: randomUUID,
    resolveSource(scope) {
      // Remote identities must never be interpreted as this server's local paths.
      if (scope.workspaceIdentity && isRemoteWorkspaceIdentity(scope.workspaceIdentity))
        return null;
      return {
        scope: {
          kind: "local",
          workspacePath: scope.workspacePath,
          workspaceIdentity: scope.workspaceIdentity,
        },
        taskService: tasks,
        agentService: services.getOptional(IZCodeAgentService),
        sourceAvailability: "online",
      };
    },
  });
  services.register(IWindowControllerService, runtime.service);
  return runtime;
}
