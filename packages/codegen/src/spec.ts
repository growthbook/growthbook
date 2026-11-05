import { z } from "zod";

const crudActionValidator = z.enum([
  "create",
  "list",
  "get",
  "update",
  "delete",
]);
export type CrudAction = z.infer<typeof crudActionValidator>;

const schemaNodeValidator = z.looseObject({
  $ref: z.string().optional(),
  type: z.unknown().optional(),
  description: z.string().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  items: z.unknown().optional(),
  allOf: z.array(z.unknown()).optional(),
  anyOf: z.array(z.unknown()).optional(),
  oneOf: z.array(z.unknown()).optional(),
  enum: z.array(z.unknown()).optional(),
  "x-growthbook-sensitive": z.boolean().optional(),
  "x-growthbook-default": z.unknown().optional(),
  "x-growthbook-server-default": z.boolean().optional(),
});
export type SchemaNode = z.infer<typeof schemaNodeValidator>;

const jsonContentValidator = z.looseObject({
  content: z
    .looseObject({
      "application/json": z.looseObject({ schema: z.unknown() }).optional(),
    })
    .optional(),
});

const operationValidator = z.looseObject({
  operationId: z.string(),
  parameters: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        $ref: z.string().optional(),
      }),
    )
    .optional(),
  requestBody: jsonContentValidator.optional(),
  responses: z.record(z.string(), z.unknown()),
});
export type Operation = z.infer<typeof operationValidator>;

export const specValidator = z.looseObject({
  paths: z.record(
    z.string(),
    z.partialRecord(
      z.enum(["get", "post", "put", "patch", "delete"]),
      operationValidator,
    ),
  ),
  components: z.looseObject({
    schemas: z.record(z.string(), z.unknown()),
  }),
  "x-growthbook-resources": z.record(
    z.string(),
    z.object({
      operations: z.partialRecord(crudActionValidator, z.string()),
    }),
  ),
});
export type Spec = z.infer<typeof specValidator>;

export type LocatedOperation = {
  path: string;
  method: string;
  operation: Operation;
};

export function indexOperations(spec: Spec): Map<string, LocatedOperation> {
  const index = new Map<string, LocatedOperation>();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation)
        index.set(operation.operationId, { path, method, operation });
    }
  }
  return index;
}

export function schemaNode(spec: Spec, value: unknown): SchemaNode {
  const parsed = schemaNodeValidator.safeParse(value);
  if (!parsed.success) return {};
  const ref = parsed.data.$ref?.match(/^#\/components\/schemas\/(.+)$/)?.[1];
  return ref ? schemaNode(spec, spec.components.schemas[ref]) : parsed.data;
}

// `allOf` branches merge, as generate-openapi emits for paginated lists.
export function schemaProperties(
  spec: Spec,
  value: unknown,
): Record<string, unknown> | null {
  const node = schemaNode(spec, value);
  if (node.properties) return node.properties;
  if (!node.allOf) return null;
  const branches = node.allOf.map((branch) => schemaProperties(spec, branch));
  if (branches.some((branch) => branch === null)) return null;
  return Object.assign({}, ...branches);
}

export function requestSchema(operation: Operation): unknown {
  return operation.requestBody?.content?.["application/json"]?.schema;
}

export function responseSchema(operation: Operation): unknown {
  return jsonContentValidator.safeParse(operation.responses["200"]).data
    ?.content?.["application/json"]?.schema;
}
