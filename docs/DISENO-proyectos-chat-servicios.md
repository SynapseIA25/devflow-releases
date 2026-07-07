# Diseño — Chat no-bloqueante · Bugs del review · Proyectos · Servicios aislados

> Documento de diseño acordado antes de implementar (2026-07-06). Cubre los 4 frentes
> pedidos por el usuario. Decisiones ya tomadas: (1) **diseño completo antes de codear**;
> (2) al escribir durante un turno en curso → **encolar por defecto + botón interrumpir**;
> (3) aislar servidores del chat → **panel de Servicios gestionado**.

---

## 0. Estado actual VERIFICADO (corrige la memoria)

Leído el código real hoy (no la memoria, que estaba desactualizada en esto):

- **El botón "Detener turno" YA existe.** `ChatView.stopTurn()` (`ChatView.tsx:513`) y el botón
  `hterm-stop-btn` (línea 704, se muestra cuando `loading`). `acpClient.cancel(provider, sessionId)`
  (`acpClient.ts:239`) ya manda `session/cancel` y destraba el `pending` local. O sea, la parte
  "cancelar" del Frente 1 está mayormente hecha — falta corregirle los bugs y sumarle lo no-bloqueante.
- **La raíz de los bugs son 3 singletons** en `ChatView` que deberían ser por-workspace:
  - `loading` (`:205`) — un solo booleano global → deshabilita el input de TODOS los workspaces.
  - `currentTurnRef` (`:217`) — una sola referencia → **solo puede haber un turno en vuelo a la vez**
    en toda la app; el handler de `session/update` (`:274`) enruta por este ref único.
  - `turnCancelledRef` (`:220`) — global → cancelar/arrancar un turno en un ws pisa la señal de otro.
- **`acpClient.cancel` rechaza TODO `s.pending` del provider** (`acpClient.ts:242-245`) → cancelar
  un turno mata prompts en vuelo de otros workspaces que comparten el mismo proceso agente (mimo/hermes).
- **Auto-aprobación de permisos**: `acpClient.ts:113-119` — si no hay listener de UI, aprueba sola la
  primera opción `allow*`. Los workflows corren sin listener → auto-aprueban todo en silencio.
- **`projectStore`** (`projectStore.ts`) es hoy **una sola ruta** (`projectPath`). Es el punto de
  partida del Frente 4.
- **Infra PTY** (`lib.rs:585-716`): `PtySession{master,writer,child}` en `PtySessions(Mutex<HashMap>)`,
  comandos `pty_spawn/pty_write/pty_resize/pty_kill`, eventos `pty-output:{id}`/`pty-exit:{id}`. El
  Frente 3 la reutiliza.

---

## Frente 1 — Chat no-bloqueante (turnos por workspace + cola + interrumpir)

### Objetivo
1. Poder **seguir escribiéndole al agente** aunque haya un turno en curso.
2. Al enviar durante un turno activo → el mensaje **se encola** y se manda solo al terminar el turno.
3. Botón **interrumpir** (el actual "Detener turno") para cortar el turno en curso y, si hay cola,
   seguir con el siguiente.
4. Corregir de raíz los bugs de cancelación multi-workspace del review.

### Diseño

**De singletons a estado por-workspace.** Se elimina la premisa "un turno a la vez en toda la app".

- **`loading` (global) → estado por-workspace.** Nuevo campo transitorio en `Workspace`:
  `running?: boolean` (no se persiste; `partialize` lo excluye). El input **nunca se deshabilita**
  (`disabled={loading}` se quita). El botón alterna Send/Stop según `ws.running` del workspace activo.

- **`currentTurnRef` (único) → `activeTurnsRef: Map<string, TurnState>`** keyed por
  `${provider}:${sessionId}`. `TurnState = { wsId, aiBlockId, outChars }`. El handler de
  `onUpdate(provider, sessionId, update)` (`:273`) ya recibe `provider` y `sessionId` → busca el
  turno por esa clave en vez del ref único. Esto habilita **streaming concurrente de varios workspaces**.

- **`turnCancelledRef` (global) → señal por-workspace.** Se mueve a un
  `cancelledRef: Map<wsId, boolean>` (o a `ws.running=false` como señal). El `/run` desde el chat
  (`:497`) consulta la señal del ws que lo disparó.

