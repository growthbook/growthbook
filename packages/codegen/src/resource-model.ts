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
  // The id of an object this one's paths nest under, e.g. a filter's fact table.
  parent: boolean;
  defaultValue?: unknown;
  serverDefault: boolean;
  // Removing it from config clears it, instead of keeping the server's value.
  clearable: boolean;
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
  parentAttributes: string[];
  // Readable but not creatable (members, data sources): data sources only.
  dataOnly: boolean;
  operations: Partial<Record<CrudAction, ModelOperation>>;
  fields: Field[];
  problems: string[];
};

// The API fills these in with the requesting member (a PAT's user) when omitted.
const requesterDefaults = ["owner", "createdBy"];

// Response-only values that never change once created, so updates can keep
// them from state; other response-only values may change with any update.
export const stableComputedFields = [
  "id",
  "dateCreated",
  "uid",
  "key",
  "encryptionKey",
  "proxySigningKey",
  "seed",
  "creator",
];

// dateUpdated changes on every write, so tracking it would show a diff after
// each apply; the org id is implied by the API key.
const volatileFields = ["dateUpdated", "organization"];

// Acronyms stay one word: `targetMDE` is `target_mde`, not `target_m_d_e`.
export function attributeName(field: string): string {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

// Mirrors jsonName in the provider's convert.go, before its overrides.
export function jsonName(attribute: string): string {
  return attribute.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function nonNullBranches(spec: Spec, node: SchemaNode): unknown[] | null {
  const branches = node.anyOf ?? node.oneOf;
  if (!branches) return null;
  return branches.filter((branch) => schemaNode(spec, branch).type !== "null");
}

// The one non-null branch of a nullable schema, or the schema itself.
function single(spec: Spec, value: unknown): unknown {
  const branches = nonNullBranches(spec, schemaNode(spec, value));
  return branches?.length === 1 ? single(spec, branches[0]) : value;
}

// `input` is the request's schema for the same value, absent for response-only
// values; nested fields take required and optional from it.
function fieldType(
  spec: Spec,
  value: unknown,
  input?: unknown,
  required = false,
): FieldType {
  const node = schemaNode(spec, single(spec, value));
  if (nonNullBranches(spec, node)) return { kind: "json" };
  const type = Array.isArray(node.type)
    ? node.type.find((t) => t !== "null")
    : node.type;
  const inputNode =
    input === undefined ? undefined : schemaNode(spec, single(spec, input));
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
      const element = fieldType(spec, node.items, inputNode?.items, required);
      return element.kind === "json" || element.kind === "list"
        ? { kind: "json" }
        : { kind: "list", element };
    }
    case "object":
      if (!node.properties) return { kind: "json" };
      return {
        kind: "object",
        fields: nestedFields(spec, node, inputNode, required),
      };
  }
  return { kind: "json" };
}

// Response-only nested fields are computed; the rest may be set in config.
// Fields are only Required under a required parent: Terraform can't keep an
// omitted Optional+Computed object whose fields are Required.
function nestedFields(
  spec: Spec,
  model: SchemaNode,
  input: SchemaNode | undefined,
  parentRequired: boolean,
): Field[] {
  const modelProperties = model.properties ?? {};
  const inputProperties = input?.properties ?? {};
  const required = new Set(input?.required ?? []);
  const names = [
    ...new Set([
      ...Object.keys(modelProperties),
      ...Object.keys(inputProperties),
    ]),
  ];
  return names
    .filter(
      (json) =>
        !schemaNode(spec, modelProperties[json] ?? inputProperties[json])
          .deprecated,
    )
    .map((json): Field => {
      const inInput = json in inputProperties;
      const source = modelProperties[json] ?? inputProperties[json];
      const node = schemaNode(spec, source);
      const isRequired = parentRequired && inInput && required.has(json);
      return {
        json,
        attribute: attributeName(json),
        type: fieldType(
          spec,
          source,
          inInput ? inputProperties[json] : undefined,
          isRequired,
        ),
        description: node.description,
        required: isRequired,
        optional: inInput && !isRequired,
        computed: !isRequired,
        replace: false,
        sensitive: !!node["x-growthbook-sensitive"],
        inCreate: inInput,
        inUpdate: inInput,
        inModel: json in modelProperties,
        parent: false,
        serverDefault: false,
        clearable: false,
      };
    });
}

// Only strings and lists have an empty value the API accepts as "unset".
function isClearable(type: FieldType, node: SchemaNode): boolean {
  if (type.kind === "list") return type.element.kind !== "object";
  return type.kind === "string" && (!node.enum || node.enum.includes(""));
}

// Extra keys like `bypassedGates` are fine when one is named for the resource.
function wrappedKey(
  spec: Spec,
  operation: LocatedOperation,
  resourceKey: string,
  isList: boolean,
): string | null {
  const envelope = schemaProperties(spec, responseSchema(operation.operation));
  const keys = Object.keys(envelope ?? {}).filter((key) => {
    const node = schemaNode(spec, single(spec, envelope?.[key]));
    return isList
      ? node.type === "array"
      : node.type === "object" || !!node.allOf;
  });
  if (!isList && keys.includes(resourceKey)) return resourceKey;
  return keys.length === 1 ? keys[0] : null;
}

