# Back-end Agent Instructions

Apply the repository instructions in the root `AGENTS.md` first.

Before changing back-end code, read the relevant detailed guide:

- API routers, handlers, authentication, and OpenAPI patterns: `../../.agents/guides/backend/api-patterns.md`
- New data models and `MakeModelClass()` usage: `../../.agents/guides/backend/model-patterns.md`
- Legacy model migrations: `../../.agents/guides/backend/legacy-model-migration-patterns.md`
- Permissions and commercial-feature gates: `../../.agents/guides/permissions.md`
- Copy and casing for error, validation, and other messages returned to users or API callers: `../../.agents/guides/ui-copy-style.md`

Place new internal API routers in `src/routers/`, not `src/app.ts`. Use the project's HTTP utility instead of `node-fetch`.
