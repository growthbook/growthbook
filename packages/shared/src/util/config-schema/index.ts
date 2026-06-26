// Portable schema/value import-export core, shared between the front-end editor
// and (eventually) the REST API. JSON Schema is the canonical pivot: language
// converters live in their own files (json-value, json-schema, typescript, …)
// and only convert to/from JSON Schema, so adding a language is one new file +
// a registry entry — never a change to the field model in `fields.ts`.
//
// ===========================================================================
// DESIGN INTENT & ROADMAP  (living notes — keep here, not in a separate doc)
// ===========================================================================
//
// Why this shape (the durable decisions):
//
// - JSON Schema is the canonical pivot; `SchemaField[]` is the internal model.
//   A config root is ALWAYS an object/dict (keyed fields) — that matches how
//   real configs look. Composition lives in field *values*: a field can carry
//   an arbitrary raw `jsonSchema` blob (nested object/array/union), kept
//   verbatim by `normalizeField` (only bare presets collapse). The "flatness"
//   is purely the editor's row UI, not the schema — bounded nesting is fully
//   representable.
//
// - Every language is a thin spoke to JSON Schema. Importers are intentionally
//   LOSSY-BY-DESIGN: exotic / unresolved / deeply-nested constructs degrade to
//   the `any` preset (or object) WITH A WARNING — they never throw. We do not
//   hand-resolve type graphs; that brittleness isn't worth owning.
//
// - The keystone for safe bi-directional sync is canonical equality, not byte
//   equality: `canonicalField` / `fieldsCanonicallyEqual` / `reconcileSchemaFields`.
//   A re-import of an unchanged config is a TRUE no-op (no draft churn) even if
//   the source text differs cosmetically, and drift is detected by *meaning*.
//   Invest here first — it's REST-agnostic and underpins everything below.
//
// Intended operating model (the "why" behind future work):
//
// - Enterprises bulk-import in-code configs spanning many microservices/langs
//   into GB for safety + validation, then keep them from drifting via frequent
//   bi-di sync. An LLM (via REST) is the *universal multi-language importer*:
//   it converts arbitrary TS/Python/Go/proto → JSON Schema, GB validates /
//   normalizes / diffs. So GB's job is to be a deterministic, idempotent sync
//   target — NOT to maintain N language parsers.
// - Source-of-truth split: SCHEMA flows code → GB (push on deploy/CI); VALUES
//   flow GB → runtime (GB's whole point). Conflicts surface via diff + CAS;
//   they are never silently overwritten.
//
// Hardening opportunities / roadmap (rough, unordered — REST deferred until the
// config model settles; do the cheap, contract-level ones opportunistically):
//
//   1. [DONE] Uniform converter contract. `jsonSchemaStringToFields`,
//      `tsTypesToFields`, and `SchemaConverter.toFields` all return the same
//      `SchemaConversionResult` = `{ fields, error, warnings }` (see types.ts).
//   2. [DONE] Structured warnings: `{ code, path?, message }` (SchemaWarning),
//      so the LLM/CI loop can act on them programmatically and self-correct.
//   3. [DONE] Symmetric `SchemaConverter` interface (toFields + fromFields),
//      MaybePromise/async-capable, registry-driven (`SCHEMA_CONVERTERS`), so a
//      server-only converter (e.g. the `typescript` compiler — pure JS, Node,
//      no binary) can slot in for non-LLM clients without changing callers.
//   4. [DONE] TS importer honesty: warns (via `dropped-declaration` /
//      `non-object-root` / `unresolved-type`) on sibling declarations it had to
//      drop, non-object roots (e.g. `type X = A | B`), and refs collapsed to
//      `any`. Full ref resolution stays out of scope for the lightweight parser
//      (LLM or server compiler handles it).
//   5. JSON Schema `$ref`/`$defs`: currently stored verbatim per field. Either
//      deref on import or warn that refs won't resolve in a single field blob.
//   6. Recursion / self-reference (a tree config) is a genuine STRUCTURAL
//      mismatch with the flat-field model, not just a parser gap. Detect and
//      warn rather than silently mangle.
//   7. Canonical schema fingerprint (hash of the canonical form) to power drift
//      detection and no-op short-circuiting in sync/verify.
//   8. Deferred REST sync surface, built on the reconcile primitives above:
//      bulk upsert (canonical no-op when unchanged), dry-run/diff (would-change
//      set without applying), verify (drift check, non-2xx on drift — CI-droppable),
//      export (JSON Schema canonical + optional rendered TS), with CAS +
//      idempotency keys for frequent/retried syncs.
//
// ===========================================================================
export * from "./types";
export * from "./fields";
export * from "./json-value";
export * from "./json-schema";
export * from "./typescript";
export * from "./registry";