- **Cola por-workspace.** Nuevo campo transitorio `queue?: string[]` en `Workspace`
  (mensajes de usuario pendientes de enviar). Flujo:
  - `handleSend`: si `ws.running` → `enqueue(wsId, text)` (agrega a `queue` y pinta el bloque de
    usuario con marca "en cola"); si no → arranca el turno (`runAI`).
  - Al terminar un turno (`finally` de `runAcp`, y también tras un `cancel`): si `queue` no está
    vacía → `dequeue` el primero y arranca su turno automáticamente.
  - **Interrumpir** (`stopTurn`): cancela el turno en vuelo del ws; la cola **NO** se limpia, sigue
    con el próximo. (Botón aparte opcional "vaciar cola" — fuera de v1.)

- **UI.** Botón Send siempre habilitado. Cuando `ws.running`: se muestran **Send (encola)** y
  **Stop (interrumpe)** juntos — enviar agrega a la cola sin cortar el turno; Stop corta. Chips/mini-
  lista de mensajes en cola arriba del input, con × para quitar uno de la cola.

### Fix del bug de `acpClient.cancel` (review 🟠)
Hoy rechaza todo `s.pending` del provider. Fix: **taggear cada pending con su `sessionId`**.

```ts
type PendingRequest = { resolve; reject; sessionId?: string };
// sendRequest recibe un sessionId opcional; para session/prompt se pasa el sessionId real.
// cancel(provider, sessionId) => solo rechaza los pending cuyo sessionId === sessionId.
```

Los requests cortos (initialize / session/new / set_config_option) no llevan sessionId y no se tocan
en un cancel. Solo el `session/prompt` (el largo) queda asociado a su sesión y se corta selectivo.

### Notas
- El cuelgue real (agente que lanza un server de larga duración en un turno) sigue existiendo hasta
  el Frente 3; pero con cola + interrupt el chat **ya no queda inutilizable** (se interrumpe y se sigue).
- ACP es un turno por sesión: no se puede tener 2 `session/prompt` simultáneos en la MISMA sesión →
  por eso la cola. Sí pueden correr en paralelo turnos de **workspaces distintos** (sesiones distintas).

---

## Frente 2 — Resto de bugs del review

Referencia: `[[devflow-review-pendientes]]`. Los dos 🟠 de cancelación se resuelven en el Frente 1.
El resto:

| Bug | Severidad | Fix propuesto |
|---|---|---|
| Auto-aprobación silenciosa de permisos (`acpClient.ts:113`) | 🔴 | Hacerlo **opt-in y visible**. Nuevo setting por-proyecto `autoApprovePermissions` (default **false**). Sin listener + setting off → responder `cancelled` (no auto-allow) y loguear; con setting on → auto-allow + registrar en un log de permisos visible. En el chat el modal ya existe y decide el usuario. |
| Cadena webhook → RCE (`lib.rs` webhook + `workflowEngine` `new Function`/shell) | 🔴 | (1) Token del webhook **no adivinable** (uuid/crypto, no el id secuencial). (2) Flag **opt-in por trigger** `allowExternalInput` (default off): si off, el body del webhook NO entra como `{{input}}` (se descarta o se pasa saneado). (3) Documentar que un flujo con webhook + nodo terminal/condition es superficie de ejecución; el webhook queda en 127.0.0.1. |
| Sesión ACP nueva por cada nodo mimo/agent (`workflowEngine`) | 🟡 | Cache de sesión por (provider, flowRunId) reutilizable dentro de un Run; opcional, mejora de costo. |
| Loop paralelo sin agregación de errores (`Promise.all`) | 🟡 | `Promise.allSettled` + recolectar errores por item y reportarlos en el log/salida, sin perder el resto. |
| `protocolVersion` hardcodeado "2024-11-05" (`mcp_call_tool`, `lib.rs`) | 🟡 | Extraer a constante + comentar; negociar si el server responde otra. |
| FS sin restricción de paths | 🟡 | Aceptable en un IDE; documentar. Opcional: restringir a la carpeta del proyecto activo detrás de un flag. |
| Archivo huérfano `.acp-raw-test3.cjs` | 🟡 | Borrar. |
| **Sin tests del motor** | 🟡 | Unit tests de lógica pura: `resolveTemplate`/`getPath` (JSON paths), topo-sort + detección de ciclos, branching de condition, `parseList`, `cronMatches`. Ya hay scripts ad-hoc validados (13/13, 11/11) → formalizarlos con un runner (vitest) en el repo. |

