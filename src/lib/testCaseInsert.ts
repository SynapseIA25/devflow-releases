// Fase 7 de la herramienta de testing nativa (Test Strategy Advisor — ver memoria
// devflow-testing-tool-design). Genera e inserta un caso de test nuevo para un patrón sugerido,
// siguiendo el estilo de los tests YA existentes del proyecto en vez de inventar convenciones — mismo
// espíritu "reducir grados de libertad + validar + reintentar una vez + error duro" que
// verifyScript.ts usa para el codegen del nodo verify:
// - Patrones simples (smoke/cli-smoke) son 100% determinísticos: cero turno de agente, el cuerpo
//   queda con un TODO explícito.
// - Patrones con lógica real delegan a UN turno de agente que llena SOLO el cuerpo de la función —
//   el nombre/imports/archivo destino ya están resueltos aparte, así el agente no puede romper la
//   declaración que lo envuelve (el "known failure mode" acá: que redeclare esa envoltura).
// - Antes de escribir: validación estructural (llaves balanceadas, sin duplicar nombre de test) +
//   chequeo real donde es barato y confiable (Python: `py_compile`, archivo-scoped, sin ruido de
//   falsos positivos). TS/JS NO tiene chequeo real en v1 a propósito: correr `tsc` sobre un archivo
//   aislado sin el tsconfig/contexto del proyecto da falsos positivos masivos (path aliases, JSX,
//   tipos de terceros) — las validaciones estructurales son las que corren para ese caso.
// - Sin API de borrado de archivo en tauriApi.ts: en vez de escribir a un temp y borrarlo, cuando el
//   chequeo real falla se REVIERTE escribiendo el contenido original de vuelta (siempre lo tenemos en
//   memoria) — nunca se deja un archivo roto. Para un archivo NUEVO (sin original al que revertir) se
//   omite el chequeo en vivo, confiando solo en las validaciones estructurales.
import { readDir, readTextFile, writeTextFile, createDir, runShellCommand } from "./tauriApi";
import { runAgentTurn } from "./teamDelegate";
import { useAgentsStore } from "../store/agentsStore";
import type { StackFingerprint } from "./stackDetect";
import type { TestCasePattern } from "./testStrategyCatalog";

const MAX_ENTRIES_VISITED = 500;
const MAX_REFERENCE_CHARS = 4000;
const AGENT_TIMEOUT_MS = 90_000;
// Patrones que quedan 100% determinísticos (cuerpo = TODO explícito, cero turno de agente) — el
// camino más seguro y barato, análogo a un checklist manual. El resto pasa por el agente.
const DETERMINISTIC_PATTERN_IDS = new Set(["smoke", "cli-smoke"]);

export type ReferenceFile = { path: string; content: string };
export type InsertCaseResult = { filePath: string; inserted: boolean; warning?: string };
type TargetFile = { path: string; existingContent: string | null };
type Attempt = { ok: true } | { ok: false; reason: string };

// ── 1. Archivos de referencia ──────────────────────────────────────────────
// BFS acotado (mismo patrón que collectFiles de codebaseMap.ts) — read_dir de Rust ya excluye
// node_modules/.git/target/dist/etc, acá solo hace falta un tope de entradas visitadas para no pagar
// el costo de un repo gigante.
function testFileMatcher(fp: StackFingerprint): (name: string) => boolean {
  switch (fp.language) {
    case "python": return (n) => /^test_.*\.py$/i.test(n) || /_test\.py$/i.test(n);
    case "go": return (n) => /_test\.go$/i.test(n);
    case "rust": return (n) => /\.rs$/i.test(n);
    case "java": return (n) => /(Test|Tests)\.java$/.test(n);
    case "dart": return (n) => /_test\.dart$/i.test(n);
    case "csharp": return (n) => /(Test|Tests)\.cs$/.test(n);
    default: return (n) => /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/i.test(n);
  }
}

export async function findReferenceTestFiles(
  projectPath: string,
  fingerprint: StackFingerprint,
  max = 2
): Promise<ReferenceFile[]> {
  const matches = testFileMatcher(fingerprint);
  const foundPaths: string[] = [];
  const queue: string[] = [projectPath];
  let visited = 0;
  while (queue.length > 0 && foundPaths.length < max && visited < MAX_ENTRIES_VISITED) {
    const dir = queue.shift()!;
    let entries;
    try { entries = await readDir(dir); } catch { continue; }
    for (const e of entries) {
      visited++;
      if (e.isDir) queue.push(e.path);
      else if (matches(e.name)) foundPaths.push(e.path);
      if (foundPaths.length >= max || visited >= MAX_ENTRIES_VISITED) break;
    }
  }
  const refs: ReferenceFile[] = [];
  for (const path of foundPaths) {
    const raw = await readTextFile(path).catch(() => null);
    if (raw != null) refs.push({ path, content: raw.slice(0, MAX_REFERENCE_CHARS) });
  }
  return refs;
}

