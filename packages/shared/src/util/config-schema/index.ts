// Portable schema/value import-export core, shared between the front-end editor
// and (eventually) the REST API. JSON Schema is the canonical pivot: language
// converters live in their own files (json-value, json-schema, typescript, …)
// and only convert to/from JSON Schema, so adding a language is one new file +
// a registry entry — never a change to the field model in `fields.ts`.
//
// Durable design decisions:
// - `SchemaField[]` is the internal model; a config root is ALWAYS an
//   object/dict. Composition lives in field *values* — a field can carry a raw
//   `jsonSchema` blob (nested object/array/union), kept verbatim by
//   `normalizeField`. The "flatness" is the editor's row UI, not the schema.
// - Every language is a thin spoke to JSON Schema. Importers are LOSSY-BY-DESIGN:
//   exotic/unresolved/deeply-nested constructs degrade to `any`/object WITH A
//   WARNING, never throw — we don't hand-resolve type graphs.
// - Safe bi-directional sync rests on canonical (not byte) equality
//   (`canonicalField` / `fieldsCanonicallyEqual` / `reconcileSchemaFields`), so a
//   re-import of an unchanged config is a true no-op and drift is detected by
//   meaning. Intended model: schema flows code → GB (push on CI), values flow
//   GB → runtime, conflicts surfaced via diff + CAS (never silently overwritten).
export * from "./types";
export * from "./fields";
export * from "./json-value";
export * from "./json-schema";
export * from "./typescript";
export * from "./proto";
export * from "./golang";
export * from "./go-fields";
export * from "./rust";
export * from "./python";
export * from "./registry";
export * from "./validate";
export * from "./invariants";
