---
name: feature-flags
description: Read and modify feature flags, environments, projects, and flag revisions. Use when the user asks about feature flags, rollouts, toggling, targeting rules, publishing drafts, or page context under /features/*, /environments, or /projects.
---

# Feature flags

Domain router for feature flags. Use `callApi` for all REST calls. Feature
endpoints are `/api/v2/features`; environments and projects are `/api/v1/`.

**Workflow:** read this router → `loadSkill('<leaf>')` for the matching
sub-skill below → follow that leaf's workflow.

## Sub-skills

| Skill                | Use when                                                  |
| -------------------- | --------------------------------------------------------- |
| `flag-create`        | Creating a new feature flag                               |
| `flag-search`        | Finding a flag by description or listing flags            |
| `flag-toggle`        | Enabling/disabling a flag in an environment (kill switch) |
| `flag-targeting`     | Adding/editing force or rollout rules with conditions     |
| `flag-rules`         | Listing, reordering, or routing to rule-type workflows    |
| `flag-experiment`    | Adding experiment-ref or inline experiment rules          |
| `flag-default-value` | Changing the default value when no rules match            |
| `flag-metadata`      | Owner, project, tags, description, custom fields          |
| `flag-schedule`      | Timed rule activation                                     |
| `flag-ramp`          | Progressive rollout schedules                             |
| `flag-prerequisites` | Feature-level prerequisite gates                          |
| `flag-monitoring`    | Monitored / safe rollout rules                            |
| `flag-graph`         | Visualizing flag dependencies                             |
| `flag-revisions`     | Draft revisions without a specific rule change            |
| `flag-publish`       | Publishing a draft (approval / merge-conflict paths)      |
| `flag-review`        | Review and approval workflow                              |
| `flag-cleanup`       | Archive or delete a stale flag                            |

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
