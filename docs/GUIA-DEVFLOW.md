# Guía de DevFlow

> Documento para dos audiencias. Si nunca programaste, leé **"DevFlow en simple"**.
> Si sos desarrollador/a, saltá a **"Referencia para usuarios expertos"**.
> Última actualización: 2026-07-09 · App en `F:\mimo-agent`.

---

## Índice

1. [DevFlow en simple (usuario no experto)](#1-devflow-en-simple-usuario-no-experto)
2. [Referencia para usuarios expertos](#2-referencia-para-usuarios-expertos)
3. [Instalación y arranque](#3-instalación-y-arranque)
4. [Recorrido por cada feature](#4-recorrido-por-cada-feature)
5. [Conceptos clave y arquitectura](#5-conceptos-clave-y-arquitectura)
6. [Preguntas frecuentes / límites conocidos](#6-preguntas-frecuentes--límites-conocidos)

---

## 1. DevFlow en simple (usuario no experto)

### ¿Qué es DevFlow?

DevFlow es una **aplicación de escritorio para construir software conversando con agentes de
inteligencia artificial**. En vez de escribir todo el código a mano, le describís a un asistente qué
querés lograr y el asistente **lee y escribe los archivos de tu proyecto, ejecuta comandos y te
muestra lo que hizo**, paso a paso.

Pensalo como un "taller" con varias herramientas alrededor de un chat:

- Un **chat** donde le pedís cosas al asistente (como ChatGPT, pero puede tocar tus archivos de verdad).
- Un **editor de código** para ver y ajustar lo que se generó.
- **Terminales** (esas pantallas negras donde se escriben comandos) integradas, sin salir de la app.
- Un **tablero de proyectos** para tener varias cosas en las que trabajás, ordenadas.
- Un **equipo de asistentes especializados** (uno sabe de bases de datos, otro de seguridad, otro de
  interfaces…) que se reparten el trabajo.
- **Ambientes de prueba seguros**: el asistente puede experimentar en una copia aislada de tu proyecto
  sin riesgo de romper el original.

### ¿Para qué lo puedo usar?

- **Crear una aplicación desde cero** describiéndola con tus palabras.
- **Entender un proyecto que ya existe**: pedirle al asistente que te explique qué hace cada parte.
- **Automatizar tareas repetitivas** encadenando pasos (un "workflow" o flujo).
- **Correr y probar** tu programa sin conocer los comandos de memoria.

### ¿Cómo lo uso, en 5 pasos?

1. **Abrí un proyecto.** Arriba a la izquierda hay un selector de proyecto. Elegí una carpeta existente
   o creá una nueva.
2. **Andá al Chat** (primer ícono de la barra izquierda) y escribí lo que querés, en español. Por
   ejemplo: *"Creá una página web simple que muestre 'Hola mundo'"*.
3. **Mirá lo que hace.** El asistente te muestra sus pensamientos, los archivos que crea y los comandos
   que ejecuta, en vivo.
4. **Revisá el resultado** en el editor de **Código** o corriendo tu proyecto desde **Servicios**.
5. **Pedí ajustes** en el mismo chat: *"cambiá el color de fondo a azul"*.

No necesitás saber programar para empezar. Sí ayuda tener paciencia: los asistentes de IA a veces
tardan y a veces se equivocan; siempre podés pedirles que corrijan.

> **Importante sobre seguridad:** el asistente puede ejecutar comandos reales en tu computadora. DevFlow
> viene con una opción (en **Settings → Seguridad**) para que te pida permiso antes de acciones
> sensibles. Está **desactivada por defecto** para que fluya; si querés más control, activala.

---

## 2. Referencia para usuarios expertos

### Qué es, técnicamente

DevFlow es una **app de escritorio Tauri v2 (Rust) + React 19 + TypeScript** que actúa como **host de
agentes que hablan Agent Client Protocol (ACP)**. No implementa un cliente LLM propio ni guarda API
keys de modelos: **spawnea agentes como procesos hijo** (`mimo acp`, Claude Code vía
`@zed-industries/claude-code-acp`) y se comunica con ellos por **JSON-RPC 2.0 sobre stdio**,
renderizando los eventos estructurados (streaming de texto, *thinking*, tool-calls, diffs, permisos,
plan) en la UI.

**La inferencia y las credenciales las gestiona el CLI de cada agente**, no DevFlow. Esto significa que
"qué modelo usás" y "con qué cuenta" se resuelve fuera de la app (ej. `mimo providers login`,
`claude /login`), y DevFlow descubre los modelos disponibles en runtime vía las `configOptions` de
`session/new`.

### Stack

| Capa | Tecnología |
|------|-----------|
| Shell de escritorio | Tauri v2 (backend Rust) |
| UI | React 19 + TypeScript + Vite 7 |
| Estado | Zustand (con `persist` a localStorage) |
| Editor | CodeMirror 6 (lang packs JS/TS/Rust/Python/JSON/HTML/CSS/MD) |
| Terminales | `@xterm/xterm` + `portable-pty` (ConPTY en Windows, Git Bash) |
| Workflows visuales | React Flow (`@xyflow/react`) |
| Markdown | `react-markdown` + `remark-gfm` |

### Comandos Tauri (backend `src-tauri/src/lib.rs`)

- **Agentes ACP:** `acp_start(provider, command, args)` / `acp_send` / `acp_stop` — `HashMap` de procesos
  keyed por provider. Evento `acp-message:{provider}`.
- **Filesystem:** `read_text_file` / `write_text_file` / `read_dir` / `create_dir`.
- **PTY:** `pty_spawn(id, cwd, rows, cols, command?, env?)` / `pty_write` / `pty_resize` / `pty_kill`.
  Un hilo lector por sesión emite `pty-output:{id}` / `pty-exit:{id}`. Con `command` corre un one-shot
  (`bash -lc`); sin él, shell interactivo. `env` inyecta variables por proyecto.
- **MCP:** `start_mcp_server` / `stop_mcp_server` / `get_running_servers` / `check_prerequisites`.
- **Portabilidad:** `home_dir` / detección de `hermes` en runtime (no se hardcodean paths de la máquina).

### Modelo mental de navegación

El NavBar es **project-centric**: arriba, un selector del **proyecto activo**; debajo, dos tiers.

- **Tier "Proyecto"** — retargetea al cambiar de proyecto: Chat · Código · Terminales · Mapa ·
  Servicios · Ambientes.
- **Tier "General"** — transversal, no atado a un proyecto: Equipo · Workflows · Agents · MCP · Settings.

El **Project Hub** (vista Proyectos) se abre desde el selector → *"Gestionar proyectos…"*.

### Providers de agente incluidos

| Provider | Comando ACP | Auth | Notas |
|----------|-------------|------|-------|
| **MiMo Code** | `mimo acp --print-logs --log-level ERROR` | sesión OAuth del CLI `mimo` | agente principal, el más capaz para tool-calls |
| **Claude Code** | `npx -y @zed-industries/claude-code-acp` | `claude /login` | adaptador ACP de Zed; primer `npx` baja el paquete |

**Hermes** ya **no** es agente de chat: quedó demotado a **servidor MCP de mensajería** (se agrega desde
la vista MCP, no desde el selector del chat).

---

## 3. Instalación y arranque

### Prerrequisitos

| Requisito | Para qué | Cómo verificar |
|-----------|----------|----------------|
| Node.js + npm | build del frontend, CLIs | `node -v`, `npm -v` |
| Rust + toolchain de Tauri | backend de escritorio | `cargo --version` |
| Git Bash (Windows) | terminales y shell del agente | `C:\Program Files\Git\bin\bash.exe` |
| CLI `mimo` **logueado** | agente MiMo Code | `mimo providers whoami` |
| CLI `claude` **logueado** (opcional) | agente Claude Code | `claude /login` |
| Ollama + Hermes (opcional) | MCP de mensajería | solo si se usa ese MCP |

### Arranque en desarrollo

```bash
cd F:\mimo-agent
npm install          # primera vez
npm run tauri dev    # levanta Vite + compila Rust + abre la ventana
```

- **Tests unitarios:** `npm test` (Vitest — templating de workflows, cron, router de expertos).
- **Type-check + build:** `npm run build` (`tsc && vite build`).

### Arranque con inspección remota (para pruebas E2E por CDP)

En Windows, la app es WebView2; se puede automatizar por Chrome DevTools Protocol:

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
```

Ver `docs/PRUEBA-E2E.md` para el detalle.

---

## 4. Recorrido por cada feature

> Orden según el NavBar. Cada feature indica **qué es**, **para quién** y **cómo se usa**.

### Tier Proyecto

#### 4.1 Chat (`MessageSquare`)

- **Qué es:** el corazón de DevFlow. Una conversación con un agente ACP que **lee y escribe archivos
  reales, ejecuta comandos y transmite todo en vivo**.
- **Para quién:** todos.
- **Cómo se usa:**
  - Elegí el **agente** (MiMo Code / Claude Code) y, al lado, el **modelo** (se descubre en runtime).
    El agente es **por pestaña**: podés tener conversaciones con distintos agentes en paralelo.
  - Escribí tu pedido en español y enviá. Verás:
    - **Thinking** (razonamiento, en itálica atenuada),
    - **tarjetas de tool-call** con el comando (`$ …`) y su salida, o el **diff** de cada archivo escrito
      (verde = agregado, rojo = quitado; los edits se compactan en un `<details>` expandible),
    - la **respuesta** en markdown.
  - **No bloqueante:** durante un turno el input sigue vivo. Si mandás otro mensaje, se **encola** (chips
    arriba del input, con × para quitar). **Detener** interrumpe el turno actual y arranca el siguiente
    de la cola. La cancelación es **selectiva por pestaña** (detener una no corta las otras).
  - **Contexto:** desde el panel derecho o el File Explorer, marcá archivos con el ícono de *bookmark*
    para adjuntarlos; aparecen como chips sobre el input. El contenido se manda una vez por sesión (no se
    re-envía si no cambió).
  - **Dictado por voz:** botón de micrófono (Web Speech API, `es-AR`).
  - **Permisos:** si el agente pide permiso para una acción, aparece un modal para aprobar/denegar
    (sujeto a la config de Settings → Seguridad; hoy MiMo raramente lo emite).
- **Chat lateral (dock):** en cualquier vista que no sea Chat, el botón `Chat` de la derecha abre el
  **mismo** chat como panel lateral (no es otra instancia; se reposiciona por CSS).

#### 4.2 Código (`FileCode`) — Editor

- **Qué es:** editor CodeMirror 6 con pestañas, **scopeado por proyecto** (al cambiar de proyecto cambian
  las pestañas abiertas y el chip "editando").
- **Para quién:** quien quiera revisar o ajustar a mano lo que el agente generó.
- **Cómo se usa:** abrí archivos desde el File Explorer o desde las tarjetas del chat. Un *watcher* vigila
  los archivos abiertos (de todos los proyectos) y refleja cambios en disco. El archivo activo del
  proyecto se puede inyectar como contexto al chat (solo si pertenece al proyecto activo).

#### 4.3 Terminales (`SquareTerminal`)

- **Qué es:** panel de **terminales interactivas independientes** (PTY real con Git Bash), desacopladas
  del chat.
- **Para quién:** cualquiera que necesite una consola; expertos sobre todo.
- **Cómo se usa:** creá varias terminales, cada una con **nombre y `cwd` propios** (default = carpeta del
  proyecto activo). Son interactivas carácter por carácter (historial con ↑, `Ctrl+C`, `Ctrl+U`,
  variables de entorno que persisten). Cambiar de pestaña **no** mata el proceso; cerrarla sí.

#### 4.4 Mapa (`Network`) — Codebase Map

- **Qué es:** grafo del proyecto (relaciones de imports entre archivos).
- **Para quién:** para entender la estructura de un proyecto de un vistazo.
- **Cómo se usa:** abrí la vista con el proyecto activo; explorá el grafo de dependencias.

#### 4.5 Servicios (`TerminalSquare`)

- **Qué es:** corré **servidores/procesos de larga duración** (ej. `npm run dev`) en terminales
  **aisladas y gestionadas**, en vez de dentro de un turno del agente (que lo colgaría).
- **Para quién:** todos; imprescindible para levantar y probar tu app.
- **Cómo se usa:** definí un servicio (`nombre`, `comando`, `cwd`). Iniciar/detener/reiniciar/quitar,
  con **logs en vivo** y estado por color (verde = corriendo, gris = detenido, ámbar = terminó, rojo =
  falló). El **env del proyecto** se inyecta al proceso vía Rust. Detecta cuando un proceso termina solo
  (estado *exited*, conservando los logs). Los servicios **viven dentro del proyecto** (scope duro).

#### 4.6 Ambientes (`Boxes`) — Environments

- **Qué es:** **entornos aislados** (git worktree efímero) donde el agente puede trabajar **sin tocar el
  proyecto real**.
- **Para quién:** quien quiera dejar experimentar al agente con red de seguridad.
- **Cómo se usa:** crear ambiente → **"Abrir en chat"** hace que el agente trabaje **aislado** en el
  worktree → **Ver diff** → **Promover** (merge a la rama base, con manejo de conflictos) o **Descartar**
  (limpia el worktree sin huérfanos).

### Tier General

#### 4.7 Equipo (`Users`) — Team

- **Qué es:** un **equipo de 9 agentes expertos** por área, sobre MiMo, cada uno con system prompt de
  especialidad: **Arquitecto, Frontend/UI, Backend/APIs, Base de Datos, DevOps/Infra,
  SRE/Observabilidad, Seguridad, QA/Testing, Producto/Negocio**.
- **Para quién:** tareas que se benefician de dividir por especialidad.
- **Cómo se usa:**
  - **Router determinista:** escribí una tarea y el sistema puntúa por keywords y **recomienda** el
    experto adecuado; "Abrir en chat" arranca una sesión con ese experto y la tarea precargada.
  - **Auto-delegar:** un agente líder **descompone** la tarea en sub-tareas, **delega** cada una a su
    experto (en sesión ACP propia, en paralelo, con timeout por turno) y **sintetiza** los aportes.
  - **Aislar en un ambiente** (ON por defecto): la auto-delegación corre en un git worktree efímero; al
    terminar, un banner te lleva a **Ambientes** a revisar el diff / promover / descartar.

#### 4.8 Workflows (`GitBranch`)

- **Qué es:** editor **visual** de flujos (React Flow) para **encadenar pasos** automatizados.
- **Para quién:** automatizar procesos repetibles (con o sin IA en el medio).
- **Cómo se usa:** armá un grafo de nodos (agente, MCP, transformaciones, bucles con *loop* paralelo,
  etc.) usando **variables nombradas** y templating (`{{...}}`). Nodos del mismo agente **reusan la
  sesión ACP** (comparten contexto). **Triggers:** un workflow se puede disparar por **webhook**
  (`/hook/<id>`, con token no adivinable y opt-in de usar el body como input) o por **cron**.

#### 4.9 Agents (`Bot`)

- **Qué es:** catálogo/CRUD de agentes: nombre, ícono, provider, modelo, **system prompt** editable,
  skills.
- **Para quién:** expertos que quieran definir agentes a medida.
- **Cómo se usa:** creá/editá agentes; el system prompt se inyecta al abrir la sesión ACP. Los 9 expertos
  vienen sembrados como *defaults* (tag `expertArea`) y no saturan el selector del chat.

#### 4.10 MCP (`Server`)

- **Qué es:** gestión de **servidores MCP** (Model Context Protocol) — procesos que exponen herramientas
  al agente.
- **Para quién:** quien quiera ampliar las capacidades del agente con tools externas.
- **Cómo se usa:** arrancá/pará servidores MCP, verificá prerequisitos. **Hermes** se ofrece acá como
  **"Hermes · Mensajería"** (expone solo mensajería vía `hermes mcp serve`; la entrada se oculta si
  Hermes no está instalado, detección en runtime).

#### 4.11 Settings (`Settings`)

- **Qué es:** ajustes de la app.
- **Para quién:** todos, en especial para la postura de seguridad.
- **Cómo se usa:** **Seguridad** — toggle `autoApprovePermissions` (**OFF por defecto**: las solicitudes
  de permiso del agente se **deniegan** salvo que lo actives) + log de decisiones recientes. Selección de
  modelo por agente (persistida).

### Project Hub (vista Proyectos) — 8 tabs

Se abre desde el selector de proyecto → *"Gestionar proyectos…"*. Es el centro de gestión **por
proyecto**:

| Tab | Qué hace |
|-----|----------|
| **Overview** | stack detectado (parsea `package.json`/`Cargo.toml`/etc.), contadores (servicios/agentes/flujos/docs), deuda técnica |
| **Estructura** | árbol de archivos embebido (File Explorer) |
| **Documentación** | ver/editar los `.md` del repo |
| **Contexto** | items de contexto **por proyecto** |
| **Agentes** | CRUD de expertos asociados al proyecto |
| **Flujos** | crear/editar/asociar workflows |
| **Servicios** | los servicios del proyecto |
| **Ajustes** | Ambiente (env vars) · Git (status read-only) · Tracking · renombrar/borrar |

**Crear proyecto — 3 formas:** carpeta existente (`pickFolder`) · **scaffold** nuevo (nombre + git
init/README/.gitignore) · **clonar** de git (URL + destino). El registro es multi-proyecto
(`projects: Record<id, Project>` + `order` + `activeId`), con **scope duro** por proyecto.

---

## 5. Conceptos clave y arquitectura

- **DevFlow no hace inferencia.** Es un *host* de agentes ACP. Cambiar de modelo/proveedor se hace en el
  CLI del agente; DevFlow descubre los modelos en runtime.
- **ACP (Agent Client Protocol):** el protocolo abierto (JSON-RPC sobre stdio) que también usa Zed para
  embeber agentes. DevFlow habla ACP con cada agente y mapea sus eventos a la UI.
- **Project-centric:** casi todo cuelga del proyecto activo. El estado se persiste con Zustand+`persist`
  (con migraciones de versión); datos transitorios (procesos, colas, estados de servicio) se excluyen del
  persist y se resetean al reiniciar.
- **Aislamiento por git worktree:** la forma liviana de dar a los agentes un sandbox sin Docker (elegida
  por el espacio ajustado en disco C: de esta máquina).
- **Windows / PTY:** en Windows el ConPTY no reporta EOF de forma fiable; DevFlow usa un hilo *waiter*
  sobre `child.wait()` para detectar fin de proceso. El shell es Git Bash (no `cmd`/WSL) para sintaxis
  Unix consistente entre Windows/Linux/Mac.

---

## 6. Preguntas frecuentes / límites conocidos

- **"El agente tarda mucho."** La latencia depende del modelo/servicio del agente (MiMo suele estar en
  segundos; un modelo local chico puede tardar 40–60 s). No asumas que está roto: esperá.
- **"No me pide permisos nunca."** Con la build actual, MiMo casi nunca emite `session/request_permission`
  (ejecuta las tools directo). La UI de permisos existe y se activará con agentes que sí lo pidan.
- **"¿Puedo usar otro modelo/proveedor?"** Sí, desde el CLI del agente (`mimo providers login` admite
  endpoints OpenAI-compatible: Ollama, vLLM, LM Studio…). DevFlow lo tomará en el selector de modelo.
- **Métricas:** la app **registra** métricas de uso (tokens aprox., latencia, ejecuciones) internamente,
  pero la vista `MetricsView` **no está cableada** al NavBar en esta versión (no hay pantalla para verlas
  todavía).
- **Costo de tokens:** las métricas de tokens son **aproximadas** (`chars ÷ 4`), no el conteo real del
  proveedor.
- **Ambientes:** hoy el único aislamiento es **git worktree**. Docker/copia-de-carpeta quedan como mejora
  futura (baja prioridad).

---

*Documento vivo. Ante dudas, la fuente de verdad del diseño acordado está en
`docs/DISENO-proyectos-chat-servicios.md`.*
