import { useSettingsStore } from "../store/settingsStore";

// Gate compartido por TriggerRunner/PlannerRunner para los nodos "file"(write)/"terminal" del
// workflow engine (ver EngineCallbacks.confirmAction en workflowEngine.ts) — mismo criterio ya
// usado para las tool-calls del agente en acpClient.ts:146-160: sin UI para aprobar, se deniega
// salvo que el usuario haya prendido autoApprovePermissions en Settings. Toda decisión se loguea.
export async function confirmHeadlessAction(kind: "file-write" | "shell", detail: string): Promise<boolean> {
  const { autoApprovePermissions, logPermission } = useSettingsStore.getState();
  const tool = kind === "file-write" ? "file:write" : "terminal:exec";
  logPermission({ provider: "workflow", tool: `${tool} (${detail})`, decision: autoApprovePermissions ? "auto-allow" : "auto-deny" });
  return autoApprovePermissions;
}
