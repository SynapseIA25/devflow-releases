import { MiMoNode } from "./MiMoNode";
import { AgentNode } from "./AgentNode";
import { HttpNode } from "./HttpNode";
import { McpNode } from "./McpNode";
import { TerminalNode } from "./TerminalNode";
import { FileNode } from "./FileNode";
import { ConditionNode } from "./ConditionNode";
import { LoopNode } from "./LoopNode";
import { SubflowNode } from "./SubflowNode";

export { MiMoNode, AgentNode, HttpNode, McpNode, TerminalNode, FileNode, ConditionNode, LoopNode, SubflowNode };

export const nodeTypes = {
  mimo: MiMoNode,
  agent: AgentNode,
  http: HttpNode,
  mcp: McpNode,
  terminal: TerminalNode,
  file: FileNode,
  condition: ConditionNode,
  loop: LoopNode,
  subflow: SubflowNode,
} as const;
