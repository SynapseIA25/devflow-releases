// Corre una fase de una spec, desacoplado de cualquier componente de React montado. El progreso se
// escribe en useSpecRunStore (keyed por spec.id) en vez de estado local — así arrancar una corrida en
// la spec B no depende de que la spec A (que puede seguir corriendo) siga siendo la seleccionada en
// el sidebar de Specs: dos specs corren a la vez, cada una visible/reanudable al volver a
// seleccionarla. Ver specRunStore.ts para el porqué del cambio.
import { useSpecRunStore } from "../store/specRunStore";
import { useProjectStore, type Spec } from "../store/projectStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import * as acpClient from "./acpClient";
import * as opencodeClient from "./opencodeClient";
import { createWorktree } from "./environments";
import type { AgentConfig } from "./providers";
import { runSpecifyPhase, runPlanPhase, runTasksPhase, runImplementPhase, type NonDonePhase } from "./specOrchestrator";

const NEXT_PHASE: Record<NonDonePhase, Spec["phase"]> = {
  specify: "plan",
  plan: "tasks",
  tasks: "implement",
  implement: "done", // se corrige a "implement" abajo si quedan tareas sin tildar
};

// Serializa el ARRANQUE de un provider compartido entre corridas en paralelo — no la ejecución de las
// tareas. Encontrado en la práctica corriendo dos specs a la vez sobre el mismo provider: la corrida
// que NO reinicia (porque ve al provider "ocupado" por la otra, ver isProviderBusyElsewhere) seguía
// de largo sin esperar a que el restart de la OTRA corrida terminara de verdad — el server nuevo
// todavía no respondía y la primera sesión/prompt fallaba con "Failed to fetch". Acá cada corrida que
// toca un provider (reinicie o no) pasa por esta cola: la que reinicia además confirma que el server
// ya responde (listAvailableModels, barato) ANTES de soltar la puerta; las demás solo esperan su
// turno. Una vez que todas pasaron, cada una sigue en paralelo de verdad — esto no serializa nada más.
const providerGate = new Map<string, Promise<void>>();

async function passProviderGate(provider: string, action: () => Promise<void>): Promise<void> {
  const prior = providerGate.get(provider) ?? Promise.resolve();
  const mine = prior.then(action, action);
  providerGate.set(provider, mine.catch(() => {}));
  await mine;
}

export type SpecRunOpts = {
  agents: AgentConfig[];
  lead: AgentConfig;
  teamProviderId: string;
  teamTurnTimeoutSecs: number;
  isolate: boolean;
};

