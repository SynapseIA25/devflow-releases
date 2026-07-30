import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlannerTask } from "../../store/plannerStore";

const workflowEngine = vi.hoisted(() => ({ runWorkflow: vi.fn() }));
vi.mock("../../lib/workflowEngine", () => workflowEngine);

const { fireTask } = await import("../PlannerRunner");
const { usePlannerStore } = await import("../../store/plannerStore");
const { useWorkflowStore } = await import("../../store/workflowStore");

const SEED_FLOW_ID = useWorkflowStore.getState().order[0];

beforeEach(() => {
  vi.clearAllMocks();
  usePlannerStore.setState({ tasks: [] });
});

function makeTask(overrides: Partial<PlannerTask> = {}): PlannerTask {
  const id = usePlannerStore.getState().addTask("proj_x", "test task", Date.now(), SEED_FLOW_ID);
  usePlannerStore.getState().updateTask(id, overrides);
  return usePlannerStore.getState().tasks.find((t) => t.id === id)!;
}

describe("PlannerRunner.fireTask — lastStatus refleja errored", () => {
  it("runWorkflow errored:false → recordFire con status success", async () => {
    workflowEngine.runWorkflow.mockResolvedValue({ errored: false });
    const t = makeTask();
    await fireTask(t, new Set(), "schedule");
    const after = usePlannerStore.getState().tasks.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("success");
    expect(after.firedAt).toBeDefined();
  });

  it("runWorkflow errored:true → recordFire con status error", async () => {
    workflowEngine.runWorkflow.mockResolvedValue({ errored: true });
    const t = makeTask();
    await fireTask(t, new Set(), "schedule");
    const after = usePlannerStore.getState().tasks.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("error");
  });

  it("workflow inexistente → error, sin llamar a runWorkflow", async () => {
    const t = makeTask({ workflowId: "flow_no_existe" });
    await fireTask(t, new Set(), "schedule");
    expect(workflowEngine.runWorkflow).not.toHaveBeenCalled();
    const after = usePlannerStore.getState().tasks.find((x) => x.id === t.id)!;
    expect(after.lastStatus).toBe("error");
  });
});
