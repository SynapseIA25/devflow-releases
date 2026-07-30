import { PALETTE_ENTRIES } from "../../lib/designCanvas/palette";

// MIME custom propio, mismo idioma ya usado en todo el repo para DnD (application/reactflow en
// Sidebar.tsx, application/x-devflow-path en FileExplorer.tsx) — sin librería de DnD nueva.
export const DESIGN_PALETTE_MIME = "application/x-devflow-design-palette";

export function DesignPalette() {
  const onDragStart = (e: React.DragEvent, entryId: string) => {
    e.dataTransfer.setData(DESIGN_PALETTE_MIME, entryId);
    e.dataTransfer.effectAllowed = "copy";
  };

  return (
    <aside className="design-palette">
      <div className="sidebar-section">
        <div className="sidebar-label">Components</div>
        {PALETTE_ENTRIES.map((entry) => (
          <div
            key={entry.id}
            className="node-item"
            draggable
            title={entry.desc}
            onDragStart={(e) => onDragStart(e, entry.id)}
          >
            <div className="node-item-icon" style={{ background: "rgba(124,58,237,0.15)" }}>
              <DesignPaletteIcon name={entry.icon} />
            </div>
            <div className="node-item-info">
              <div className="node-item-name">{entry.label}</div>
              <div className="node-item-desc">{entry.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

// Resuelve un ícono lucide-react por nombre dinámicamente (los nombres vienen de PALETTE_ENTRIES) sin
// importar el paquete entero a mano por cada entrada.
import * as LucideIcons from "lucide-react";
function DesignPaletteIcon({ name }: { name: string }) {
  const Icon = (LucideIcons as unknown as Record<string, React.ComponentType<{ size?: number }>>)[name];
  if (!Icon) return null;
  return <Icon size={14} />;
}