export async function runSpecPhase(
  spec: Spec,
  projectId: string,
  projectRoot: string,
  phase: NonDonePhase,
  opts: SpecRunOpts
): Promise<void> {
  const runStore = useSpecRunStore.getState();
  if (runStore.getRun(spec.id).running) return; // esta MISMA spec ya está corriendo algo — no superponer
  const { agents, lead, teamProviderId, teamTurnTimeoutSecs, isolate } = opts;
  const updateSpec = useProjectStore.getState().updateSpec;
  const onTeamProvider = (a: AgentConfig): AgentConfig =>
    a.providerId === teamProviderId ? a : { ...a, providerId: teamProviderId, model: "" };

  useSpecRunStore.getState().startRun(spec.id, phase);
  try {
    if (phase === "specify") {
      await runSpecifyPhase(spec, projectRoot, agents, lead);
      updateSpec(projectId, spec.id, {
        artifacts: { ...spec.artifacts, requirements: { status: "ready", updatedAt: Date.now() } },
        phase: NEXT_PHASE.specify,
      });
    } else if (phase === "plan") {
      await runPlanPhase(spec, projectRoot, agents, lead);
      updateSpec(projectId, spec.id, {
        artifacts: { ...spec.artifacts, design: { status: "ready", updatedAt: Date.now() } },
        phase: NEXT_PHASE.plan,
      });
    } else if (phase === "tasks") {
      const tasks = await runTasksPhase(spec, projectRoot, agents, lead);
      updateSpec(projectId, spec.id, {
        tasks,
        artifacts: { ...spec.artifacts, tasks: { status: "ready", updatedAt: Date.now() } },
        phase: NEXT_PHASE.tasks,
      });
    } else {
      let cwd = projectRoot;
      const mappedLead = onTeamProvider(lead);
      const mappedAgents = agents.map(onTeamProvider);
      const providers = [...new Set([mappedLead, ...mappedAgents].map((a) => a.providerId))];
      useSpecRunStore.getState().setProviders(spec.id, providers);

      // Reinicia los procesos ACP/OpenCode involucrados ANTES de correr — pero SOLO los que no estén
      // en uso por la corrida activa de OTRA spec en paralelo (isProviderBusyElsewhere): reiniciar un
      // proceso compartido que otra corrida está usando la tumbaría a mitad de camino. Si está en uso
      // en otro lado, no se reinicia — pero TODAS las corridas que tocan ese provider (reinicien o no)
      // pasan por passProviderGate, para no seguir de largo mientras otra corrida lo está reiniciando.
      const providersNeedingRestart = new Set(
        providers.filter((p) => !useSpecRunStore.getState().isProviderBusyElsewhere(spec.id, p))
      );
      if (providersNeedingRestart.size > 0) useSpecRunStore.getState().setNote(spec.id, "Restarting the agent to start fresh…");
      for (const p of providers) {
        await passProviderGate(p, async () => {
          if (!providersNeedingRestart.has(p)) return;
          await (p === "opencode" ? opencodeClient.restart(p) : acpClient.restart(p));
          useWorkspaceStore.getState().resetSessions(p);
          // Confirma que el server nuevo ya responde antes de soltar la puerta — sin esto, la corrida
          // que estaba esperando en la cola (isProviderBusyElsewhere) sigue de largo contra un server
          // que recién está terminando de levantar.
          if (p === "opencode") await opencodeClient.listAvailableModels(p).catch(() => {});
        });
      }
      useSpecRunStore.getState().setNote(spec.id, null);

      if (isolate) {
        // El sufijo tiene que ser único entre specs distintas corriendo en el MISMO segundo (posible
        // ahora que corren en paralelo, ver conversación) Y entre corridas repetidas de la MISMA spec
        // — encontrado en la práctica: dos specs con nombres parecidos (mismo prefijo de slug) que
        // arrancan en el mismo segundo generaban el MISMO nombre de rama con el timestamp HH:MM:SS
        // de antes, y `git worktree add` fallaba con "a branch named ... already exists". spec.id ya
        // es único por spec; Date.now() en base36 distingue corridas repetidas de la misma spec.
        const runSuffix = `${spec.id.replace(/^spec_/, "")}${Date.now().toString(36)}`.slice(-10);
        const wtName = `spec-${spec.slug.slice(0, 20)}-${runSuffix}`;
        useSpecRunStore.getState().setNote(spec.id, `Creating isolated environment "${wtName}" (worktree)…`);
        const wt = await createWorktree(projectRoot, wtName);
        useProjectStore.getState().addEnvironment(wt);
        cwd = wt.path;
        useSpecRunStore.getState().setEnvName(spec.id, wt.name);
      }
      useSpecRunStore.getState().setNote(spec.id, null);

      const tasks = await runImplementPhase(
        spec,
        projectRoot,
        mappedAgents,
        mappedLead,
        (step) => useSpecRunStore.getState().appendStep(spec.id, step),
        () => useSpecRunStore.getState().getRun(spec.id).cancelled,
        { cwd, timeoutMs: teamTurnTimeoutSecs * 1000 }
      );
      const allDone = tasks.length > 0 && tasks.every((t) => t.done);
      updateSpec(projectId, spec.id, { tasks, phase: allDone ? "done" : "implement" });
    }
  } catch (e) {
    useSpecRunStore.getState().setError(spec.id, e instanceof Error ? e.message : String(e));
  } finally {
    useSpecRunStore.getState().finishRun(spec.id);
  }
}