---

## Frente 3 — Panel de Servicios aislado (correr servidores sin tocar el chat)

### Objetivo
Las ejecuciones de servidores/procesos de larga duración para **probar el proyecto** corren en
**terminales aisladas gestionadas**, nunca dentro de un turno del agente (que es lo que hoy lo cuelga).

### Modelo
```ts
type Service = {
  id: string;
  name: string;          // "Dev server", "API", "Worker"
  command: string;       // "npm run dev"
  cwd?: string;          // default: ruta del proyecto activo
  autoRestart?: boolean; // reiniciar si muere (v1: opcional)
  status: "stopped" | "running" | "exited";
  exitCode?: number;
};
```
Los servicios **viven dentro del Proyecto** (Frente 4): `Project.services: Service[]`.

### Backend (Rust) — reutiliza la infra PTY
- Nuevo comando `service_spawn(id, cwd, command)`: corre `bash -lc "<command>"` (Git Bash en Win,
  `windows_bash_path()` ya existente) **dentro de un PTY**, reutilizando `PtySession` y emitiendo los
  mismos eventos `pty-output:{id}` / `pty-exit:{id}`. Alternativamente, generalizar `pty_spawn` con un
  `command: Option<String>` (si viene, ejecuta ese comando; si no, shell interactivo como hoy).
- Stop/restart: `pty_kill(id)` (ya existe) + volver a spawnear. Input opcional con `pty_write` (para
  procesos que aceptan comandos).
- **Aislamiento clave:** el id del servicio es su propio namespace PTY, independiente de los ids de
  workspace del chat → un server colgado nunca afecta el ciclo de turno del agente.

### Frontend
- Nueva vista/panel **"Servicios"** (nav item, ícono tipo `Server`/`Play`): lista de servicios del
  proyecto con estado (dot verde/gris/rojo), botones **Iniciar / Detener / Reiniciar**, y un panel de
  **logs por servicio** (un `TerminalPane`-like read/interactivo montado por servicio corriendo, mismo
  patrón que las terminales del chat: montado mientras el servicio vive, `display:none` si no está
  seleccionado). "＋ Agregar servicio" (form: nombre + comando).
- Reusa el componente de terminal existente (extraer la lógica de `TerminalPane` para aceptar un
  `command` inicial, o un `ServicePane` gemelo).

### Integración con el agente (cierra el cuelgue)
- Nuevo comando/tool para que el agente **levante un servicio** en vez de correrlo inline:
  vía un **MCP tool** de DevFlow (o un comando Rust expuesto) `start_service(name, command)` que crea/
  arranca un `Service` gestionado y **devuelve al instante** (no bloquea el turno). El agente recibe
  "servicio X iniciado, logs en el panel Servicios" y su turno termina normal.
- Regla en el system prompt de los agentes del proyecto: "para servers/procesos de larga duración usá
  `start_service`, nunca los corras inline en un comando del turno".

### Limitaciones v1
- Sin health-checks HTTP (solo estado del proceso). `autoRestart` simple (respawn on exit) opcional.
- Los logs no se persisten entre reinicios de la app (viven en el buffer de xterm).

---

## Frente 4 — Administración de Proyectos

### Objetivo
Un apartado para **administrar proyectos**: por proyecto se setean ambiente (env vars), herramientas
(git, tracking de issues), workflows, y **agentes expertos** del proyecto. Es el **contenedor** natural
de los Servicios (Frente 3) y de los agentes.

### Modelo de datos
`projectStore` (una ruta) evoluciona a un **registro de proyectos**:
```ts
type Project = {
  id: string;
  name: string;
  path: string;                       // carpeta raíz (reemplaza projectPath)
  env: Record<string, string>;        // ambiente → se inyecta a Servicios y terminales del proyecto
  git?: { enabled: boolean };         // integración git (branch/status; acciones en fase posterior)
  tracking?: { type: "github" | "url" | "none"; url?: string }; // issues (v1 liviano)
  workflowIds: string[];              // workflows asociados (o "todos" si vacío)
  agentIds: string[];                 // agentes expertos scopeados al proyecto
  services: Service[];                // Frente 3
};

type ProjectsStore = {
  projects: Record<string, Project>;
  order: string[];
  activeId: string;
  // acciones: createProject/deleteProject/renameProject/setActiveProject/updateProject
  // + selectores de compat: projectPath = projects[activeId].path
};
```

