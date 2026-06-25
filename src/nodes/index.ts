import { MiMoNode } from "./MiMoNode";
import { TerminalNode } from "./TerminalNode";
import { FileNode } from "./FileNode";
import { ConditionNode } from "./ConditionNode";
import { SubflowNode } from "./SubflowNode";

export { MiMoNode, TerminalNode, FileNode, ConditionNode, SubflowNode };

export const nodeTypes = {
  mimo: MiMoNode,
  terminal: TerminalNode,
  file: FileNode,
  condition: ConditionNode,
  subflow: SubflowNode,
} as const;
