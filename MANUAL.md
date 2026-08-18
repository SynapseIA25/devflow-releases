# DevFlow — user manual

A short, practical guide to get productive in a few minutes. For installers, see the
[README](README.md).

## What is DevFlow?

DevFlow is a desktop app for building software by talking to AI agents instead of writing every
line by hand. You describe what you want in plain language; the agent reads and edits your
project's real files, runs terminal commands, and shows you what it did, step by step.

Around that chat you get:

- A **code editor** with hover/autocomplete/go-to-definition (real language servers, not a toy).
- Integrated **terminals** — no need to leave the app.
- A **project hub** to keep several projects organized.
- A **team of specialized expert agents** (architecture, frontend, backend, database, DevOps,
  security, QA, product) that can be routed to automatically based on what you ask.
- **Spec-driven development** (the Specs view): turn an idea into a six-step pipeline —
  Enrich → Specify → Plan → Tasks → Implement → Review — instead of one giant freeform prompt,
  with a human checkpoint at every step and a project memory that carries context from one
  finished feature into the next.
- **Skills**: reusable, shareable playbooks the agent can learn and reuse across projects.
- **Isolated environments**: agents can work in an ephemeral git worktree — a full copy of your
  project — so nothing touches your real code until you review and promote the diff.

## Quickstart

1. **Open a project** — pick an existing folder or create a new one from the project selector.
2. **Go to Chat** and describe what you want, e.g. *"create a simple page that shows Hello
   World"*.
3. **Watch it work** — the agent streams its reasoning, the files it touches and the commands it
   runs, live.
4. **Review the result** in the editor, or run your project from the **Run** view.
5. **Iterate** in the same chat: *"make the background blue"*.

You don't need to know how to code to get started. AI agents are sometimes slow and sometimes
wrong — you can always ask them to fix it, the same way you'd correct a junior teammate.

## Which AI models can I use?

**You don't need any API key to start.** DevFlow ships with **DevFlow Code**, a built-in
multi-model coding agent that includes free models out of the box (via OpenCode Zen) — nothing
to configure, nothing to pay for.

From there you have three ways to get more power, all optional:

| Option | Cost | Setup |
|---|---|---|
| **DevFlow Code, free models** | Free | None — works immediately |
| **Local models** (Ollama, LM Studio, or any OpenAI-compatible server) | Free, runs on your machine | Point Settings at your local server's URL; DevFlow auto-detects the models it serves |
| **Cloud API keys** (OpenRouter, Google Gemini, Groq, Mistral, Anthropic/Claude Code) | Pay-as-you-go, billed by the provider | Paste a key in Settings → API keys |

Adding a cloud API key doesn't replace the free tier — it just unlocks more/better models in the
same model selector, and (for Anthropic) enables the separate **Claude Code** agent.

### Connecting a local model (Ollama / LM Studio / anything else)

DevFlow doesn't hardcode support per tool. It uses the same generic mechanism OpenCode documents:
any server that speaks the OpenAI-compatible API (which includes `GET /models`) can be plugged
in by URL — Ollama and LM Studio are just presets for the two most common local runtimes.
In Settings, pick a preset (or enter a custom base URL), and DevFlow discovers the models that
server exposes automatically.

### Adding a specific cloud model

Beyond the built-in provider list, Settings also includes a model search against the public
[models.dev](https://models.dev) catalog — search by name and add any listed model without
hand-editing configuration files.

## Main areas of the app

- **Chat** — talk to an agent, attach files/folders as context, pick which agent and model to
  use. For a real feature (not a small tweak), chat proposes a Given/When/Then scenario and a
  diagram before writing code — send it to **Specs** with one click to execute it with review at
  every step.
- **Build** — the code editor, **Specs** (spec-driven development, see below), a codebase map, a
  visual workflow builder, and a task planner.
- **Run** — terminals, long-running services (`npm run dev` and friends), isolated **environments**
  (git worktrees) for agents to experiment in, and a test runner.
- **Agents** — your team of agents (built-in + 9 area experts) and their configuration, plus
  reusable skills and MCP tool servers.
- **Review** — pull requests and issues for your project's repo, without leaving the app.
- **Project hub** (click your project's name) — overview, file structure, and a **Documentation**
  tab with a real markdown editor (live preview, create new files) for writing and keeping your
  project's docs.
- **Settings** — API keys, local model connections, a default model per agent, permissions, and
  app preferences.

### Spec-driven development, in short

Specs turns a request into a written contract instead of a one-shot prompt, in six phases — each
one writes a real file you can read and edit before the next phase runs:

1. **Enrich** — restates the ask and only asks clarifying questions when something is genuinely
   ambiguous.
2. **Specify** — requirements in EARS syntax (`WHEN ... THE SYSTEM SHALL ...`).
3. **Plan** — architecture and technical decisions.
4. **Tasks** — an executable checklist, one commit-sized task at a time.
5. **Implement** — the agent executes each task; a task that crosses several areas is split
   across your expert agents automatically.
6. **Review** — checks the generated code against the spec's own acceptance criteria, plus a
   security pass.

**Run all** chains whatever's left in one click. Once a spec is done, **Archive** locks it and
folds what it learned into your project's persistent memory, so the next spec you write already
has that context. **Create PR** opens a pull request straight from a finished spec.

## FAQ

**Do I need to pay for anything?**
No. DevFlow Code's built-in free models are enough to use every feature. Paid API keys are for
users who want a specific higher-end model or the separate Claude Code agent.

**Is my code sent anywhere I don't control?**
Requests go directly from your machine to whichever model provider you've selected (or stay
fully local if you're using Ollama/LM Studio). DevFlow itself doesn't run its own inference or
proxy your prompts through a third-party server.

**The agent asks for permission before running a command / editing a file — why?**
By default DevFlow asks before an agent takes an action with side effects (running a shell
command, writing a file). You can review and approve each one, or enable auto-approve in Settings
if you trust the agent to work unattended.

**Something looks broken or an update failed — where do I report it?**
Open an issue on this repository.
