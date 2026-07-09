# Prueba E2E de DevFlow — Plan de test manual

> **Objetivo:** ejercitar **DevFlow en su totalidad** (todas las features accesibles) en un único
> recorrido de punta a punta, verificando que cada pieza funciona y que las piezas se integran.
>
> **Tipo:** plan manual reproducible. No requiere infraestructura de automatización; se ejecuta a mano
> contra la app real. Al final hay un apéndice para automatizar por CDP las partes que sí se pueden.
>
> **Duración estimada:** 45–75 min (la latencia del agente domina).
> **Última actualización:** 2026-07-09.

---

## 0. Precondiciones

Antes de empezar, verificá:

| # | Precondición | Verificación | Estado |
|---|--------------|--------------|:------:|
| 0.1 | Node + npm instalados | `node -v && npm -v` | ☐ |
| 0.2 | Rust/Tauri OK | `cargo --version` | ☐ |
| 0.3 | Git Bash presente | existe `C:\Program Files\Git\bin\bash.exe` | ☐ |
| 0.4 | CLI `mimo` logueado | `mimo providers whoami` → devuelve tu user ID | ☐ |
| 0.5 | CLI `claude` logueado (para el paso de Claude Code) | `claude /login` hecho una vez | ☐ |
| 0.6 | Dependencias instaladas | `npm install` en `F:\mimo-agent` | ☐ |
| 0.7 | Tests unitarios verdes | `npm test` → todo PASS | ☐ |
| 0.8 | Type-check limpio | `npm run build` sin errores | ☐ |

**Datos de prueba sugeridos:** un proyecto de dogfooding, p.ej. `crm-demo` o cualquier carpeta vacía
nueva. **No borres** proyectos reales del usuario (`test-2`, etc.) durante la prueba.

**Arranque de la app:**

```bash
cd F:\mimo-agent
npm run tauri dev
```

Esperá a que abra la ventana y compile el backend Rust (primera vez tarda).

---

## Convención de cada caso

- **Precondición:** estado necesario antes del paso.
- **Acción:** qué hacés.
- **Resultado esperado:** qué debe pasar (criterio de PASS).
- Marcá **PASS / FAIL** y anotá observaciones.

---

## 1. Gestión de proyectos (Project Hub)

### 1.1 — Crear proyecto por scaffold
- **Precondición:** app abierta.
- **Acción:** selector de proyecto (arriba-izq) → *Gestionar proyectos…* → menú **Crear** → **Proyecto
  nuevo (scaffold)** → elegí carpeta padre, nombre `e2e-demo`, tildá *git init*, *README*, *.gitignore*.
- **Resultado esperado:** se crea la carpeta en disco con `.git/`, `README.md`, `.gitignore`; aparece
  `e2e-demo` en la lista y queda **activo**.
- **PASS / FAIL:** ☐  Obs: __________

### 1.2 — Overview detecta el stack
- **Acción:** en el Hub, tab **Overview**.
- **Resultado esperado:** muestra el stack detectado (para `e2e-demo` recién scaffoldeado: mínimo, sin
  deps) y la fila de contadores (servicios/agentes/flujos/docs = 0/0/0 + 1 doc si hay README).
- **PASS / FAIL:** ☐  Obs: __________

### 1.3 — Recorrer los 8 tabs
- **Acción:** clic en cada tab: Overview · Estructura · Documentación · Contexto · Agentes · Flujos ·
  Servicios · Ajustes.
- **Resultado esperado:** los 8 renderizan sin error. Estructura muestra el árbol real; Documentación
  lista `README.md` y lo abre para ver/editar.
- **PASS / FAIL:** ☐  Obs: __________

### 1.4 — Env var por proyecto + Git status
- **Acción:** tab **Ajustes** → sección Ambiente → agregá `E2E_VAR = hola`. Sección Git → activá y mirá
  el status.
- **Resultado esperado:** la env var persiste en el proyecto; Git muestra la rama (`master`/`main`) y
  working tree (limpio o con los archivos scaffoldeados).
- **PASS / FAIL:** ☐  Obs: __________

### 1.5 — Cambiar de proyecto retargetea el contexto
- **Acción:** en el selector, cambiá al proyecto original (ej. `crm-demo`) y volvé a `e2e-demo`.
- **Resultado esperado:** el tier "Proyecto" (Código/Terminales/Servicios/etc.) sigue al proyecto activo;
  no se mezclan contextos.
