# Custom Hooks on an Entity

The contract every entity's validation hooks follow, so adding hooks to a new
entity is a checklist and not a design discussion. Feature Flags are the model.
SDK Connections (`validateSdkConnection`, `validateSdkConnectionRevision`) are
the reference implementation on the generic revision engine.

Configs predate this contract and differ: `validateConfigRevision` runs only at
publish and receives revision details without the proposed content, and
`validateConfig` runs on draft saves made in the app. Do not copy that split.

## The Contract

1. **Two hook types for an entity that has revisions**, as Feature Flags have:
   `validate<Entity>` and `validate<Entity>Revision`. An entity without
   revisions has only the first.
2. **`validate<Entity>` runs when the entity itself is written:** on create,
   on every direct write, and on publish. A write to a child record that is
   part of the entity's revision snapshot (an SDK Connection's webhooks) is a
   write to the entity. It receives the entity as the change leaves it, one
   argument per part of its snapshot, and no revision.
3. **`validate<Entity>Revision` runs whenever a revision's content is
   written:** each save into a draft, a rebase, and a direct write, which lands
   a revision that is already published. It runs again when a draft is
   published. Anything that writes a revision runs it. It receives the live
   entity, in the same arguments as the first hook, plus `revision`: what the
   revision proposes, in the same shape as the live arguments, and its details
   from `revisionHookArg` (version, status, title, comment, author,
   contributors, reviews).
4. **Incremental Changes Only** needs the state before the write as `original`:
   the entity before the change for the first hook; the revision before this
   save for the second, which is live's state for a new draft and at publish.
5. **No secrets reach a hook.** A hook's error or log is shown to people who
   may not be allowed to see them. Leave out keys and signing secrets, and never
   pass a whole revision document: its snapshot carries the entity. Webhook
   headers are passed as written: a secret is referenced there, never expanded.
6. **Which hooks apply:** hooks scoped to the entity, Project hooks naming any
   of the entity's Projects, and global hooks. A change that moves the entity
   answers to the Projects it leaves and the ones it enters. An entity in all
   Projects is checked by global hooks only.
7. **Outcomes:** a thrown error blocks the change. On a REST publish it is a
   `custom-hook` gate in the 422, cleared by `skipHooks` from a caller with
   bypass-approval authority for that entity in every Project
   (`context.canSkipHooksFor`). Every other path throws `CustomHookError` and
   honors the same flag. `addWarning` is cleared by `ignoreWarnings` from
   anyone. A deferred publish has no caller to ask, so it ignores warnings and
   stops on errors.
8. **Run once per change.** A handler that collected hook results as gates
   publishes with `skipHooks: true`, so the engine does not run them again.
9. **Who manages them:** an entity-scoped hook takes `manageCustomHooks`. A
   Feature Flag's takes Edit access to that flag instead.
10. **UI:** the shared `CustomHooksSection` on the entity page's Validation
    tab, with no per-entity layout. Settings → Custom Hooks lists entity-scoped
    hooks and links to that tab.

## Adding Hooks to an Entity

- `shared/src/validators/custom-hooks.ts`: add both types to `hooks` and
  `hookEntityType`, and the entity to `customHookEntityTypes` and
  `customHookEntityNoun`.
- `back-end/src/enterprise/sandbox/sandbox-eval.ts`: the argument builder, a
  `run…Hooks` / `collect…HookResults` pair for each type, and the entity's
  family in the `canSkip` check.
- `back-end/src/services/context.ts`: add the family to `SkipFamily`.
- `back-end/src/models/CustomHookModel.ts`: check the scoped entity exists.
- Write paths: call the first hook on create and on each direct write. For
  the revision hook, implement `validateRevisionWrite` on the entity's revision
  adapter and nothing per handler: `createOrUpdateRevision`, `rebaseRevision`
  and `landDirectChange` call it, so every draft save, rebase and direct
  landing is covered. A write that creates a revision outside those three must
  call it itself. Call both hooks from the adapter's `assertPublishable`, and
  in the REST publish handler collect both into gates with `hookResultsToGates`
  and resolve them with `resolveEntityPublishGates`.
- Front-end: `CustomHookModal` (`hookTypes`, `EXAMPLE_DOC_SECTIONS`, a prop
  that scopes it to the entity), the entity page's Validation tab, the Settings
  page section, and `docSections`.
- `docs/features/custom-hooks.mdx`: a section for each hook type.
- Tests: one end-to-end case per write path, asserting which hook ran and what
  it was given: both hooks on a direct write, the proposed content on a draft
  save and on a rebase, both hooks at publish, and no secret anywhere.