// Resuelve los imports RELATIVOS del archivo de referencia (probablemente el módulo bajo test) y lee
// su contenido real. Hallazgo real de la verificación de esta fase: sin esto, el agente solo ve el
// archivo de TEST como referencia de estilo — puede escribir una aserción sintácticamente válida pero
// semánticamente incorrecta sobre el comportamiento real (ej. asumir que una función valida rangos
// numéricos cuando en realidad no lo hace), porque nunca vio la implementación de verdad.
async function resolveImportedSourceFiles(ref: ReferenceFile, max = 2): Promise<ReferenceFile[]> {
  const dir = ref.path.includes("/") ? ref.path.slice(0, ref.path.lastIndexOf("/")) : "";
  const importRe = /from\s+["'](\.[^"']+)["']/g;
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(ref.content)) && specs.length < max) specs.push(m[1]);

  const results: ReferenceFile[] = [];
  for (const spec of specs) {
    const base = resolveRelativeSpec(dir, spec);
    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"]) {
      const raw = await readTextFile(`${base}${ext}`).catch(() => null);
      if (raw != null) {
        results.push({ path: `${base}${ext}`, content: raw.slice(0, MAX_REFERENCE_CHARS) });
        break;
      }
    }
    if (results.length >= max) break;
  }
  return results;
}

