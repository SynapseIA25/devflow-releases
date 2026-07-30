import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Edge } from "@xyflow/react";
import type { WorkflowNode } from "../../store/workflowStore";
import type { EngineCallbacks } from "../workflowEngine";

const tauriApi = vi.hoisted(() => ({
  runShellCommand: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  httpRequest: vi.fn(),
  httpLoadTest: vi.fn(),
  mcpCallTool: vi.fn(),
}));
vi.mock("../tauriApi", () => tauriApi);

const { runWorkflow } = await import("../workflowEngine");

function terminalGraph(command = "echo hi"): { nodes: WorkflowNode[]; edges: Edge[] } {
  return {
    nodes: [
      { id: "n1", type: "terminal", position: { x: 0, y: 0 }, data: { label: "Terminal", command } },
    ],
    edges: [],
  };
}

function fileWriteGraph(path = "./out.txt"): { nodes: WorkflowNode[]; edges: Edge[] } {
  return {
    nodes: [
      { id: "n1", type: "file", position: { x: 0, y: 0 }, data: { label: "File", path, operation: "write" } },
    ],
    edges: [],
  };
}

function makeCb(overrides: Partial<EngineCallbacks> = {}): EngineCallbacks {
  return {
    onLog: () => {},
    setNodeStatus: () => {},
    isCancelled: () => false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWorkflow — errored flag (regresión del fix de lastStatus)", () => {
  it("camino feliz: errored es false", async () => {
    tauriApi.runShellCommand.mockResolvedValue({ output: "hi", exitCode: 0 });
    const { nodes, edges } = terminalGraph();
    const r = await runWorkflow(nodes, edges, makeCb());
    expect(r.errored).toBe(false);
  });

  it("un nodo que tira (ej. error de OS) deja errored en true", async () => {
    tauriApi.runShellCommand.mockRejectedValue(new Error("Acceso denegado. (os error 5)"));
    const statuses: string[] = [];
    const { nodes, edges } = terminalGraph();
    const r = await runWorkflow(nodes, edges, makeCb({ setNodeStatus: (_id, s) => statuses.push(s) }));
    expect(r.errored).toBe(true);
    expect(statuses).toContain("error");
  });
});

describe("runWorkflow — confirmAction (gate de nodos file-write/terminal)", () => {
  it("terminal: confirmAction devolviendo false bloquea el comando y no lo ejecuta", async () => {
    const { nodes, edges } = terminalGraph();
    const r = await runWorkflow(nodes, edges, makeCb({ confirmAction: async () => false }));
    expect(r.errored).toBe(true);
    expect(tauriApi.runShellCommand).not.toHaveBeenCalled();
  });

  it("terminal: confirmAction devolviendo true deja correr el comando", async () => {
    tauriApi.runShellCommand.mockResolvedValue({ output: "hi", exitCode: 0 });
    const { nodes, edges } = terminalGraph();
    const r = await runWorkflow(nodes, edges, makeCb({ confirmAction: async () => true }));
    expect(r.errored).toBe(false);
    expect(tauriApi.runShellCommand).toHaveBeenCalledTimes(1);
  });

  it("sin confirmAction (WorkflowView/ChatView): corre como antes, sin gate", async () => {
    tauriApi.runShellCommand.mockResolvedValue({ output: "hi", exitCode: 0 });
    const { nodes, edges } = terminalGraph();
    const r = await runWorkflow(nodes, edges, makeCb());
    expect(r.errored).toBe(false);
    expect(tauriApi.runShellCommand).toHaveBeenCalledTimes(1);
  });

  it("file (write): confirmAction devolviendo false bloquea la escritura", async () => {
    const { nodes, edges } = fileWriteGraph();
    const r = await runWorkflow(nodes, edges, makeCb({ confirmAction: async () => false }));
    expect(r.errored).toBe(true);
    expect(tauriApi.writeTextFile).not.toHaveBeenCalled();
  });

  it("file (read): confirmAction NO se llama — leer no requiere permiso", async () => {
    tauriApi.readTextFile.mockResolvedValue("contenido");
    const confirmAction = vi.fn().mockResolvedValue(false);
    const nodes: WorkflowNode[] = [
      { id: "n1", type: "file", position: { x: 0, y: 0 }, data: { label: "File", path: "./in.txt", operation: "read" } },
    ];
    const r = await runWorkflow(nodes, [], makeCb({ confirmAction }));
    expect(r.errored).toBe(false);
    expect(confirmAction).not.toHaveBeenCalled();
  });
});
