import { SchemaField, SimpleSchema } from "shared/types/feature";

// Structured warning codes. Importers are lossy-by-design (see index.ts): exotic
// constructs degrade rather than throw. Codes let an LLM / CI sync loop react
// programmatically (e.g. re-emit a dropped declaration as its own config) rather
// than parsing free text.
export type SchemaWarningCode =
  // Top-level declaration(s) beyond the one imported were ignored.
  | "dropped-declaration"
  // Root was not an object/dict type (e.g. `type X = A | B`).
  | "non-object-root"
  // A named/union/exotic type couldn't be resolved and collapsed to `any`.
  | "unresolved-type"
  // A member couldn't be understood and was skipped (index sigs, junk).
  | "unsupported-member";

export type SchemaWarning = {
  code: SchemaWarningCode;
  message: string;
  // Field key / source location the warning relates to, when known.
  path?: string;
};

// The uniform result every converter's `toFields` returns. `error` is a hard
// failure (nothing usable parsed); `warnings` are non-fatal degradations the
// caller can act on. This is the single contract — `jsonSchemaStringToFields`,
// `tsTypesToFields`, and `SchemaConverter.toFields` all return this shape.
export type SchemaConversionResult = {
  fields: SchemaField[];
  error: string | null;
  warnings: SchemaWarning[];
};

export type FromFieldsOptions = {
  // SimpleSchema container type (defaults to "object").
  type?: SimpleSchema["type"];
  // Whether the emitted schema allows extra properties ("Allow extra fields").
  additionalProperties?: boolean;
  // Root interface/type name, for languages that name their types.
  name?: string;
};

export type MaybePromise<T> = T | Promise<T>;

// A pluggable, symmetric language converter. `toFields` imports a language's
// text into a config's own `SchemaField[]` (via the JSON Schema pivot);
// `fromFields` exports fields back to that language (omitted for input-only
// converters like value inference). Both are MaybePromise so a heavier
// server-side converter (e.g. one backed by the `typescript` compiler) can be
// async and slot into the registry without changing callers.
export type SchemaConverter = {
  id: string;
  label: string;
  toFields: (input: string) => MaybePromise<SchemaConversionResult>;
  fromFields?: (
    fields: SchemaField[],
    opts?: FromFieldsOptions,
  ) => MaybePromise<string>;
};
