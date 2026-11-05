import { assessReadiness } from "../src/readiness";
import { Spec } from "../src/spec";

const json = (schema: unknown) => ({
  content: { "application/json": { schema } },
});
const op = (
  operationId: string,
  response: unknown,
  body?: Record<string, unknown>,
) => ({
  operationId,
  ...(body && { requestBody: json({ type: "object", properties: body }) }),
  responses: { "200": json(response) },
});
const wrapped = {
  type: "object",
  properties: { widget: { $ref: "#/components/schemas/Widget" } },
};

const spec: Spec = {
  paths: {
    "/v1/widgets": {
      post: op("postWidget", wrapped, { name: {}, kind: {} }),
      get: op("listWidgets", {}),
    },
    "/v1/widgets/{id}": {
      get: op("getWidget", wrapped),
      put: op("putWidget", wrapped, { name: {} }),
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
          name: { type: "string" },
          kind: { type: "string" },
          secret: { type: "string", "x-growthbook-sensitive": true },
          value: { anyOf: [{ type: "string" }, { type: "number" }] },
          note: { anyOf: [{ type: "string" }, { type: "null" }] },
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

describe("assessReadiness", () => {
  const rows = assessReadiness(spec);
  const row = (resource: string) => rows.find((r) => r.resource === resource);

  it("infers replace-on-change, sensitive and computed fields", () => {
    expect(row("widget")).toEqual({
      resource: "widget",
      status: "needs-override",
      reasons: ["union fields: value"],
      notes: ["replace on change: kind", "sensitive: secret", "4 computed"],
    });
  });

  it("explains what a resource is missing", () => {
    expect(row("gadget")?.reasons).toContain("no delete");
    expect(row("gadget")?.notes).toContain("no update: every change replaces");
  });

  it("lists unclaimed collections, skipping v1 paths that v2 replaces", () => {
    expect(
      rows
        .filter((r) => r.status === "needs-annotation")
        .map((r) => r.resource),
    ).toEqual(["/v2/things"]);
  });
});
