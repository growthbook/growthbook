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
        {
          name: { type: "string" },
          kind: { type: "string" },
          slug: { type: "string", "x-growthbook-server-default": true },
        },
        ["name"],
      ),
      get: op("listWidgets", {}),
    },
    "/v1/widgets/{id}": {
      get: op("getWidget", wrapped),
      put: op("putWidget", wrapped, {
        name: { type: "string" },
        slug: { type: "string", "x-growthbook-server-default": true },
        active: { type: "boolean", "x-growthbook-default": true },
        managedBy: {
          type: "string",
          enum: ["", "api", "terraform"],
          description: "Who may edit it",
        },
      }),
      delete: op("deleteWidget", {}),
    },
    "/v1/gadgets": { post: op("postGadget", wrapped, { name: {} }) },
    "/v1/gadgets/{id}": { get: op("getGadget", wrapped) },
    "/v1/things": { post: op("postThingV1", {}) },
    "/v1/things/{id}": { get: op("getThingV1", {}) },
    "/v2/things": { post: op("postThing", {}) },
    "/v2/things/{id}": { get: op("getThing", {}) },
    "/v1/badges": {
      get: op("listBadges", {
        type: "object",
        properties: {
          badges: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, name: { type: "string" } },
            },
          },
        },
      }),
    },
    "/v1/widgets/{widgetId}/parts": {
      post: op(
        "postPart",
        {
          type: "object",
          properties: { part: { $ref: "#/components/schemas/Part" } },
        },
        {
          name: { type: "string" },
          owner: { type: "string" },
          legacy: { type: "string", deprecated: true },
          bounds: {
            type: "object",
            properties: { low: { type: "number" }, high: { type: "number" } },
            required: ["low"],
          },
          limits: {
            type: "object",
            properties: { min: { type: "number" } },
            required: ["min"],
          },
        },
        ["name", "bounds"],
      ),
    },
    "/v1/widgets/{widgetId}/parts/{id}": {
      get: op("getPart", {
        type: "object",
        properties: { part: { $ref: "#/components/schemas/Part" } },
      }),
      put: op(
        "putPart",
        { type: "object", properties: { updatedId: { type: "string" } } },
        { name: { type: "string" } },
      ),
      delete: op("deletePart", {}),
    },
  },
  components: {
    schemas: {
      Part: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          owner: { type: "string" },
          ownerEmail: { type: "string" },
          legacy: { type: "string", deprecated: true },
          bounds: {
            type: "object",
            properties: {
              low: { type: "number" },
              high: { type: "number" },
              computedAt: { type: "string" },
            },
          },
          limits: { type: "object", properties: { min: { type: "number" } } },
        },
      },
      Widget: {
        type: "object",
        properties: {
          id: { type: "string" },
          dateUpdated: { type: "string" },
          name: { type: "string", description: "Display name" },
          kind: { type: "string" },
          slug: { type: "string" },
          active: { type: "boolean" },
          managedBy: { type: "string" },
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
    badge: { operations: { list: "listBadges" } },
    part: {
      operations: {
        create: "postPart",
        get: "getPart",
        update: "putPart",
        delete: "deletePart",
      },
    },
  },
};
