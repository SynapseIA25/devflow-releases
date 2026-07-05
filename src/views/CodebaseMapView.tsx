import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Position,
  type Node, type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { RefreshCw, Loader2, Network } from "lucide-react";
import { buildCodebaseGraph, type CodebaseGraph } from "../lib/codebaseMap";
import { useProjectStore } from "../store/projectStore";
import { useEditorStore } from "../store/editorStore";
import { isTauri } from "../lib/tauriApi";

// Paleta por carpeta (los nodos de una misma carpeta comparten color de borde).
const FOLDER_COLORS = ["#7c3aed", "#38bdf8", "#4ade80", "#fbbf24", "#f97316", "#f85149", "#a78bfa", "#22d3ee"];

const COL_W = 240;
const ROW_H = 44;

// Layout simple y determinista: una columna por carpeta (ordenadas), archivos apilados dentro.
// No usamos un motor de layout (dagre/elk) para no sumar dependencia; el clustering por carpeta ya
// hace el mapa legible ("acá está store, acá views, y views importa store").
function toFlow(graph: CodebaseGraph): { nodes: Node[]; edges: Edge[] } {
  const byFolder = new Map<string, CodebaseGraph["nodes"]>();
  for (const n of graph.nodes) {
    const arr = byFolder.get(n.folder);
    if (arr) arr.push(n);
    else byFolder.set(n.folder, [n]);
  }
  const folders = [...byFolder.keys()].sort();
  const colorByFolder = new Map(folders.map((f, i) => [f, FOLDER_COLORS[i % FOLDER_COLORS.length]]));

  const nodes: Node[] = [];
  folders.forEach((folder, col) => {
    byFolder.get(folder)!.forEach((it, row) => {
      const color = colorByFolder.get(folder)!;
      nodes.push({
        id: it.id,
        position: { x: col * COL_W, y: row * ROW_H },
        data: { label: it.name, path: it.path },
        style: {
          background: "var(--bg-card)",
          border: `1px solid ${color}`,
          borderRadius: 7,
          color: "var(--text)",
          fontSize: 11,
          padding: "5px 9px",
          width: COL_W - 40,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      });
    });
  });

  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: "#30363d", strokeWidth: 1 },
  }));

  return { nodes, edges };
}

export function CodebaseMapView() {
  const projectPath = useProjectStore((s) => s.projectPath);
  const openFile = useEditorStore((s) => s.openFile);
  const [graph, setGraph] = useState<CodebaseGraph | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (!isTauri()) {
      setError("El mapa requiere la app desktop (Tauri). Ejecutá: npm run tauri dev");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setGraph(await buildCodebaseGraph(projectPath));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  // Escanea al montar y cada vez que cambia la carpeta de proyecto.
  useEffect(() => { void scan(); }, [scan]);

  const { nodes, edges } = useMemo(
    () => (graph ? toFlow(graph) : { nodes: [], edges: [] }),
    [graph]
  );

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const path = (node.data as { path?: string }).path;
      if (path) void openFile(path); // abre el archivo como pestaña del editor
    },
    [openFile]
  );

  return (
    <div className="codebase-map">
      <div className="cbmap-toolbar">
        <div className="cbmap-title">
          <Network size={14} />
          <span>Mapa del codebase</span>
          {graph && <span className="cbmap-count">{graph.nodes.length} archivos · {graph.edges.length} imports</span>}
          {graph?.truncated && <span className="cbmap-warn">(truncado a los primeros 250)</span>}
        </div>
        <button className="cbmap-refresh" onClick={scan} disabled={loading} title="Reescanear">
          {loading ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          <span>{loading ? "Escaneando…" : "Reescanear"}</span>
        </button>
      </div>
      <div className="cbmap-canvas">
        {error ? (
          <div className="cbmap-empty cbmap-error">{error}</div>
        ) : loading && !graph ? (
          <div className="cbmap-empty"><Loader2 size={20} className="spin" /> Escaneando el proyecto…</div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodeClick={onNodeClick}
            fitView
            nodesConnectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#21262d" />
            <Controls showInteractive={false} />
            <MiniMap nodeStrokeWidth={2} pannable zoomable />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
