import { jsonValueConverter } from "./json-value";
import { jsonSchemaConverter } from "./json-schema";
import { typescriptConverter } from "./typescript";
import { SchemaConverter } from "./types";

// Registry of symmetric language converters. Each is a thin spoke that converts
// its language to/from the JSON Schema pivot / SchemaField[]. Future entries:
// "python", "go", "protobuf" — add a file alongside this one and register it
// here. Server-only converters (async, heavier deps) implement the same
// `SchemaConverter` contract and slot in unchanged.
export const SCHEMA_CONVERTERS: SchemaConverter[] = [
  jsonValueConverter,
  jsonSchemaConverter,
  typescriptConverter,
];

export function getSchemaConverter(id: string): SchemaConverter | undefined {
  return SCHEMA_CONVERTERS.find((c) => c.id === id);
}
