import { Spec } from "../src/spec";

const json = (schema: unknown) => ({
  content: { "application/json": { schema } },
});
const op = (
  operationId: string,
  response: unknown,
  body?: Record<string, unknown>,
  required?: string[],
) => ({
  operationId,
  ...(body && {
    requestBody: json({ type: "object", properties: body, required }),
  }),
  responses: { "200": json(response) },
});
const wrapped = {
  type: "object",
  properties: { widget: { $ref: "#/components/schemas/Widget" } },
};

export const spec: Spec = {
  paths: {
    "/v1/widgets": {
      post: op(
        "postWidget",
        wrapped,
        { name: { type: "string" }, kind: { type: "string" } },
        ["name"],
      ),
      get: op("listWidgets", {}),
    },
    "/v1/widgets/{id}": {
      get: op("getWidget", wrapped),
      put: op("putWidget", wrapped, {
        name: { type: "string" },
        active: { type: "boolean" },
      }),
      delete: op("deleteWidget", {}),
    },
    "/v1/gadgets": { post: op("postGadget", wrapped, { name: {} }) },
    "/v1/gadgets/{id}": { get: op("getGadget", wrapped) },
    "/v1/things": { post: op("postThingV1", {}) },
    "/v1/things/{id}": { get: op("getThingV1", {}) },
    "/v2/things": { post: op("postThing", {}) },
    "/v2/things/{id}": { get: op("getThing", {}) },
  },
  components: {
    schemas: {
      Widget: {
        type: "object",
        properties: {
          id: { type: "string" },
          dateUpdated: { type: "string" },
          name: { type: "string", description: "Display name" },
          kind: { type: "string" },
          active: { type: "boolean" },
          secret: { type: "string", "x-growthbook-sensitive": true },
          value: { anyOf: [{ type: "string" }, { type: "number" }] },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
          tags: { type: "array", items: { type: "string" } },
          settings: {
            type: "object",
            properties: { maxCount: { type: "integer" } },
          },
        },
      },
    },
  },
  "x-growthbook-resources": {
    widget: {
      operations: {
        create: "postWidget",
        list: "listWidgets",
        get: "getWidget",
        update: "putWidget",
        delete: "deleteWidget",
      },
    },
    gadget: { operations: { create: "postGadget", get: "getGadget" } },
  },
};
