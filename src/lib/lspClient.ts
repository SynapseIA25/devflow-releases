// Cliente LSP real (typescript-language-server, rust-analyzer) para el editor de código. Habla
// con los procesos hijo spawneados por Rust (lsp_start/lsp_send, ver lsp.rs) vía @codemirror/
// lsp-client — mismo espíritu que opencodeClient.ts (cache de conexión por clave), pero acá la
// clave es (lenguaje, raíz de proyecto) porque puede haber varios servers vivos a la vez.
import {
  LSPClient,
  LSPPlugin,
  Workspace,
  languageServerExtensions,
  type Transport,
  type WorkspaceFile,
} from "@codemirror/lsp-client";
import type { ChangeSet, Extension, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lspStart, lspSend, isTauri, rustAnalyzerPath } from "./tauriApi";
import { lspInfoForPath, type LspKind } from "./editorLang";
import { useEditorStore } from "../store/editorStore";

// ── file:// URIs ────────────────────────────────────────────────────────────────────────────

// "F:\mimo-agent\src\lib.rs" -> "file:///F:/mimo-agent/src/lib.rs" (convención estándar, la misma
// que usa VS Code/vscode-uri: la letra de unidad de Windows NO queda percent-encoded).
function pathToUri(path: string): string {
  let p = path.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  const encoded = p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/")
    .replace(/^(\/[A-Za-z])%3A/, "$1:");
  return "file://" + encoded;
}

function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  let p = decodeURIComponent(uri.slice("file://".length));
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1); // "/F:/..." -> "F:/..."
  return p;
}

// ── Transport (Content-Length framing + puente de eventos de Tauri) ───────────────────────────

function frame(json: string): string {
  const byteLength = new TextEncoder().encode(json).length;
  return `Content-Length: ${byteLength}\r\n\r\n${json}`;
}

function createTransport(id: string): Transport {
  const handlers = new Set<(value: string) => void>();
  void (async () => {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<string>(`lsp-message:${id}`, (event) => {
      handlers.forEach((h) => h(event.payload));
    });
  })();
  return {
    send(message: string) {
      void lspSend(id, frame(message));
    },
    subscribe(handler) {
      handlers.add(handler);
    },
    unsubscribe(handler) {
      handlers.delete(handler);
    },
  };
}

// ── Workspace propio ────────────────────────────────────────────────────────────────────────
// La librería llama openFile/closeFile SOLA cuando la vista de un editor se monta/destruye — y
// como EditorView.tsx fuerza un remount completo de CodeEditor en cada cambio de pestaña
// (key={path}), eso pasaría en CADA cambio de tab, no solo al cerrar de verdad un archivo. Por
// eso: los archivos quedan en `files` mientras la pestaña siga abierta en el editor (persistente
// entre remounts), closeFile solo desregistra la vista (bookkeeping), y el único `didClose` real
// lo dispara `forceClose` desde editorStore.closeTab.

type DevflowFile = WorkspaceFile & { views: Set<EditorView> };

// `WorkspaceFileUpdate` (el tipo que espera `syncFiles`) no queda re-exportado por el paquete
// (solo la interfaz `WorkspaceFile` sí) — se declara acá con la misma forma estructural, TS lo
// acepta igual al overridear el método abstracto por tipado estructural.
type FileUpdate = { file: WorkspaceFile; prevDoc: Text; changes: ChangeSet };

const SYNC_DEBOUNCE_MS = 300;

class DevflowWorkspace extends Workspace {
  files: DevflowFile[] = [];
  private pendingDisplay = new Map<string, Array<(view: EditorView | null) => void>>();
  private lastSyncAt = new Map<string, number>();

  openFile(uri: string, languageId: string, view: EditorView): void {
    let file = this.files.find((f) => f.uri === uri);
    if (!file) {
      file = {
        uri,
        languageId,
        version: 0,
        doc: view.state.doc,
        views: new Set(),
        getView(main?: EditorView) {
          if (main && this.views.has(main)) return main;
          return this.views.values().next().value ?? null;
        },
      };
      this.files.push(file);
      this.client.didOpen(file);
    }
    file.views.add(view);

    const waiters = this.pendingDisplay.get(uri);
    if (waiters) {
      waiters.forEach((resolve) => resolve(view));
      this.pendingDisplay.delete(uri);
    }
  }

  closeFile(uri: string, view: EditorView): void {
    this.files.find((f) => f.uri === uri)?.views.delete(view);
  }

