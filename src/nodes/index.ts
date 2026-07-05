import { MiMoNode } from "./MiMoNode";
import { AgentNode } from "./AgentNode";
import { HttpNode } from "./HttpNode";
import { McpNode } from "./McpNode";
import { TerminalNode } from "./TerminalNode";
import { FileNode } from "./FileNode";
import { ConditionNode } from "./ConditionNode";
import { SubflowNode } from "./SubflowNode";

export { MiMoNode, AgentNode, HttpNode, McpNode, TerminalNode, FileNode, ConditionNode, SubflowNode };

export const nodeTypes = {
  mimo: MiMoNode,
  agent: AgentNode,
  http: HttpNode,
  mcp: McpNode,
  terminal: TerminalNode,
  file: FileNode,
  condition: ConditionNode,
  subflow: SubflowNode,
} as const;
