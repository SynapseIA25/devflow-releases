#!/usr/bin/env node
// Descarga el binario nativo de OpenCode para un target triple de Rust y lo deja en
// src-tauri/binaries/opencode-<triple>[.exe], listo para el externalBin (sidecar) de Tauri.
// Nunca se commitea (166MB, excede el límite de 100MB de GitHub) — se corre acá (dev local) y en
// CI antes de `tauri build`. Misma técnica que usa opencode-ai/postinstall.mjs: instala el paquete
// de plataforma en un tmpdir (--no-save, --ignore-scripts) y copia el binario de adentro.
//
// Uso: node scripts/fetch-opencode-sidecar.mjs <rust-target-triple>
//   ej: node scripts/fetch-opencode-sidecar.mjs x86_64-pc-windows-msvc

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pin manual — bumpear junto con la entrada de OpenCode en src/lib/providers.ts.
const OPENCODE_VERSION = "1.18.3";

// Solo los 4 triples que la matriz de CI de devflow-releases realmente buildea. Se usan las
// variantes "-baseline" para x64 (máxima compatibilidad de CPU); arm64 no tiene variante baseline.
const TRIPLE_TO_PACKAGE = {
  "x86_64-pc-windows-msvc": "opencode-windows-x64-baseline",
  "x86_64-apple-darwin": "opencode-darwin-x64-baseline",
  "aarch64-apple-darwin": "opencode-darwin-arm64",
  "x86_64-unknown-linux-gnu": "opencode-linux-x64-baseline",
};

function main() {
  const triple = process.argv[2];
  if (!triple) {
    console.error("Uso: node scripts/fetch-opencode-sidecar.mjs <rust-target-triple>");
    process.exit(1);
  }
  const pkg = TRIPLE_TO_PACKAGE[triple];
  if (!pkg) {
    console.error(`Triple no soportado: ${triple}. Soportados: ${Object.keys(TRIPLE_TO_PACKAGE).join(", ")}`);
    process.exit(1);
  }

  const isWindows = triple.includes("windows");
  const sourceBinaryName = isWindows ? "opencode.exe" : "opencode";
  const destDir = path.join(__dirname, "..", "src-tauri", "binaries");
  const destName = `opencode-${triple}${isWindows ? ".exe" : ""}`;
  const destPath = path.join(destDir, destName);

  fs.mkdirSync(destDir, { recursive: true });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-sidecar-"));
  try {
    console.log(`Descargando ${pkg}@${OPENCODE_VERSION}...`);
    // --force: el paquete de plataforma casi siempre difiere del host real (ej. CI cross-compila
    // x86_64-apple-darwin en un runner macos-latest que hoy es hardware arm64) — el check EBADPLATFORM
    // de npm rechazaría la instalación aunque el binario en sí no necesita "correr" acá, solo copiarse.
    // shell:true en Windows es necesario para invocar el shim .cmd de npm (spawnSync no lo resuelve
    // directo); los args son todos internos (mapa fijo + constante de versión), sin input externo.
    const result = spawnSync(
      "npm",
      ["install", "--force", "--ignore-scripts", "--no-save", "--loglevel=error", "--prefix", tmp, `${pkg}@${OPENCODE_VERSION}`],
      { stdio: "inherit", shell: process.platform === "win32" }
    );
    if (result.error) {
      throw new Error(`No se pudo spawnear npm: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`npm install falló (exit ${result.status})`);
    }

    const sourcePath = path.join(tmp, "node_modules", pkg, "bin", sourceBinaryName);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Binario no encontrado en ${sourcePath}`);
    }
    fs.copyFileSync(sourcePath, destPath);
    fs.chmodSync(destPath, 0o755);
    console.log(`OK: ${destPath} (${(fs.statSync(destPath).size / 1e6).toFixed(1)} MB)`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
