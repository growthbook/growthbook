import {
  CrudAction,
  indexOperations,
  LocatedOperation,
  requestSchema,
  responseSchema,
  SchemaNode,
  schemaNode,
  schemaProperties,
  Spec,
} from "./spec";

export type FieldType =
  | { kind: "string" | "bool" | "int64" | "float64" | "json" }
  | { kind: "list"; element: FieldType }
  | { kind: "object"; fields: Field[] };

export type Field = {
  json: string;
  attribute: string;
  type: FieldType;
  description?: string;
  required: boolean;
  optional: boolean;
  computed: boolean;
  replace: boolean;
  sensitive: boolean;
  inCreate: boolean;
  inUpdate: boolean;
  inModel: boolean;
};

export type ModelOperation = {
  method: string;
  path: string;
  responseKey: string;
  paginated: boolean;
};

export type ResourceModel = {
  name: string;
  idAttribute: string;
  operations: Partial<Record<CrudAction, ModelOperation>>;
  fields: Field[];
  problems: string[];
};

// Changes on every write, so tracking it would show a diff after each apply.
const volatileFields = ["dateUpdated"];

export function attributeName(field: string): string {
  return field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

// Mirrors jsonName in the provider's convert.go.
export function jsonName(attribute: string): string {
  return attribute.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function nonNullBranches(spec: Spec, node: SchemaNode): unknown[] | null {
  const branches = node.anyOf ?? node.oneOf;
  if (!branches) return null;
  return branches.filter((branch) => schemaNode(spec, branch).type !== "null");
}

function fieldType(spec: Spec, value: unknown, optional: boolean): FieldType {
  const node = schemaNode(spec, value);
  const branches = nonNullBranches(spec, node);
  if (branches) {
    return branches.length === 1
      ? fieldType(spec, branches[0], optional)
      : { kind: "json" };
  }
  const type = Array.isArray(node.type)
    ? node.type.find((t) => t !== "null")
    : node.type;
  switch (type) {
    case "string":
      return { kind: "string" };
    case "boolean":
      return { kind: "bool" };
    case "integer":
      return { kind: "int64" };
    case "number":
      return { kind: "float64" };
    case "array": {
      const element = fieldType(spec, node.items, optional);
      return element.kind === "json" || element.kind === "list"
        ? { kind: "json" }
        : { kind: "list", element };
    }
    case "object":
      if (!node.properties) return { kind: "json" };
      return {
        kind: "object",
        fields: Object.entries(node.properties).map(([json, child]) =>
          nestedField(spec, json, child, optional),
        ),
      };
  }
  return { kind: "json" };
}

// Nested settings are all optional with server defaults.
function nestedField(
  spec: Spec,
  json: string,
  value: unknown,
  optional: boolean,
): Field {
  const node = schemaNode(spec, value);
  return {
    json,
    attribute: attributeName(json),
    type: fieldType(spec, value, optional),
    description: node.description,
    required: false,
    optional,
    computed: true,
    replace: false,
    sensitive: !!node["x-growthbook-sensitive"],
    inCreate: optional,
    inUpdate: optional,
    inModel: true,
  };
}

// Extra keys like `bypassedGates` are fine when one is named for the resource.
function wrappedKey(
  spec: Spec,
  operation: LocatedOperation,
  resourceKey: string,
  isList: boolean,
): string | null {
  const envelope = schemaProperties(spec, responseSchema(operation.operation));
  const keys = Object.keys(envelope ?? {}).filter(
    (key) => !isList || schemaNode(spec, envelope?.[key]).type === "array",
  );
  if (!isList && keys.includes(resourceKey)) return resourceKey;
  return keys.length === 1 ? keys[0] : null;
}

export function analyzeResource(spec: Spec, name: string): ResourceModel {
  const index = indexOperations(spec);
  const ids = spec["x-growthbook-resources"][name].operations;
  const located: Partial<Record<CrudAction, LocatedOperation>> = {};
  for (const [action, operationId] of Object.entries(ids)) {
    const operation = operationId && index.get(operationId);
    if (operation) located[action as CrudAction] = operation;
  }
  const { create, get, list, update, delete: del } = located;

  const problems: string[] = [];
  if (!create) problems.push("no create");
  if (!del) problems.push("no delete");
  if (!get && !list) problems.push("no read");

  const operations: ResourceModel["operations"] = {};
  // The engine only reads the list when there's no single-item GET.
  if (get) delete located.list;
  for (const [action, operation] of Object.entries(located)) {
    const responseKey =
      action === "delete"
        ? ""
        : wrappedKey(spec, operation, jsonName(name), action === "list");
    if (responseKey === null) {
      problems.push(`${action} response is not one wrapped model`);
      continue;
    }
    operations[action as CrudAction] = {
      method: operation.method.toUpperCase(),
      path: operation.path,
      responseKey,
      paginated: !!operation.operation.parameters?.some(
        (p) => p.name === "limit" || p.$ref?.endsWith("/limit"),
      ),
    };
  }

  const itemPath = (get ?? update ?? del)?.path ?? "";
  const idAttribute = attributeName(itemPath.match(/\{(\w+)\}$/)?.[1] ?? "id");

  const readOperation = get ?? create;
  const readKey = operations[get ? "get" : "create"]?.responseKey;
  const envelope =
    readOperation &&
    schemaProperties(spec, responseSchema(readOperation.operation));
  const model =
    (readKey && envelope && schemaProperties(spec, envelope[readKey])) || {};
  const createNode =
    create && schemaNode(spec, requestSchema(create.operation));
  const createBody =
    (create && schemaProperties(spec, requestSchema(create.operation))) || {};
  const updateBody =
    (update && schemaProperties(spec, requestSchema(update.operation))) || {};
  const requiredOnCreate = new Set(createNode?.required ?? []);

  const names = [
    ...new Set([
      ...Object.keys(model),
      ...Object.keys(createBody),
      ...Object.keys(updateBody),
    ]),
  ].filter((json) => !volatileFields.includes(json));

  const fields = names.map((json): Field => {
    const inModel = json in model;
    const inCreate = json in createBody;
    const inUpdate = json in updateBody;
    const source = inModel
      ? model[json]
      : inCreate
        ? createBody[json]
        : updateBody[json];
    const node = schemaNode(spec, source);
    const input = inCreate || inUpdate;
    const required = inCreate && requiredOnCreate.has(json);
    return {
      json,
      attribute: attributeName(json),
      type: fieldType(spec, source, input && !required),
      description: node.description,
      required,
      optional: input && !required,
      computed: inModel && !required,
      replace: inCreate && (!update || !inUpdate),
      sensitive: !!node["x-growthbook-sensitive"],
      inCreate,
      inUpdate,
      inModel,
    };
  });

  const walk = (list: Field[], prefix: string) => {
    for (const field of list) {
      const path = prefix + field.json;
      if (jsonName(field.attribute) !== field.json) {
        problems.push(`field name does not round-trip: ${path}`);
      }
      if (field.type.kind === "object") walk(field.type.fields, `${path}.`);
      if (prefix && field.type.kind === "json") {
        problems.push(`nested JSON field: ${path}`);
      }
    }
  };
  walk(fields, "");
  if (!fields.some((field) => field.attribute === idAttribute)) {
    problems.push(`no ${idAttribute} field`);
  }

  return { name, idAttribute, operations, fields, problems };
}