// Fields whose JSON name can't be derived from the attribute name, for the
// provider's override map.
export function jsonNameOverrides(fields: Field[]): Map<string, string> {
  const overrides = new Map<string, string>();
  const visit = (list: Field[]) => {
    for (const field of list) {
      if (jsonName(field.attribute) !== field.json) {
        overrides.set(field.attribute, field.json);
      }
      if (field.type.kind === "object") visit(field.type.fields);
      if (field.type.kind === "list" && field.type.element.kind === "object") {
        visit(field.type.element.fields);
      }
    }
  };
  visit(fields);
  return overrides;
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
  const dataOnly = !create && !!(get || list);
  if (dataOnly) {
    delete located.update;
    delete located.delete;
  }

  const problems: string[] = [];
  if (!get && !list) problems.push("no read");
  else if (!dataOnly) {
    if (!create) problems.push("no create");
    if (!del) problems.push("no delete");
  }

  const operations: ResourceModel["operations"] = {};
  for (const [action, operation] of Object.entries(located)) {
    const responseKey =
      action === "delete"
        ? ""
        : wrappedKey(spec, operation, jsonName(name), action === "list");
    // A list is optional when there's a GET; it only backs the plural data source.
    if (responseKey === null && action === "list" && get) continue;
    // An update that only acknowledges (`{updatedId}`) is followed by a read.
    if (responseKey === null && action !== "update") {
      problems.push(`${action} response is not one wrapped model`);
      continue;
    }
    operations[action as CrudAction] = {
      method: operation.method.toUpperCase(),
      path: operation.path,
      responseKey: responseKey ?? "",
      paginated: !!operation.operation.parameters?.some(
        (p) => p.name === "limit" || p.$ref?.endsWith("/limit"),
      ),
    };
  }

  const itemPath = (get ?? located.update ?? located.delete)?.path ?? "";
  const params = [...itemPath.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const idAttribute = attributeName(params.pop() ?? "id");
  const parentAttributes = params.map(attributeName);

  const readOperation = get ?? create;
  const readKey = operations[get ? "get" : "create"]?.responseKey;
  const envelope =
    readOperation &&
    schemaProperties(spec, responseSchema(readOperation.operation));
  const listKey = operations.list?.responseKey;
  const listEnvelope =
    list && schemaProperties(spec, responseSchema(list.operation));
  const model =
    (readKey && envelope && schemaProperties(spec, envelope[readKey])) ||
    // Only a list to read from: the model is its items.
    (listKey &&
      listEnvelope &&
      schemaProperties(spec, schemaNode(spec, listEnvelope[listKey]).items)) ||
    {};
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
  ].filter(
    (json) =>
      !volatileFields.includes(json) &&
      // New Terraform configs shouldn't start on fields the API is retiring.
      ![model, createBody, updateBody].some(
        (fields) => json in fields && schemaNode(spec, fields[json]).deprecated,
      ),
  );

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
    // Defaults are declared on request bodies, which the response doesn't share.
    const input = schemaNode(
      spec,
      inCreate ? createBody[json] : inUpdate ? updateBody[json] : undefined,
    );
    const required = inCreate && requiredOnCreate.has(json);
    const optional = (inCreate || inUpdate) && !required;
    const type = fieldType(
      spec,
      source,
      inCreate ? createBody[json] : inUpdate ? updateBody[json] : undefined,
      required,
    );
    const defaultValue = input["x-growthbook-default"];
    const serverDefault =
      !!input["x-growthbook-server-default"] ||
      requesterDefaults.includes(json);
    const clearable =
      optional &&
      defaultValue === undefined &&
      !serverDefault &&
      isClearable(type, input);
    return {
      json,
      attribute: attributeName(json),
      type,
      // A request's description is written for whoever sets the value.
      description: input.description ?? node.description,
      required,
      optional,
      computed:
        defaultValue !== undefined || (inModel && !required && !clearable),
      replace: inCreate && (!update || !inUpdate),
      sensitive: !!node["x-growthbook-sensitive"],
      inCreate,
      inUpdate,
      inModel,
      parent: false,
      defaultValue,
      serverDefault,
      clearable,
    };
  });

  for (const json of params) {
    const parent = {
      json,
      attribute: attributeName(json),
      type: { kind: "string" } as const,
      required: true,
      optional: false,
      computed: false,
      replace: true,
      sensitive: false,
      inCreate: false,
      inUpdate: false,
      inModel: false,
      parent: true,
      serverDefault: false,
      clearable: false,
    };
    const existing = fields.findIndex((field) => field.json === json);
    if (existing === -1) fields.push(parent);
    else fields[existing] = { ...parent, inModel: fields[existing].inModel };
  }

  for (const field of fields) {
    if (field.replace && field.defaultValue !== undefined) {
      problems.push(
        `default on a field updates can't change: ${field.json} (use x-growthbook-server-default)`,
      );
    }
  }

  const walk = (list: Field[], prefix: string) => {
    for (const field of list) {
      const path = prefix + field.json;
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

  return {
    name,
    idAttribute,
    parentAttributes,
    dataOnly,
    operations,
    fields,
    problems,
  };
}
