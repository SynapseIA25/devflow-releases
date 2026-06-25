import { MiMoNode } from "./MiMoNode";
import { TerminalNode } from "./TerminalNode";
import { FileNode } from "./FileNode";
import { ConditionNode } from "./ConditionNode";

export { MiMoNode, TerminalNode, FileNode, ConditionNode };

export const nodeTypes = {
  mimo: MiMoNode,
  terminal: TerminalNode,
  file: FileNode,
  condition: ConditionNode,
} as const;
