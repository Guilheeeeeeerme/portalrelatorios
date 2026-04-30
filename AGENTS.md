# Agent Instructions

These rules apply to Codex, Claude, Cursor, Copilot, Gemini, Windsurf, and other coding agents working in this repository.

## Project Scope

This repo is scoped to the empreendimento data pipeline only:

- `npm run dump:empreendimento-data`
- `npm run format:empreendimento-data`
- `npm run full:empreendimento-data`

Do not reintroduce the removed Fastify API server, Playwright capture flow, or standalone empreendimento-list dumper unless the user explicitly asks for that broader tooling.

## Runtime

- Node.js project using CommonJS.
- Keep dependencies minimal. The current runtime dependency is `dotenv`.
- Prefer Node built-ins for filesystem, HTTPS, path, and JSON work.
- Keep generated data under `data/`.

## Required Inputs

- `data/empreendimentos.json`
- `data/empreendimento-query-templates.json`
- `.env` based on `.env.example`

Never commit real Power BI tokens or other secrets.

## Editing Rules

- Preserve existing generated JSON unless the task specifically requires regenerating it.
- Avoid broad rewrites of `data/empreendimento-data/**` or `data/empreendimento-data-formatted/**`.
- Keep script behavior deterministic except for `generatedAt`, request ids, and live Power BI responses.
- Use structured JSON parsing and serialization. Do not manipulate JSON with ad hoc string replacement except for the existing deep placeholder replacement in request payloads.
- Keep comments sparse and only where they clarify non-obvious behavior.

## Verification

For code or documentation changes, run the narrowest useful checks:

```bash
node --check scripts/dump-dashboard-data.js
node --check scripts/format-dashboard-data.js
npm run format:empreendimento-data
```

Only run `npm run dump:empreendimento-data` or `npm run full:empreendimento-data` when live Power BI access and a valid `PBI_TOKEN` are available.

## Git Hygiene

- The worktree may already contain user changes. Do not revert unrelated edits.
- Do not delete or regenerate large data files unless requested.
- Keep documentation files consistent: update `AGENTS.md` first, and keep tool-specific files as pointers to it unless a tool needs special syntax.
