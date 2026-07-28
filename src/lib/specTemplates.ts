// Plantillas base para arrancar un requirements.md sin escribir la estructura EARS desde cero cada
// vez. Curadas a mano (no auto-detectadas del tipo de proyecto) — a propósito, ver conversación:
// adivinar la plantilla "correcta" es sobre-ingeniería para v1 y falla en silencio cuando adivina
// mal; el usuario elige. "Blank" (id vacío) no escribe nada — mismo comportamiento que hoy.
export type SpecTemplate = {
  id: string;
  name: string;
  description: string;
  requirements: string;
};

export const SPEC_TEMPLATES: SpecTemplate[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Start empty, write requirements.md from scratch or run Specify.",
    requirements: "",
  },
  {
    id: "rest-endpoint",
    name: "REST API endpoint",
    description: "New or changed backend endpoint — request/response, validation, auth.",
    requirements: `# Requirements — <endpoint name>

## Context
<What triggers this endpoint being needed — a new capability, a missing case in an existing one?>

## Requirements
- WHEN a client sends a valid request to <method> <path>, THE SYSTEM SHALL <expected response/behavior>.
- IF the request body/params fail validation, THE SYSTEM SHALL respond with a 4xx error describing what's invalid.
- IF the caller is not authorized, THE SYSTEM SHALL respond with 401/403 and no side effects.
- WHILE the underlying operation is in progress, THE SYSTEM SHALL <describe any partial-state handling, e.g. idempotency>.
- IF a dependency (DB/external service) fails, THE SYSTEM SHALL <error handling — retry? 5xx? rollback?>.

## Out of scope
- <what this endpoint explicitly does NOT do>
`,
  },
  {
    id: "ui-component",
    name: "UI component",
    description: "New or changed frontend component — props, states, interaction.",
    requirements: `# Requirements — <component name>

## Context
<Where does this live, and what problem does it solve for the user?>

## Requirements
- WHEN the component mounts with <props/data>, THE SYSTEM SHALL render <expected initial state>.
- WHEN the user <interaction, e.g. clicks/types>, THE SYSTEM SHALL <expected response>.
- IF the data is loading, THE SYSTEM SHALL show a loading state instead of an empty/broken one.
- IF the data is empty or the request errors, THE SYSTEM SHALL show a clear empty/error state.
- WHILE the viewport is narrow (mobile/small window), THE SYSTEM SHALL remain usable (responsive).

## Out of scope
- <what this component explicitly does NOT handle>
`,
  },
  {
    id: "bug-fix",
    name: "Bug fix",
    description: "Reproduce, root-cause, fix, and prevent a regression.",
    requirements: `# Requirements — fix: <short bug description>

## Context
<How was this found — steps to reproduce, when it started happening>

## Requirements
- WHEN <the exact steps that trigger the bug> THE SYSTEM SHALL <correct expected behavior> (currently: <what actually happens>).
- IF the same underlying condition happens in <related code path, if any>, THE SYSTEM SHALL behave correctly there too.
- THE SYSTEM SHALL have a regression test/case covering this scenario going forward.

## Out of scope
- <related-but-different bugs not being fixed here, so scope doesn't creep>
`,
  },
  {
    id: "data-migration",
    name: "Data migration / schema change",
    description: "Schema or stored-data change — backward compatibility, rollback.",
    requirements: `# Requirements — <migration name>

## Context
<Why is the current schema/data shape insufficient?>

## Requirements
- WHEN the migration runs against existing data, THE SYSTEM SHALL <transform/backfill behavior>, leaving no record in an invalid state.
- IF the migration is interrupted partway, THE SYSTEM SHALL <safe-to-resume/rerun behavior>.
- WHILE the migration has not yet run, THE SYSTEM SHALL continue serving reads/writes against the old shape without breaking.
- THE SYSTEM SHALL support rolling back this change if it's found to be wrong after deploy.

## Out of scope
- <data/tables explicitly not touched by this migration>
`,
  },
];

// Catálogo curado de patrones de arquitectura/diseño conocidos — se inyecta en el prompt de la fase
// Plan (specOrchestrator.buildPlanPrompt) para que el agente elija y justifique uno en vez de
// inventar la estructura desde cero cada vez. A propósito NO es un selector aparte en la UI (ver
// conversación): el agente propone, grounded en el código real vía RAG: el usuario lo revisa/ajusta
// en el panel editable de design.md, mismo checkpoint humano que ya existe.
export type DesignPattern = { id: string; name: string; hint: string };

export const DESIGN_PATTERNS: DesignPattern[] = [
  { id: "layered", name: "Layered (routes/controllers → services → data access)", hint: "clear separation by responsibility, most common default" },
  { id: "hexagonal", name: "Hexagonal / Ports & Adapters", hint: "core logic isolated from I/O (DB, HTTP, CLI) behind interfaces" },
  { id: "event-driven", name: "Event-driven / Pub-Sub", hint: "components react to events instead of calling each other directly" },
  { id: "cqrs", name: "CQRS (separate read/write paths)", hint: "reads and writes have different models/paths — usually only worth it under real read/write asymmetry" },
  { id: "repository", name: "Repository pattern", hint: "data access behind an interface, swappable/testable without a real DB" },
  { id: "pipeline", name: "Pipeline / middleware chain", hint: "a request/item passes through an ordered chain of steps" },
  { id: "state-machine", name: "State machine", hint: "behavior modeled as explicit states + transitions instead of scattered booleans/flags" },
];
