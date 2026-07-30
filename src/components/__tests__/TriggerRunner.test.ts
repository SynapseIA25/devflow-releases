import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Trigger } from "../../store/triggersStore";

const workflowEngine = vi.hoisted(() => ({ runWorkflow: vi.fn() }));
vi.mock("../../lib/workflowEngine", () => workflowEngine);

const { fire } = await import("../TriggerRunner");
const { useTriggersStore } = await import("../../store/triggersStore");
const { useWorkflowStore } = await import("../../store/workflowStore");

const SEED_FLOW_ID = useWorkflowStore.getState().order[0];

beforeEach(() => {
  vi.clearAllMocks();
  useTriggersStore.setState({ triggers: [] });
});

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  const id = useTriggersStore.getState().addTrigger(SEED_FLOW_ID);
  useTriggersStore.getState().updateTrigger(id, overrides);
  return useTriggersStore.getState().triggers.find((t) => t.id === id)!;
}

describe("TriggerRunner.fire — lastStatus refleja errored", () => {
  it("runWorkflow errored:false → recordRun con status success", async () => {
    workflowEngine.runWorkflow.mockResolvedValue({ errored: false });
    const t = makeTrigger();
    await fire(t, new Set());
    const after = useTriggersStore.getState().triggers.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("success");
  });

  it("runWorkflow errored:true → recordRun con status error (no 'success' aunque no haya thrown)", async () => {
    workflowEngine.runWorkflow.mockResolvedValue({ errored: true });
    const t = makeTrigger();
    await fire(t, new Set());
    const after = useTriggersStore.getState().triggers.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("error");
  });

  it("workflow inexistente → error, sin llamar a runWorkflow", async () => {
    const t = makeTrigger({ workflowId: "flow_no_existe" } as any);
    await fire(t, new Set());
    expect(workflowEngine.runWorkflow).not.toHaveBeenCalled();
    const after = useTriggersStore.getState().triggers.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("error");
  });
});