- **PASS / FAIL:** ☐  Obs: __________

---

## 2. Chat con agente ACP (MiMo Code)

### 2.1 — Turno básico que escribe un archivo
- **Precondición:** `e2e-demo` activo; agente **MiMo Code** seleccionado.
- **Acción:** en **Chat**, enviá: *"Creá un archivo `hola.txt` con el texto 'Hola DevFlow' y confirmame."*
- **Resultado esperado:** ves **Thinking**, una **tarjeta de tool-call** con el diff (`+ Hola DevFlow`),
  la respuesta en markdown, y el archivo existe en disco.
- **PASS / FAIL:** ☐  Obs: __________

### 2.2 — Comando shell del agente
- **Acción:** enviá: *"Ejecutá `ls -la` y mostrame la salida."*
- **Resultado esperado:** tarjeta `$ ls -la` con la salida real del filesystem; step visible al terminar.
- **PASS / FAIL:** ☐  Obs: __________

### 2.3 — Comando que falla se distingue
- **Acción:** enviá: *"Ejecutá `comando-inexistente-xyz`."*
- **Resultado esperado:** el step aparece en **rojo** (failed) y el output muestra `[exit code N]` con
  N ≠ 0.
- **PASS / FAIL:** ☐  Obs: __________

### 2.4 — Chat no bloqueante + cola
- **Acción:** durante un turno en curso, enviá un segundo mensaje.
- **Resultado esperado:** el input **no** se bloquea; el 2º mensaje aparece como **chip de cola**; al
  terminar el 1º, el 2º arranca solo.
- **PASS / FAIL:** ☐  Obs: __________

### 2.5 — Detener turno (cancelación selectiva)
- **Precondición:** abrí **dos pestañas** de chat, ambas con un turno corriendo.
- **Acción:** **Detener** el turno de la pestaña 1.
- **Resultado esperado:** la pestaña 1 muestra "Turno detenido"; la pestaña 2 **sigue** sin cortarse.
- **PASS / FAIL:** ☐  Obs: __________

### 2.6 — Adjuntar contexto
- **Acción:** desde el File Explorer (panel derecho), *bookmark* sobre `README.md` → aparece como chip →
  preguntá *"¿qué dice el archivo adjunto?"*.
- **Resultado esperado:** la respuesta refleja el contenido real del README (llegó como contexto).
- **PASS / FAIL:** ☐  Obs: __________

### 2.7 — Dictado por voz (manual)
- **Acción:** botón de micrófono → hablá una frase → parala.
- **Resultado esperado:** el texto reconocido se apendea al input. *(Requiere micrófono; no automatizable
  por CDP — prompt nativo de permiso.)*
- **PASS / FAIL:** ☐  Obs: __________

### 2.8 — Selector de modelo por agente
- **Acción:** al lado del selector de agente, abrí el **dropdown de modelo**.
- **Resultado esperado:** lista los modelos **descubiertos en runtime** para MiMo; cambiar el modelo
  aplica en vivo.
- **PASS / FAIL:** ☐  Obs: __________

---

## 3. Segundo agente ACP (Claude Code)

