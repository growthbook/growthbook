# Plan: PR A — `isProduction` flag on environments

Date: 2026-11-05 (revised after code review the same day). The first PR, branched off `main` and merged on its own before any QA override work. Worktree: `gb-worktrees/environment_production_flag` (branch `ty/environment_production_flag`, at `main` b7616629bc).

## Why it's separate

This PR adds a general "is this a production environment?" field, works out a value for existing environments, and lets users set it in the UI. It doesn't reference QA overrides at all. The QA branch starts reading the field after this merges, and drops its own `qaOverridesEnabled` when it does. Other features can use the field later, such as approval defaults and human-in-the-loop flows.

## Behavior

- New optional field on each environment: `isProduction?: boolean`.
- **Treated as production by default.** If the field is missing, the value is guessed when the org is read. An environment is non-production only if its whole ID, ignoring case, is exactly `dev`, `staging` or `test`, the non-production default names. `Dev`, `DEV` and `dev` are all treated the same. There's no prefix or regex matching, so `dev2`, `john_dev`, `dev-prod`, `preprod` and so on all count as production. The list is final for this PR; no other names get added.
- **When the value gets stored:**
  - Environments created through the environment endpoints (modal, setup page, importers, REST) store it at creation. If the caller doesn't send it, the server fills in the guess.
  - Everything else without a value (existing environments, and environment lists replaced wholesale by a config import) gets the guess at read time, in memory only. It's written to the database the next time any code saves the environment list (edit, create, reorder, delete, bulk update, org settings). After that, the saved value is used. This is the same just-in-time pattern as `restApiBypassesReviews` and `stickyBucketingOnByDefault` in `upgradeOrganizationDoc`.
- Users can change it in the Environments section with a switch that's always shown, on create and on edit.

## Changes

### 1. Shared (`packages/shared`)

**`src/validators/environment.ts`**

- `environment`: add `isProduction: z.boolean().optional()`. The create and bulk-update validators pick this up automatically.
- `updateEnvValidator.environment`: add `isProduction: z.boolean().optional()`. Without it, the strict schema rejects the field on edit.
- REST: add `isProduction: z.boolean()` to `apiEnvironmentValidator`. Responses always include it, since the guess fills it in. Also add `isProduction: z.boolean().describe("Whether this is a production environment").optional()` to `postEnvironmentBody` and `putEnvironmentBody`. (GET returns it, so the strict PUT body must accept it for fetch → edit → send-back.)

**`src/util/environments.ts`** (next to the existing `isEnvironmentDevLike`, which stays as it is)

```ts
export const NON_PRODUCTION_ENVIRONMENT_IDS = ["dev", "staging", "test"];

export function guessIsProductionEnvironment(envId: string): boolean {
  return !NON_PRODUCTION_ENVIRONMENT_IDS.includes(envId.toLowerCase());
}

// Read-side helper: saved value first, otherwise the guess.
export function isProductionEnvironment(env: {
  id: string;
  isProduction?: boolean;
}): boolean {
  return env.isProduction ?? guessIsProductionEnvironment(env.id);
}
```

Export both from `src/util/index.ts` next to `isEnvironmentDevLike`.

