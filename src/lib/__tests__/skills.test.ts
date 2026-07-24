import { describe, it, expect } from "vitest";
import { buildSkillsPreamble, projectSkillsRoot, skillRoot, type Skill } from "../skills";

// Skills por-proyecto: garantías centrales que no dependen de disco/red — que un proyecto NUNCA
// vea las skills de otro, que las globales se vean en todos lados, y que una skill huérfana
// (proyecto borrado) se maneje sin tirar error.

const GLOBAL_ROOT = "C:/Users/x/.devflow/skills";
const PROJECT_A = { id: "proj-a", root: "F:/project-a" };
const PROJECT_B = { id: "proj-b", root: "F:/project-b" };

const makeSkill = (over: Partial<Skill>): Skill => ({
  id: over.id ?? "id-" + over.name,
  name: over.name ?? "skill",
  description: over.description ?? "desc",
  content: "content",
  source: "user",
  scope: over.scope ?? "global",
  projectId: over.projectId,
  enabled: true,
  pinned: false,
  archived: false,
  stale: false,
  uses: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe("buildSkillsPreamble — scoping", () => {
  const globalSkill = makeSkill({ name: "global-skill", scope: "global" });
  const skillA = makeSkill({ name: "skill-a", scope: "project", projectId: PROJECT_A.id });
  const skillB = makeSkill({ name: "skill-b", scope: "project", projectId: PROJECT_B.id });
  const all = [globalSkill, skillA, skillB];

  it("sin proyecto activo, solo entran las skills globales", () => {
    const out = buildSkillsPreamble(all, GLOBAL_ROOT);
    expect(out).toContain("global-skill");
    expect(out).not.toContain("skill-a");
    expect(out).not.toContain("skill-b");
  });

  it("con proyecto A activo, entran global + A, NUNCA B", () => {
    const out = buildSkillsPreamble(all, GLOBAL_ROOT, PROJECT_A);
    expect(out).toContain("global-skill");
    expect(out).toContain("skill-a");
    expect(out).not.toContain("skill-b");
  });

  it("con proyecto B activo, entran global + B, NUNCA A", () => {
    const out = buildSkillsPreamble(all, GLOBAL_ROOT, PROJECT_B);
    expect(out).toContain("global-skill");
    expect(out).toContain("skill-b");
    expect(out).not.toContain("skill-a");
  });

  it("el path de disco de una skill de proyecto apunta a la raíz REGISTRADA del proyecto, no a un root arbitrario", () => {
    const out = buildSkillsPreamble(all, GLOBAL_ROOT, PROJECT_A);
    expect(out).toContain(`${PROJECT_A.root}/.devflow/skills/skill-a/SKILL.md`);
  });

  it("una skill deshabilitada o archivada no entra al índice aunque matchee el proyecto", () => {
    const disabled = makeSkill({ name: "off", scope: "project", projectId: PROJECT_A.id, enabled: false });
    const archived = makeSkill({ name: "arch", scope: "project", projectId: PROJECT_A.id, archived: true });
    const out = buildSkillsPreamble([disabled, archived], GLOBAL_ROOT, PROJECT_A);
    expect(out).toBe("");
  });
});

describe("skillRoot — resolución de raíz de disco", () => {
  const projectRoots = { [PROJECT_A.id]: PROJECT_A.root };

  it("una skill global siempre resuelve a la raíz global", () => {
    const s = makeSkill({ scope: "global" });
    expect(skillRoot(s, GLOBAL_ROOT, projectRoots)).toBe(GLOBAL_ROOT);
  });

  it("una skill de proyecto resuelve a <projectRoot>/.devflow/skills", () => {
    const s = makeSkill({ scope: "project", projectId: PROJECT_A.id });
    expect(skillRoot(s, GLOBAL_ROOT, projectRoots)).toBe(projectSkillsRoot(PROJECT_A.root));
  });

  it("una skill de proyecto HUÉRFANA (projectId no resuelve) da null, no tira error", () => {
    const s = makeSkill({ scope: "project", projectId: "deleted-project" });
    expect(skillRoot(s, GLOBAL_ROOT, projectRoots)).toBeNull();
  });

  it("una skill de proyecto sin projectId (dato corrupto) da null", () => {
    const s = makeSkill({ scope: "project", projectId: undefined });
    expect(skillRoot(s, GLOBAL_ROOT, projectRoots)).toBeNull();
  });
});
