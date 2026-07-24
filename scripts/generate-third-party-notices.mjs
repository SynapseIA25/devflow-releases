#!/usr/bin/env node
// Genera NOTICE.md a partir de las dependencias de producción reales (npm + cargo).
// npm: lee package-lock.json (lockfileVersion 3), excluye devDependencies (dev:true) y
// resuelve la licencia leyendo node_modules/<pkg>/package.json (mismo criterio que
// `license-checker --production`, sin depender de instalar esa herramienta).
// cargo: usa `cargo metadata`, que ya trae el campo "license" resuelto por paquete —
// no hace falta cargo-license ni red extra.
//
// Uso: node scripts/generate-third-party-notices.mjs   (regenerar NOTICE.md antes de cada release)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function collectNpmPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  const entries = new Map(); // name -> {name, version, license}

  for (const [pkgPath, meta] of Object.entries(lock.packages || {})) {
    if (pkgPath === "" || meta.dev) continue; // raíz o solo-devDependency
    const name = meta.name || pkgPath.replace(/^.*node_modules\//, "");
    const key = `${name}@${meta.version}`;
    if (entries.has(key)) continue;

    let license = meta.license;
    if (!license) {
      try {
        const pkgJsonPath = path.join(ROOT, pkgPath, "package.json");
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        license = pkgJson.license || (Array.isArray(pkgJson.licenses) ? pkgJson.licenses.map((l) => l.type).join(" OR ") : null);
      } catch {
        license = null;
      }
    }
    entries.set(key, { name, version: meta.version, license: license || "UNKNOWN" });
  }
  return [...entries.values()];
}

function collectCargoPackages() {
  const raw = execFileSync(
    "cargo",
    ["metadata", "--manifest-path", path.join(ROOT, "src-tauri", "Cargo.toml"), "--format-version", "1"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 }
  );
  const metadata = JSON.parse(raw);
  const workspaceMembers = new Set(metadata.workspace_members || []);
  return metadata.packages
    .filter((p) => !workspaceMembers.has(p.id)) // excluye el propio crate mimo-agent
    .map((p) => ({ name: p.name, version: p.version, license: p.license || p.license_file || "UNKNOWN" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function groupByLicense(pkgs) {
  const groups = new Map();
  for (const pkg of pkgs) {
    const key = pkg.license;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pkg);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function renderSection(title, pkgs) {
  const lines = [`## ${title} (${pkgs.length} paquetes)`, ""];
  for (const [license, group] of groupByLicense(pkgs)) {
    lines.push(`### ${license}`, "");
    for (const pkg of group.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`- ${pkg.name}@${pkg.version}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const npmPkgs = collectNpmPackages();
const cargoPkgs = collectCargoPackages();

const header = `# Third-Party Notices

DevFlow (este software) usa las siguientes dependencias de código abierto. Se listan a
continuación con su nombre, versión y licencia SPDX. El texto completo de cada licencia
está disponible en el registro/repositorio de cada paquete (npm o crates.io).

Generado automáticamente por \`scripts/generate-third-party-notices.mjs\` a partir de
\`package-lock.json\` (dependencias de producción, sin devDependencies) y \`cargo metadata\`
(\`src-tauri/Cargo.toml\`). Volver a correr ese script antes de cada release para mantenerlo
al día.

---

## Componentes bundleados destacados

### OpenCode (MIT)
DevFlow bundlea el binario de OpenCode como sidecar (ver \`scripts/fetch-opencode-sidecar.mjs\`)
para el motor de código nativo "DevFlow Code". Repositorio: https://github.com/sst/opencode
(licencia MIT).

### mobile-mcp (Apache-2.0)
DevFlow invoca \`@mobilenext/mobile-mcp\` vía \`npx\` en tiempo de ejecución (no vendoreado en el
bundle) para verificación de apps móviles. Repositorio: https://github.com/mobile-next/mobile-mcp
(licencia Apache-2.0).

---

`;

const output = header + renderSection("Dependencias npm", npmPkgs) + "\n" + renderSection("Dependencias cargo (Rust)", cargoPkgs);

fs.writeFileSync(path.join(ROOT, "NOTICE.md"), output);
console.log(`NOTICE.md generado: ${npmPkgs.length} paquetes npm, ${cargoPkgs.length} paquetes cargo.`);

const unknown = [...npmPkgs, ...cargoPkgs].filter((p) => p.license === "UNKNOWN");
if (unknown.length) {
  console.warn(`\nAVISO: ${unknown.length} paquete(s) sin licencia detectada, revisar a mano:`);
  for (const pkg of unknown) console.warn(`  - ${pkg.name}@${pkg.version}`);
}