Don't reuse `isEnvironmentDevLike()`. Its prefix regex marks `dev-prod`, `test-production`, `preprod` and `preview` as dev-like, which isn't safe for anything that gates production. (It's currently not called anywhere outside its own definition and export.)

### 2. Back-end (`packages/back-end`)

**`src/util/migrations.ts` → `upgradeOrganizationDoc`**, right after `org.settings.environments = getEnvironments(org)`:

```ts
if (org.settings.environments.some((e) => e.isProduction === undefined)) {
  org.settings.environments = org.settings.environments.map((e) =>
    e.isProduction === undefined
      ? { ...e, isProduction: guessIsProductionEnvironment(e.id) }
      : e,
  );
}
```

- `map` builds new objects on purpose. The function shares nested values with `doc` (see its header comment), and `migrations.test.ts` deep-freezes the input.
- `getEnvironments` can return the doc's own array, so never mutate that array in place.
- Every org the app works with comes through `toInterface` → `upgradeOrganizationDoc`, so the internal `/organization` response, `context.org` and the REST handlers all see the filled-in value.

**Internal API: `src/routers/environment/environment.controller.ts`**

- `putEnvironment`: **merge** the stored environment with the edit instead of replacing it:
  ```ts
  const updatedEnv = { ...envsArr[existingEnvIndex], ...environment, id };
  updatedEnvs[existingEnvIndex] = updatedEnv;
  ```
  Fields the request leaves out (`isProduction`, `parent`) are kept. The modal (the only caller) always sends `description`, `toggleOnList`, `defaultState`, `projects` and `isProduction`, so those still overwrite as before. This matches the REST PUT, and it fixes an existing bug where editing an environment in the UI dropped its `parent` (`updateEnvValidator` has no `parent`).
  - Use `updatedEnv` for the audit log's "after" value (otherwise unsent fields look removed in the diff) and for the response body.
- `postEnvironment`: before adding, fill the guess when the caller didn't send a value:
  `const env = { ...environment, isProduction: environment.isProduction ?? guessIsProductionEnvironment(environment.id) };`
  Use `env` for the update, audit and response. This covers the setup page and the LaunchDarkly, Statsig and Eppo importers, which don't send the field.
- `putEnvironments` (bulk `PUT /environment`): apply the same fill to each environment before the `reduce`. Existing environments are skipped by `addEnvironmentToOrganizationEnvironments` (`shouldReplace = false`), so this only affects new ones. No front-end code calls this route today; it's for completeness.

**REST API: `src/api/environments/`**

- `validations.ts` → `validatePayload`: accept `isProduction?: boolean` and return `isProduction: isProduction ?? guessIsProductionEnvironment(id)`, **as the last key** (after `parent`) in the returned object so audit JSON strings only gain a key at the end.
- `putEnvironment.ts` already merges `{ ...environment, ...req.body }` before validating, so an existing value survives a PUT that leaves it out. No change needed.
- `listEnvironments.ts`: add `isProduction: isProductionEnvironment(env)` to the mapped response (switch the destructured callback to take `env`). The fallback matters: the existing REST tests use unmigrated mock orgs.
- Run `pnpm generate-openapi` and commit **everything it changes**. It writes `back-end/generated/spec.yaml`, and `generate-openapi-docs` also rewrites files under the repo-root `docs/` (`docs/openapi.yaml`, `docs/api/...`). CI fails if `git status` isn't clean afterwards.

### 3. Front-end (`packages/front-end`)

**`components/Settings/EnvironmentModal.tsx`**

- Control: `Switch` from `@/ui/Switch` (controlled: `value` / `onChange`), matching the modal's existing "Default state for new features" and "Show on feature list page" switches. `label` "This is a production environment", `description` "Production environments get extra safeguards, for example QA overrides aren't allowed."
- **Always shown**, on create and on edit. No default-vs-custom branch.
- Create: in the ID `SelectField` `onChange`, set `isProduction` to `guessIsProductionEnvironment(value)`. So `production` and custom IDs start on; `dev`, `staging`, `test` (any case, e.g. typed `Dev`) start off. The user can flip it before saving.
- Form default: `existing` is `Partial<Environment>`, so `id` can be missing (create). Use
  `isProduction: existing.id ? isProductionEnvironment({ ...existing, id: existing.id }) : true`.
  On edit, a saved value wins and a missing one falls back to the same guess the badge uses (not `?? true`, which would open `dev` with the switch on). On create it starts on until an ID is picked.
- Send `isProduction` in both the POST `newEnv` and the PUT body.

**`pages/environments.tsx`**

- Add a "Production" column after "Environment". Show `<Badge label="Production" />` (from `@/ui/Badge`) when `isProductionEnvironment(e)` is true, and nothing otherwise.
- Use the `@/ui` wrappers only; nothing from Bootstrap.

### 4. Tests

New tests are utilities only, per repo policy, but existing tests that break must be updated.

- **Shared util tests** (new file, e.g. `packages/shared/test/environments.test.ts`):
  - `guessIsProductionEnvironment` treats `dev`, `Dev`, `DEV`, `staging` and `test` as non-production.
  - It treats `production`, `prod`, `dev2`, `john_dev`, `dev-prod`, `preprod`, `qa` and `development` as production.
  - `isProductionEnvironment` prefers the saved value over the guess (e.g. saved `true` on `dev` stays `true`).
- **`back-end/test/migrations.test.ts`:**
  - Update "Upgrades old Organization objects": expected default environments now include `isProduction` (dev → false, production → true).
  - Add a case where a saved `isProduction: false` on an environment called `production` is left unchanged.
  - Add a case where a custom environment with no value gets `true`.
  - Add a case confirming the frozen input isn't mutated (the existing `upgradeFrozen` helper covers this).
- **Update existing `back-end/test/api/environments.test.ts`:** it does exact `toEqual` checks on the REST list, create and update responses, the `updateOrganization` arguments, and the audit JSON strings. All of these gain `isProduction` (the mock orgs aren't migrated, so `env2` with no value lists as `true`).
- Checked and unaffected: `organizationConfigImport.test.ts` and other tests that build orgs by hand (they mock the model, so `upgradeOrganizationDoc` doesn't run), and `test/util/environments.util.test.ts` (that util doesn't change).
- No new tests for the controller, model or components.

### 5. Checks before opening the PR

`pnpm --filter shared test`, `pnpm --filter back-end test test/migrations.test.ts test/api/environments.test.ts`, `pnpm type-check`, `pnpm lint`, `pnpm pretty:check`, and `pnpm generate-openapi` with a clean `git status` afterwards.

Manual:

- A new org has only `production` (that's what `createOrganization` stores); it shows the Production badge.
- Adding `dev` from the dropdown: switch starts off; after saving, no badge.
- Adding a custom environment: switch starts on. Typing `Dev` as a custom name: switch starts off.
- Editing an environment and flipping the switch persists after a reload.
- Editing an environment that has a `parent` keeps its `parent`.
- A REST `GET /api/v1/environments` returns `isProduction`.

## Things to know

- **Guesses get saved over time.** Once any write saves the environment list, the guessed values are stored. If the name list ever changes, already-saved environments keep their old value. That's acceptable because the list errs toward production.
- **Org-level and REST writes.** Any code path that saves `org.settings.environments` from the migrated org saves the guess too. That's intended.
- **Config files.** Self-hosted orgs that define environments in `config.json` get the read-time guess for those environments too; `isProduction` can be set there like any other environment field.
- **Who can change it:** editing an environment requires `manageEnvironments`, and changes are audit-logged.
- **Out of scope:** anything that reads the flag (QA overrides, approvals), any change to `isEnvironmentDevLike`, adding more names to the non-production list, and backfill scripts.

## Suggested PR description

> Adds an optional `isProduction` flag to environments. Existing environments get a conservative value when read: only `dev`, `staging`, and `test` (case-insensitive) are treated as non-production; everything else defaults to production. New environments store the value at creation. Users can change it in Settings → Environments with a "This is a production environment" switch. Exposed on the REST API. No behavior reads the flag yet — QA overrides will be the first consumer.
>
> Also: editing an environment in the UI now merges with the stored environment instead of replacing it, which fixes `parent` being dropped on edit.
