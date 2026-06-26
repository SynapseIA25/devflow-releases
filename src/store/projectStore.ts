import { create } from "zustand";
import { persist } from "zustand/middleware";
import { PROJECT_CWD } from "../lib/constants";

// Carpeta de proyecto activa, persistida. Reemplaza el viejo PROJECT_CWD hardcodeado como
// fuente única — ahora el chat/agente (cwd de sesiones ACP y terminal), el File Explorer, el
// motor de workflows y el panel de contexto leen de acá. Se cambia con el selector de carpeta
// (diálogo nativo) del File Explorer. PROJECT_CWD queda solo como valor inicial por defecto.
type ProjectStore = {
  projectPath: string;
  setProjectPath: (path: string) => void;
};

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      projectPath: PROJECT_CWD,
      setProjectPath: (path) => set({ projectPath: path }),
    }),
    { name: "devflow-project" }
  )
);
