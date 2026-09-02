import { jsonValueConverter } from "./json-value";
import { jsonSchemaConverter } from "./json-schema";
import { typescriptConverter } from "./typescript";
import { protoConverter } from "./proto";
import { golangConverter } from "./golang";
import { rustConverter } from "./rust";
import { pythonConverter } from "./python";
import { SchemaConverter } from "./types";

// Registry of symmetric language converters. Each is a thin spoke that converts
// its language to/from the JSON Schema pivot / SchemaField[]. Server-only
// converters (async, heavier deps) implement the same `SchemaConverter`
// contract and slot in unchanged.
export const SCHEMA_CONVERTERS: SchemaConverter[] = [
  jsonValueConverter,
  jsonSchemaConverter,
  typescriptConverter,
  protoConverter,
  golangConverter,
  rustConverter,
  pythonConverter,
];

export function getSchemaConverter(id: string): SchemaConverter | undefined {
  return SCHEMA_CONVERTERS.find((c) => c.id === id);
}