### 3.1 — Cambiar a Claude Code y responder
- **Precondición:** `claude /login` hecho.
- **Acción:** nueva pestaña de chat → agente **Claude Code** → enviá una pregunta simple (*"¿cuánto es
  2+2?"*). La primera vez `npx` baja el adaptador (puede tardar unos segundos).
- **Resultado esperado:** responde por ACP; el log de Rust muestra el ciclo completo (initialize → new
  session → prompt → turn ended). MiMo en otra pestaña sigue funcionando (coexisten).
- **PASS / FAIL:** ☐  Obs: __________

---

## 4. Editor de código

### 4.1 — Abrir y editar
- **Acción:** vista **Código** → abrí `hola.txt` (del paso 2.1) → editalo y guardá.
- **Resultado esperado:** CodeMirror abre el archivo en una pestaña; los cambios persisten en disco.
- **PASS / FAIL:** ☐  Obs: __________

### 4.2 — Scope por proyecto
- **Acción:** cambiá de proyecto y volvé.
- **Resultado esperado:** las pestañas abiertas cambian con el proyecto; el chip "editando" refleja el
  proyecto activo.
- **PASS / FAIL:** ☐  Obs: __________

### 4.3 — Watcher de disco
- **Acción:** con `hola.txt` abierto, modificá el archivo desde afuera (o pedile al agente que lo cambie).
- **Resultado esperado:** el editor refleja el cambio en disco.
- **PASS / FAIL:** ☐  Obs: __________

---

## 5. Terminales independientes

### 5.1 — Crear dos terminales con cwd distinto
- **Acción:** vista **Terminales** → creá T1 (cwd = `e2e-demo`) y T2 (cwd = otra carpeta).
- **Resultado esperado:** cada PTY spawnea en su cwd; `pwd` lo confirma; coexisten.
- **PASS / FAIL:** ☐  Obs: __________

### 5.2 — Interactividad cruda
- **Acción:** en T1: `sleep 30` y luego `Ctrl+C`; probá `↑` (historial) y `Ctrl+U` (limpiar línea);
  seteá una variable de entorno (`export FOO=bar`).
- **Resultado esperado:** `Ctrl+C` interrumpe sin colgar; historial y `Ctrl+U` funcionan.
- **PASS / FAIL:** ☐  Obs: __________

### 5.3 — Persistencia entre pestañas
- **Acción:** cambiá a T2 y volvé a T1; `echo $FOO`.
- **Resultado esperado:** el proceso de T1 sigue vivo; `FOO` sigue siendo `bar`.
- **PASS / FAIL:** ☐  Obs: __________

### 5.4 — Cerrar mata el proceso
- **Acción:** cerrá T2.
- **Resultado esperado:** su PTY muere (sin `bash.exe` huérfano).
- **PASS / FAIL:** ☐  Obs: __________

---

## 6. Servicios

### 6.1 — Servicio que corre
- **Acción:** vista **Servicios** → nuevo servicio `web` con comando de larga duración (ej.
  `python -m http.server 8099` o `npm run dev` si el proyecto lo tiene) → **Iniciar**.
- **Resultado esperado:** estado **running** (dot verde) + **logs en vivo**.
- **PASS / FAIL:** ☐  Obs: __________

### 6.2 — Inyección de env del proyecto
- **Precondición:** `E2E_VAR=hola` seteada en el proyecto (paso 1.4).
- **Acción:** servicio con comando `echo "VAR=[$E2E_VAR]"`.
- **Resultado esperado:** los logs imprimen `VAR=[hola]` (el env del proyecto llegó al PTY).
- **PASS / FAIL:** ☐  Obs: __________

### 6.3 — Fin natural detectado
- **Acción:** servicio con un comando que termina solo (ej. `echo done`).
- **Resultado esperado:** estado **exited** (no queda "running" para siempre), logs conservados.
- **PASS / FAIL:** ☐  Obs: __________

### 6.4 — Detener / reiniciar
- **Acción:** detené el servicio `web` y reinicialo.
- **Resultado esperado:** stopped → running de nuevo, con logs frescos.
- **PASS / FAIL:** ☐  Obs: __________

---

## 7. Mapa del codebase

### 7.1 — Grafo de imports
- **Precondición:** un proyecto con varios archivos que se importan entre sí (ideal: `crm-demo` o el
  propio `mimo-agent`).
- **Acción:** vista **Mapa** con ese proyecto activo.
- **Resultado esperado:** se renderiza el grafo de dependencias entre archivos.
- **PASS / FAIL:** ☐  Obs: __________

---

## 8. Ambientes de prueba (git worktree)

### 8.1 — Crear ambiente
- **Precondición:** proyecto con git (`e2e-demo` sirve).
- **Acción:** vista **Ambientes** → crear ambiente.
- **Resultado esperado:** se crea un git worktree efímero; aparece en la lista.
- **PASS / FAIL:** ☐  Obs: __________

### 8.2 — El agente trabaja aislado
- **Acción:** **Abrir en chat** desde el ambiente → pedile al agente crear/modificar un archivo.
- **Resultado esperado:** el cambio ocurre **dentro del worktree**; el proyecto real **no** se toca.
- **PASS / FAIL:** ☐  Obs: __________

### 8.3 — Diff y promover/descartar
- **Acción:** **Ver diff** → luego **Promover** (o crear otro ambiente y **Descartar**).
- **Resultado esperado:** Promover mergea a la base; Descartar limpia el worktree sin huérfanos.
- **PASS / FAIL:** ☐  Obs: __________

---

## 9. Equipo de expertos

### 9.1 — Router recomienda experto
- **Acción:** vista **Equipo** → escribí una tarea con keywords claras (ej. *"optimizar el índice de la
  tabla de usuarios en Postgres"*).
- **Resultado esperado:** el router recomienda **Base de Datos** (o el experto correcto por keywords).
- **PASS / FAIL:** ☐  Obs: __________

### 9.2 — Abrir en chat con la tarea precargada
- **Acción:** "Abrir en chat" sobre la recomendación.
- **Resultado esperado:** se abre una sesión con ese experto y la tarea ya cargada.
- **PASS / FAIL:** ☐  Obs: __________

### 9.3 — Auto-delegación aislada
- **Precondición:** toggle **"Aislar en un ambiente"** ON.
- **Acción:** dale una tarea compuesta (ej. *"agregá un endpoint de login con validación y un test"*) y
  **Auto-delegar**.
- **Resultado esperado:** el líder descompone → varios expertos producen output real → **síntesis final**;
  el trabajo queda en un **worktree efímero** (proyecto real intacto); un banner lleva a **Ambientes**.
- **PASS / FAIL:** ☐  Obs: __________  *(Latencia alta: varios turnos de agente; tené paciencia.)*

---

## 10. Workflows

### 10.1 — Construir un flujo simple
- **Acción:** vista **Workflows** → armá un grafo mínimo (ej. nodo de entrada → nodo **agente** → salida)
  usando variables nombradas `{{...}}`.
- **Resultado esperado:** el editor React Flow permite crear/conectar nodos; el flujo se guarda.
- **PASS / FAIL:** ☐  Obs: __________

### 10.2 — Ejecutar el flujo
- **Acción:** correr el workflow.
- **Resultado esperado:** los nodos ejecutan en orden; el resultado del agente fluye por las variables.
  Nodos del mismo agente **reusan** la sesión ACP (comparten contexto).
- **PASS / FAIL:** ☐  Obs: __________

### 10.3 — Loop paralelo (si aplica)
- **Acción:** un nodo *loop* sobre una lista.
- **Resultado esperado:** los items se procesan; si alguno falla, se agregan errores por-item sin perder
  el resto (solo falla todo si fallan **todos**).
- **PASS / FAIL:** ☐  Obs: __________

### 10.4 — Trigger cron
- **Acción:** asigná un trigger **cron** al workflow con una expresión cercana.
- **Resultado esperado:** al cumplirse el horario, el workflow se dispara solo.
- **PASS / FAIL:** ☐  Obs: __________

### 10.5 — Trigger webhook
- **Acción:** creá un trigger **webhook**; copiá la URL `/hook/<id>`. Con *"usar body como input"*
  activado, hacé un POST (ej. `curl -X POST http://127.0.0.1:<port>/hook/<id> -d '...'`).
- **Resultado esperado:** el `<id>` es un token largo no adivinable; el POST dispara el workflow y el body
  llega como `{{input}}` **solo** si el opt-in está activado.
- **PASS / FAIL:** ☐  Obs: __________

---

## 11. Agents (CRUD)

### 11.1 — Crear un agente a medida
- **Acción:** vista **Agents** → nuevo agente con system prompt propio.
- **Resultado esperado:** se persiste; aparece disponible; el system prompt se inyecta al abrir su sesión.
- **PASS / FAIL:** ☐  Obs: __________

### 11.2 — Los 9 expertos están sembrados
- **Acción:** revisá la lista.
- **Resultado esperado:** aparecen los 9 expertos (tag de área) sin saturar el selector del chat.
- **PASS / FAIL:** ☐  Obs: __________

---

## 12. MCP

### 12.1 — Prerequisitos y arranque
- **Acción:** vista **MCP** → verificá prerequisitos → arrancá un servidor MCP.
- **Resultado esperado:** el servidor pasa a *running* (`get_running_servers` lo refleja).
- **PASS / FAIL:** ☐  Obs: __________

### 12.2 — Hermes como MCP de mensajería (si está instalado)
- **Acción:** buscá **"Hermes · Mensajería"** en el catálogo.
- **Resultado esperado:** si Hermes está instalado, la entrada aparece (ruta detectada en runtime) y
  arranca `hermes mcp serve`; si no, la entrada **se oculta**.
- **PASS / FAIL:** ☐  Obs: __________

---

## 13. Settings / Seguridad

### 13.1 — Postura de permisos por defecto
- **Acción:** vista **Settings** → sección Seguridad.
- **Resultado esperado:** `autoApprovePermissions` está **OFF** por defecto; hay log de decisiones.
- **PASS / FAIL:** ☐  Obs: __________

### 13.2 — Toggle de auto-aprobación
- **Acción:** activá el toggle y confirmá que persiste.
- **Resultado esperado:** el estado se guarda; (si el agente emitiera un `request_permission`, con OFF se
  deniega y con ON se auto-aprueba, ambos quedan en el log). *Nota: MiMo raramente emite permisos, así que
  este camino puede no ejercitarse en la práctica.*
- **PASS / FAIL:** ☐  Obs: __________

---

## 14. Persistencia (cierre e integración final)

### 14.1 — Persistencia tras reinicio
- **Acción:** cerrá y reabrí la app.
- **Resultado esperado:** proyectos, historial de chat, agentes, workflows y definiciones de servicio
  **persisten**; los datos transitorios (procesos vivos, colas, estados de servicio) se **resetean**
  correctamente (los servicios vuelven a *stopped*, las sesiones ACP se recrean en el próximo prompt).
- **PASS / FAIL:** ☐  Obs: __________

### 14.2 — Limpieza
- **Acción:** borrá el proyecto `e2e-demo` y sus artefactos de prueba; descartá ambientes efímeros.
- **Resultado esperado:** queda todo limpio; **no** se tocaron proyectos reales del usuario.
- **PASS / FAIL:** ☐  Obs: __________

---

## Tabla resumen de cobertura

| Área | Casos | Feature cubierta |
|------|-------|------------------|
| 1 | 1.1–1.5 | Project Hub, scaffold/clone/existente, 8 tabs, env, git, multi-proyecto |
| 2 | 2.1–2.8 | Chat ACP: escritura, shell, fallos, cola, cancelación selectiva, contexto, voz, modelo |
| 3 | 3.1 | Segundo agente (Claude Code), coexistencia |
| 4 | 4.1–4.3 | Editor: editar, scope por proyecto, watcher |
| 5 | 5.1–5.4 | Terminales PTY: multi-cwd, interactividad, persistencia, cierre |
| 6 | 6.1–6.4 | Servicios: run, env, exit natural, stop/restart |
| 7 | 7.1 | Mapa del codebase |
| 8 | 8.1–8.3 | Ambientes: worktree, aislamiento, diff/promover/descartar |
| 9 | 9.1–9.3 | Equipo: router, abrir en chat, auto-delegación aislada |
| 10 | 10.1–10.5 | Workflows: construir, ejecutar, loop, cron, webhook |
| 11 | 11.1–11.2 | Agents CRUD + expertos sembrados |
| 12 | 12.1–12.2 | MCP: arranque, Hermes mensajería |
| 13 | 13.1–13.2 | Settings/Seguridad |
| 14 | 14.1–14.2 | Persistencia + limpieza |

**Criterio de aprobación global:** todos los casos en PASS (o FAIL justificado por límite conocido, ej.
2.7 voz sin micrófono, 13.2 permisos que el agente no emite).

---

## Apéndice A — Automatización parcial por CDP

Windows corre la app en WebView2, automatizable por Chrome DevTools Protocol **sin Playwright** (helper
Node con `WebSocket` global, patrón `cdp.mjs`).

**Arranque con puerto de debug:**

```bash
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
```

**Qué SÍ se puede automatizar por CDP:**
- Navegación entre vistas, tipear en la textarea del chat (`.hterm-input-row textarea`), leer los bloques
  renderizados (`.doc-area`, `.xterm-rows`), disparar comandos Tauri vía `__TAURI_INTERNALS__.invoke`.
- Verificar `localStorage` (`devflow-chat-history`, stores persistidos) y migraciones.

**Qué NO se puede automatizar (requiere manual):**
- Diálogos nativos: `pickFolder` (selector de carpeta), prompt de permiso de **micrófono** (2.7).
- La latencia real del agente (40–60 s con modelos chicos): esperá lo suficiente antes de concluir FAIL.

**Gotchas conocidos del helper CDP:**
- Pasar paths Windows con `\\` por el pipeline CDP **dobla el backslash** (os error 3) → usá
  forward-slashes (`F:/…`) al invocar comandos Tauri desde el helper.
- Tras inyectar `localStorage`, hacé un `reload` duro para que React tome el estado nuevo.
- Los inputs de React necesitan disparar el evento correcto; setear `.value` directo no alcanza.

Ver el método completo y sus gotchas en la nota de verificación CDP del proyecto.