  // Cierre real (usuario cerró la pestaña, no un simple cambio de tab) — llamado por
  // editorStore.closeTab, no forma parte de la API abstracta de Workspace.
  forceClose(uri: string): void {
    const idx = this.files.findIndex((f) => f.uri === uri);
    if (idx === -1) return;
    this.files.splice(idx, 1);
    this.lastSyncAt.delete(uri);
    this.client.didClose(uri);
  }

  syncFiles(): readonly FileUpdate[] {
    const updates: FileUpdate[] = [];
    const now = Date.now();
    for (const file of this.files) {
      const view = file.getView();
      if (!view) continue;
      const plugin = LSPPlugin.get(view);
      if (!plugin) continue;
      const changes = plugin.unsyncedChanges;
      if (changes.empty) continue;
      const last = this.lastSyncAt.get(file.uri) ?? 0;
      // Debounce: si estamos dentro de la ventana, dejamos los cambios sin limpiar en el plugin
      // (se acumulan) y los mandamos en la próxima llamada — no se pierde nada, solo se retrasa.
      if (now - last < SYNC_DEBOUNCE_MS) continue;
      const prevDoc = file.doc;
      file.doc = view.state.doc;
      file.version++;
      plugin.clear();
      this.lastSyncAt.set(file.uri, now);
      updates.push({ file, prevDoc, changes });
    }
    return updates;
  }

  // Soporte para jumpToDefinition/findReferences cruzando archivos: abre (o activa) la pestaña
  // correspondiente en editorStore y espera a que su CodeEditor monte (lo que dispara openFile
  // con la vista real) antes de devolverla.
  async displayFile(uri: string): Promise<EditorView | null> {
    const path = uriToPath(uri);
    if (!path) return null;

    const existing = this.files.find((f) => f.uri === uri)?.getView() ?? null;
    if (existing) {
      useEditorStore.getState().setActive(path);
      return existing;
    }

    const wait = new Promise<EditorView | null>((resolve) => {
      const list = this.pendingDisplay.get(uri) ?? [];
      list.push(resolve);
      this.pendingDisplay.set(uri, list);
      setTimeout(() => resolve(null), 3000);
    });
    await useEditorStore.getState().openFile(path);
    return wait;
  }
}

// ── Conexión por (lenguaje, raíz de proyecto) ──────────────────────────────────────────────────

const clients = new Map<string, Promise<LSPClient | null>>();

async function spawnServer(kind: LspKind, root: string, id: string): Promise<boolean> {
  if (kind === "ts") {
    await lspStart(id, "typescript-language-server", ["--stdio"], root);
    return true;
  }
  const bin = await rustAnalyzerPath();
  if (!bin) return false;
  await lspStart(id, bin, [], root);
  return true;
}

function ensureClient(kind: LspKind, root: string): Promise<LSPClient | null> {
  const key = `${kind}:${root}`;
  let p = clients.get(key);
  if (p) return p;
  p = (async () => {
    if (!isTauri()) return null;
    const started = await spawnServer(kind, root, key).catch(() => false);
    if (!started) return null;
    const transport = createTransport(key);
    const client = new LSPClient({
      rootUri: pathToUri(root),
      workspace: (c) => new DevflowWorkspace(c),
      extensions: languageServerExtensions(),
    });
    client.connect(transport);
    return client;
  })();
  clients.set(key, p);
  return p;
}

// Arranque perezoso: se llama al abrir cualquier archivo (editorStore.load), sin esperar a que
// CodeEditor la monte — así el server ya está levantando cuando el usuario llega a tipear.
export function warmServerFor(path: string, root: string): void {
  const info = lspInfoForPath(path);
  if (!info || !root) return;
  void ensureClient(info.kind, root);
}

// Extensión de CodeMirror para un archivo dado, o null si el lenguaje no tiene LSP mapeado (el
// caller debe reconfigurar su Compartment a `ext ?? []`, dejando el editor igual que hoy).
export async function pluginFor(path: string, root: string): Promise<Extension | null> {
  const info = lspInfoForPath(path);
  if (!info || !root) return null;
  const client = await ensureClient(info.kind, root);
  if (!client) return null;
  return client.plugin(pathToUri(path), info.languageId);
}

// Cierre real de un documento (botón × de la pestaña) — dispara textDocument/didClose de verdad,
// a diferencia de simplemente cambiar de pestaña.
export async function closeDocument(path: string, root: string): Promise<void> {
  const info = lspInfoForPath(path);
  if (!info || !root) return;
  const key = `${info.kind}:${root}`;
  const client = await clients.get(key);
  if (!client) return;
  (client.workspace as DevflowWorkspace).forceClose(pathToUri(path));
}
