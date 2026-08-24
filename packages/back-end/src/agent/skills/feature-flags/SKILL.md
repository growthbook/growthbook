---
name: feature-flags
description: Shared conventions behind the flag-* skills — endpoint versions, v2 create and rule semantics, identifiers and links, page-context mapping, and how to read a 403 on publish or a 409 merge conflict. Load it alongside the flag-* skill you are following; it documents no workflow of its own.
---

# Feature flags

Background for the `flag-*` skills. Use `callApi` for all REST calls. Feature
endpoints are `/api/v2/features`; environments and projects are `/api/v1/`.

The workflow lives in whichever `flag-*` skill matches the request — load that
one directly. Load this alongside it when you need the conventions below.

## Page context

When the user message starts with `[Page context: <path>]`:

- `/features` → browsing; no specific flag.
- `/features/<feature-key>` → that flag (`GET /api/v2/features/<key>`).
- `/environments` → `GET /api/v1/environments`.
- `/projects/<project-id>` → `GET /api/v1/projects/<id>`.

Prefer a named entity in the user's message over page context when they conflict.

## Shared conventions

- **Mutations:** non-GET `callApi` calls are gated automatically. Issue the
  call when ready — do not use `askUser` for mutation confirmation.
- **Identifiers:** show users the feature **key** (`id`), not internal mongo ids.
  Link with `/features/<key>`.
- **v2 create:** `defaultValue` is always a string; set `{enabled: false}` per
  environment explicitly on create unless the user asks otherwise.
- **v2 rules:** top-level `rules` array; scoped via `environments` or
  `allEnvironments`. POSTing `rules` replaces the entire array — GET first
  for partial edits.
- **403 on publish/toggle:** approval required — surface the API message.
- **409 on publish:** merge conflict — do not auto-rebase; show conflict body.