### Migración (persist v0 → v1)
- `devflow-project` `{ projectPath }` → envolver en un proyecto por defecto:
  `{ id, name: "<basename de la ruta>", path: projectPath, env:{}, workflowIds:[], agentIds:[], services:[] }`,
  `activeId` = ese.
- **Compat sin romper consumidores:** exponer un selector/campo `projectPath` (= `projects[activeId].path`)
  para que `ChatView`/`workflowEngine`/`FileExplorer`/`ContextPanel` sigan andando sin cambios mientras
  se migran gradualmente. Cambiar el proyecto activo cambia `projectPath` → todo re-rootea como hoy.

### Vista "Proyectos" (dashboard)
- Nav item nuevo "Proyectos". Lista de proyectos (crear con selector de carpeta nativo `pick_folder`
  ya existente / cambiar activo / renombrar / borrar).
- Panel de configuración del proyecto seleccionado, en secciones:
  - **Ambiente:** editor de env vars (key/value) → se pasan a `service_spawn` y a las terminales nuevas
    del proyecto.
  - **Git:** branch y estado (read-only vía `run_shell_command git status/branch`); acciones
    (commit/push/pull) → fase posterior.
  - **Tracking:** tipo + URL (v1: link/estado; integración real de issues → fase posterior).
  - **Workflows:** asociar/ver los flujos del proyecto (el `workflowStore` puede scopearse por proyecto
    o mantenerse global con filtro — decisión de implementación, ver abajo).
  - **Agentes expertos:** crear/editar agentes con system prompt propios del proyecto (reusa
    `agentsStore`; se agrega `agent.projectId?`). El selector de agente del chat muestra los globales +
    los del proyecto activo.
  - **Servicios:** el CRUD del Frente 3.

### Alcance por fases dentro del Frente 4
- **v1:** registro + switch + migración + env + git status (read-only) + asociar agentes/servicios.
- **v2 (posterior):** tracking de issues real (GitHub API), acciones git, scope de workflows por proyecto.

### Decisión de implementación abierta
- **Workflows/agentes: ¿scope duro por proyecto o global con filtro?** Recomiendo **global con
  asociación** en v1 (menos migración de los stores existentes `workflowStore`/`agentsStore`), y evaluar
  scope duro si hace falta aislar de verdad.

---

## Orden de implementación (fases)

1. **Fase 1 — Chat no-bloqueante + fixes de cancelación.** Turnos por workspace (quitar los 3
   singletons), cola + interrumpir, `acpClient.cancel` selectivo por `sessionId`. Cierra los dos 🟠 del
   review. *Dolor agudo y fundacional → primero.*
2. **Fase 2 — Resto de bugs del review.** Permisos opt-in, token webhook + flag externo, protocolVersion,
   reuse de sesión, loop `allSettled`, borrar huérfano, y **tests del motor (vitest)**.
3. **Fase 3 — Modelo de Proyectos (v1).** `projectsStore` + migración + vista Proyectos + env + git
   status + asociar agentes. Contenedor para lo que sigue.
4. **Fase 4 — Panel de Servicios aislado.** `service_spawn` (Rust) + vista Servicios + start/stop/restart/
   logs + tool `start_service` para el agente. *Fix definitivo del cuelgue.*
5. **Fase 5 (posterior) — Tracking de issues, acciones git, scope de workflows por proyecto, agentes
   expertos avanzados.**

Cada fase: `cargo check` + `tsc --noEmit` + `npm run build` verdes + verificación runtime (CDP con la
app relanzada con `--remote-debugging-port`, patrón ya usado) + commit (el usuario decide cuándo).

---

## Decisiones abiertas para confirmar antes de codear
1. **Persistir la cola de mensajes** entre reinicios de la app, o transitoria (recomiendo transitoria).
2. **Auto-approve de permisos**: default **off** global, ¿o togglear por-proyecto desde ya? (recomiendo
   setting por-proyecto, default off).
3. **Scope de workflows/agentes**: global-con-asociación (recomendado v1) vs. scope duro por proyecto.
4. **Servicios**: ¿generalizar `pty_spawn` con `command` opcional, o comando `service_spawn` aparte?
   (recomiendo generalizar para reusar todo el frontend de terminal).
