import {
  analyzeResource,
  attributeName,
  jsonName,
} from "../src/resource-model";
import { spec } from "./fixture";

describe("analyzeResource", () => {
  const model = analyzeResource(spec, "widget");
  const field = (json: string) => model.fields.find((f) => f.json === json);

  it("resolves operations and skips the list when there is a GET", () => {
    expect(model.idAttribute).toBe("id");
    expect(model.operations.get).toEqual({
      method: "GET",
      path: "/v1/widgets/{id}",
      responseKey: "widget",
      paginated: false,
    });
    expect(model.operations.list).toBeUndefined();
    expect(model.operations.delete?.responseKey).toBe("");
  });

  it("derives Terraform flags from where each field appears", () => {
    expect(field("name")).toMatchObject({
      required: true,
      optional: false,
      computed: false,
      replace: false,
      description: "Display name",
    });
    expect(field("kind")).toMatchObject({ optional: true, replace: true });
    expect(field("id")).toMatchObject({ computed: true, optional: false });
    expect(field("secret")?.sensitive).toBe(true);
    expect(field("dateUpdated")).toBeUndefined();
  });

  it("decides what removing an optional field from config does", () => {
    expect(field("kind")).toMatchObject({ computed: false, clearable: true });
    expect(field("active")).toMatchObject({
      inUpdate: true,
      replace: false,
      computed: true,
      defaultValue: true,
      clearable: false,
    });
    expect(field("slug")).toMatchObject({
      computed: true,
      serverDefault: true,
      clearable: false,
    });
  });

  it("maps schema types, falling back to JSON for unions", () => {
    expect(field("value")?.type).toEqual({ kind: "json" });
    expect(field("note")?.type).toEqual({ kind: "string" });
    expect(field("tags")?.type).toEqual({
      kind: "list",
      element: { kind: "string" },
    });
    expect(field("settings")?.type).toMatchObject({
      kind: "object",
      fields: [{ attribute: "max_count", type: { kind: "int64" } }],
    });
  });

  describe("nested resources", () => {
    const part = analyzeResource(spec, "part");
    const partField = (json: string) =>
      part.fields.find((f) => f.json === json);
    const nested = (json: string, child: string) => {
      const type = partField(json)?.type;
      return type?.kind === "object"
        ? type.fields.find((f) => f.json === child)
        : undefined;
    };

    it("take the parent's id from the path", () => {
      expect(part.problems).toEqual([]);
      expect(part.parentAttributes).toEqual(["widget_id"]);
      expect(partField("widgetId")).toMatchObject({
        required: true,
        replace: true,
        parent: true,
        inCreate: false,
      });
    });

    it("re-read after an update that only acknowledges", () => {
      expect(part.operations.update?.responseKey).toBe("");
    });

    it("treat owner as filled in by the server", () => {
      expect(partField("owner")).toMatchObject({
        serverDefault: true,
        computed: true,
        clearable: false,
      });
    });

    it("leave out deprecated fields", () => {
      expect(partField("legacy")).toBeUndefined();
    });

    it("require nested fields only under a required parent", () => {
      expect(nested("bounds", "low")).toMatchObject({ required: true });
      expect(nested("bounds", "high")).toMatchObject({
        optional: true,
        computed: true,
      });
      expect(nested("bounds", "computedAt")).toMatchObject({
        optional: false,
        computed: true,
      });
      expect(nested("limits", "min")).toMatchObject({
        required: false,
        optional: true,
      });
    });
  });

  it("refuses a default on a field updates can't change", () => {
    const withDefault = structuredClone(spec);
    const body = withDefault.paths["/v1/widgets"].post?.requestBody?.content?.[
      "application/json"
    ]?.schema as { properties: Record<string, Record<string, unknown>> };
    body.properties.kind["x-growthbook-default"] = "basic";
    expect(analyzeResource(withDefault, "widget").problems).toEqual([
      "default on a field updates can't change: kind (use x-growthbook-server-default)",
    ]);
  });

  it("reports what the generator cannot handle", () => {
    expect(analyzeResource(spec, "gadget").problems).toEqual(["no delete"]);
  });
});

describe("attribute names", () => {
  it("round-trip between camelCase and snake_case", () => {
    for (const json of ["id", "displayName", "includeProjectIdInMetadata"]) {
      expect(jsonName(attributeName(json))).toBe(json);
    }
  });

  it("keep acronyms as one word", () => {
    expect(attributeName("targetMDE")).toBe("target_mde");
    expect(attributeName("conversionSQL")).toBe("conversion_sql");
    expect(attributeName("userSQLColumn")).toBe("user_sql_column");
  });
});