function resolveRelativeSpec(dir: string, spec: string): string {
  const parts = dir.split("/");
  for (const part of spec.split("/")) {
    if (part === "." || part === "") continue;
    else if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function defaultNewFileName(fp: StackFingerprint, hint: string): string {
  const base = slug(hint);
  switch (fp.language) {
    case "python": return `test_${base}.py`;
    case "go": return `${base}_test.go`;
    case "rust": return `tests/${base}.rs`;
    case "java": return `${pascalCase(base)}Test.java`;
    case "csharp": return `${pascalCase(base)}Tests.cs`;
    case "dart": return `test/${base}_test.dart`;
    default: return `${base}.test.ts`;
  }
}

async function resolveTargetFile(
  projectPath: string,
  fingerprint: StackFingerprint,
  references: ReferenceFile[],
  targetHint: string
): Promise<TargetFile> {
  if (references.length > 0) {
    const chosenPath = references[0].path;
    const full = await readTextFile(chosenPath).catch(() => null);
    return { path: chosenPath, existingContent: full ?? references[0].content };
  }
  return { path: `${projectPath}/${defaultNewFileName(fingerprint, targetHint)}`, existingContent: null };
}

// ── 2. Nombre único del caso ────────────────────────────────────────────────
function containsName(content: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`]${escaped}["'\`]`).test(content);
}

function uniqueTestName(pattern: TestCasePattern, targetHint: string, existingContent: string | null): string {
  const base = targetHint.trim() ? `${pattern.label}: ${targetHint.trim()}` : pattern.label;
  if (!existingContent) return base;
  let candidate = base;
  let i = 2;
  while (containsName(existingContent, candidate)) candidate = `${base} (${i++})`;
  return candidate;
}

// ── 3. Cuerpo del caso: determinístico o agente (un solo hueco a llenar) ────
function deterministicBody(fp: StackFingerprint, pattern: TestCasePattern): string {
  const todo = `TODO: fill in the real assertion for "${pattern.label}" — ${pattern.description}`;
  switch (fp.language) {
    case "python": return `    # ${todo}\n    assert True`;
    case "go": return `\t// ${todo}\n\tt.Skip("not implemented yet")`;
    case "rust": return `    // ${todo}`;
    case "java": return `        // ${todo}\n        org.junit.Assert.assertTrue(true);`;
    case "csharp": return `        // ${todo}\n        Assert.True(true);`;
    case "dart": return `      // ${todo}\n      expect(true, isTrue);`;
    default: return `    // ${todo}\n    expect(true).toBe(true);`;
  }
}

function extractCodeFence(text: string): string | null {
  const match = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (!match) return null;
  const code = match[1].trim();
  return code || null;
}

// Known failure mode acá (análogo al `require("ws")` de verifyScript.ts): el modelo redeclara la
// función/it/describe contenedora en vez de escribir solo lo que va DENTRO.
function declaresWrapper(code: string): boolean {
  return (
    /\b(it|test)\(\s*["'`]/.test(code) ||
    /\bdescribe\(\s*["'`]/.test(code) ||
    /^\s*def\s+test_/m.test(code) ||
    /^\s*func\s+Test/m.test(code) ||
    /^\s*#\[test\]/m.test(code) ||
    /^\s*@Test\b/m.test(code) ||
    /^\s*\[Fact\]/m.test(code)
  );
}

function buildBodyPrompt(
  pattern: TestCasePattern,
  fp: StackFingerprint,
  targetHint: string,
  references: ReferenceFile[],
  sourceFiles: ReferenceFile[],
  previousViolation?: string
): string {
  const refBlock =
    references.length > 0
      ? references.map((r) => `### ${r.path}\n\`\`\`\n${r.content}\n\`\`\``).join("\n\n")
      : "(the project has no existing tests yet — no style-reference file available)";
  const sourceBlock =
    sourceFiles.length > 0
      ? sourceFiles.map((r) => `### ${r.path}\n\`\`\`\n${r.content}\n\`\`\``).join("\n\n")
      : null;
  const lines = [
    `I need the BODY of a test case, nothing more — the line that declares it (` +
      `"it(...)"/"def test_...():"/"func Test...(t *testing.T) {"/"@Test public void ...()"/etc.) is` +
      ` already resolved separately, you do NOT write it, only what goes INSIDE.`,
    ``,
    `Pattern to implement: "${pattern.label}" — ${pattern.description}`,
    `What to test specifically: ${targetHint || "(no extra detail, use your own QA judgment)"}`,
    `Stack: ${fp.language}${fp.uiFramework ? ` / ${fp.uiFramework}` : ""}`,
    ``,
    `Existing test file(s) from the project, as a style reference (imports, helpers, how assertions`,
    `are built here):`,
    refBlock,
  ];
  if (sourceBlock) {
    lines.push(
      ``,
      `REAL source code of what's being tested (read it before writing an assertion — do NOT assume`,
      `behavior that isn't here; if the real behavior differs from what it "should" do, test what the`,
      `code ACTUALLY does):`,
      sourceBlock
    );
  }
  lines.push(
    ``,
    `Respond ONLY with a fenced code block containing the test BODY — no declaring line, no`,
    `wrapping describe/class, no text before or after the fence.`
  );
  if (previousViolation) {
    lines.push(``, `Your previous attempt failed exactly because of this: ${previousViolation}`, `Fix it and respond again under the same rules.`);
  }
  return lines.join("\n");
}

async function agentFilledBody(
  projectPath: string,
  pattern: TestCasePattern,
  fingerprint: StackFingerprint,
  targetHint: string,
  references: ReferenceFile[],
  previousViolation: string | undefined
): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const agent = useAgentsStore.getState().agents.find((a) => a.id === "expert-qa");
  if (!agent) return { ok: false, reason: 'Could not find the "expert-qa" agent.' };
  const sourceFiles = references.length > 0 ? await resolveImportedSourceFiles(references[0]) : [];
  const prompt = buildBodyPrompt(pattern, fingerprint, targetHint, references, sourceFiles, previousViolation);
  const response = await runAgentTurn(agent, prompt, projectPath, AGENT_TIMEOUT_MS);
  const code = extractCodeFence(response);
  if (!code) return { ok: false, reason: "the agent didn't return a recognizable fenced code block" };
  if (declaresWrapper(code)) {
    return { ok: false, reason: "the agent redeclared the containing function/it/describe instead of writing only the body" };
  }
  return { ok: true, code };
}

// ── 4. Composición del contenido nuevo (por lenguaje) ───────────────────────
// Bloques delimitados por llaves (Java/C#/Dart, y JS sin describe que matchee el hint) se insertan
// ANTES del último "}" del archivo — asume la convención habitual de una sola clase/un solo
// void main() por archivo de test. Lenguajes de funciones top-level (Python/Go/Rust sin `mod tests`)
// simplemente appendean al final.
function findDescribeRange(content: string, hint: string): { insertAt: number; indent: string } | null {
  const hintLower = hint.trim().toLowerCase();
  if (!hintLower) return null;
  const re = /describe\(\s*(["'`])((?:\\.|(?!\1).)*)\1[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const title = m[2].toLowerCase();
    if (!title.includes(hintLower) && !hintLower.includes(title)) continue;
    const braceStart = m.index + m[0].length - 1;
    let depth = 1;
    let i = braceStart + 1;
    for (; i < content.length && depth > 0; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
    }
    if (depth !== 0) continue;
    const closeIdx = i - 1;
    const lineStart = content.lastIndexOf("\n", closeIdx) + 1;
    const indent = content.slice(lineStart, closeIdx).match(/^\s*/)?.[0] ?? "";
    return { insertAt: closeIdx, indent };
  }
  return null;
}

function findModTestsRange(content: string): { insertAt: number; indent: string } | null {
  const m = /mod\s+tests\s*\{/.exec(content);
  if (!m) return null;
  const braceStart = m.index + m[0].length - 1;
  let depth = 1;
  let i = braceStart + 1;
  for (; i < content.length && depth > 0; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") depth--;
  }
  if (depth !== 0) return null;
  const closeIdx = i - 1;
  const lineStart = content.lastIndexOf("\n", closeIdx) + 1;
  const indent = content.slice(lineStart, closeIdx).match(/^\s*/)?.[0] ?? "";
  return { insertAt: closeIdx, indent };
}

function insertBeforeLastBrace(content: string, block: string): string {
  const lastBrace = content.lastIndexOf("}");
  if (lastBrace === -1) return `${content.trimEnd()}\n\n${block}`;
  return `${content.slice(0, lastBrace)}\n${block}\n${content.slice(lastBrace)}`;
}

function composeJs(target: TargetFile, testName: string, targetHint: string, body: string): string {
  const block = `it(${JSON.stringify(testName)}, () => {\n${body}\n  });`;
  if (target.existingContent == null) {
    return `import { describe, it, expect } from "vitest";\n\ndescribe(${JSON.stringify(testName)}, () => {\n  ${block}\n});\n`;
  }
  const range = findDescribeRange(target.existingContent, targetHint);
  if (range) {
    const before = target.existingContent.slice(0, range.insertAt);
    const after = target.existingContent.slice(range.insertAt);
    return `${before}\n${range.indent}  ${block}\n${range.indent}${after}`;
  }
  return `${target.existingContent.trimEnd()}\n\ndescribe(${JSON.stringify(testName)}, () => {\n  ${block}\n});\n`;
}

function composePython(target: TargetFile, testName: string, body: string): string {
  const fnName = `test_${slug(testName).replace(/-/g, "_")}`;
  const fn = `def ${fnName}():\n${body}\n`;
  return target.existingContent == null ? fn : `${target.existingContent.trimEnd()}\n\n\n${fn}`;
}

function composeGo(target: TargetFile, testName: string, body: string): string {
  const fn = `\nfunc Test${pascalCase(testName)}(t *testing.T) {\n${body}\n}\n`;
  if (target.existingContent == null) {
    // Sin archivo de referencia no hay forma confiable de saber el nombre real del package — placeholder
    // que probablemente necesite ajuste manual, documentado a propósito (no hay heurística mejor sin
    // un archivo .go real del proyecto para copiarle el `package` real).
    return `package main\n\nimport "testing"\n${fn}`;
  }
  return `${target.existingContent.trimEnd()}\n${fn}`;
}

function composeRust(target: TargetFile, testName: string, body: string): string {
  const fn = `#[test]\nfn test_${slug(testName).replace(/-/g, "_")}() {\n${body}\n}\n`;
  if (target.existingContent == null) return fn;
  const modRange = findModTestsRange(target.existingContent);
  if (modRange) {
    const before = target.existingContent.slice(0, modRange.insertAt);
    const after = target.existingContent.slice(modRange.insertAt);
    return `${before}\n${modRange.indent}    ${fn.replace(/\n/g, `\n${modRange.indent}    `).trimEnd()}\n${modRange.indent}${after}`;
  }
  return `${target.existingContent.trimEnd()}\n\n${fn}`;
}

function composeBraceClass(target: TargetFile, testName: string, body: string, lang: "java" | "csharp"): string {
  const methodName = `test${pascalCase(testName)}`;
  const annotation = lang === "java" ? "@Test" : "[Fact]";
  const method = `    ${annotation}\n    public void ${methodName}() {\n${body}\n    }\n`;
  if (target.existingContent == null) {
    const className = `${pascalCase(testName)}Tests`;
    return lang === "java"
      ? `import org.junit.Test;\n\npublic class ${className} {\n${method}}\n`
      : `using Xunit;\n\npublic class ${className} {\n${method}}\n`;
  }
  return insertBeforeLastBrace(target.existingContent, method);
}

function composeDart(target: TargetFile, testName: string, body: string): string {
  const block = `  test(${JSON.stringify(testName)}, () {\n${body}\n  });`;
  if (target.existingContent == null) {
    return `import 'package:flutter_test/flutter_test.dart';\n\nvoid main() {\n${block}\n}\n`;
  }
  return insertBeforeLastBrace(target.existingContent, block);
}

function composeContent(fp: StackFingerprint, target: TargetFile, testName: string, targetHint: string, body: string): string {
  switch (fp.language) {
    case "python": return composePython(target, testName, body);
    case "go": return composeGo(target, testName, body);
    case "rust": return composeRust(target, testName, body);
    case "java": return composeBraceClass(target, testName, body, "java");
    case "csharp": return composeBraceClass(target, testName, body, "csharp");
    case "dart": return composeDart(target, testName, body);
    default: return composeJs(target, testName, targetHint, body);
  }
}

function bracesBalanced(code: string): boolean {
  let depth = 0;
  for (const ch of code) {
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

// ── 5. Chequeo real (solo donde es barato/confiable) + commit / revert ─────
const REAL_CHECKERS: Partial<Record<string, (path: string) => string>> = {
  python: (path) => `python -m py_compile "${path}"`,
};

async function commitContent(fp: StackFingerprint, target: TargetFile, content: string, projectPath: string): Promise<Attempt> {
  if (target.existingContent == null) {
    const dir = target.path.includes("/") ? target.path.slice(0, target.path.lastIndexOf("/")) : projectPath;
    await createDir(dir);
    await writeTextFile(target.path, content);
    return { ok: true };
  }
  await writeTextFile(target.path, content);
  const checker = REAL_CHECKERS[fp.language];
  if (!checker) return { ok: true };
  const res = await runShellCommand(checker(target.path), projectPath);
  if (res.exitCode === 0) return { ok: true };
  await writeTextFile(target.path, target.existingContent); // revertir — nunca dejar un archivo roto
  return { ok: false, reason: `the real syntax check failed (the file was reverted): ${res.output.slice(0, 400)}` };
}

// ── 6. Orquestador ───────────────────────────────────────────────────────────
async function tryOnce(
  projectPath: string,
  pattern: TestCasePattern,
  fingerprint: StackFingerprint,
  targetHint: string,
  references: ReferenceFile[],
  target: TargetFile,
  testName: string,
  isDeterministic: boolean,
  previousViolation?: string
): Promise<Attempt> {
  const bodyResult = isDeterministic
    ? ({ ok: true, code: deterministicBody(fingerprint, pattern) } as const)
    : await agentFilledBody(projectPath, pattern, fingerprint, targetHint, references, previousViolation);
  if (!bodyResult.ok) return bodyResult;

  const composed = composeContent(fingerprint, target, testName, targetHint, bodyResult.code);
  if (!bracesBalanced(composed)) return { ok: false, reason: "the generated code has unbalanced braces" };

  return commitContent(fingerprint, target, composed, projectPath);
}

export async function generateAndInsertCase(
  projectPath: string,
  pattern: TestCasePattern,
  fingerprint: StackFingerprint,
  targetHint: string
): Promise<InsertCaseResult> {
  const references = await findReferenceTestFiles(projectPath, fingerprint, 2);
  const target = await resolveTargetFile(projectPath, fingerprint, references, targetHint);
  const testName = uniqueTestName(pattern, targetHint, target.existingContent);
  const isDeterministic = DETERMINISTIC_PATTERN_IDS.has(pattern.id);

  let result = await tryOnce(projectPath, pattern, fingerprint, targetHint, references, target, testName, isDeterministic);
  // Un solo reintento — solo tiene sentido si hubo un turno de agente de por medio (nada que
  // reintentar contra un cuerpo determinístico que ya está fijo).
  if (!result.ok && !isDeterministic) {
    result = await tryOnce(projectPath, pattern, fingerprint, targetHint, references, target, testName, false, result.reason);
  }
  if (!result.ok) return { filePath: target.path, inserted: false, warning: result.reason };
  return { filePath: target.path, inserted: true };
}

// ── Helpers de texto ─────────────────────────────────────────────────────────
function slug(s: string): string {
  const base = s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "case";
}

function pascalCase(s: string): string {
  const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join("") || "Case";
}
