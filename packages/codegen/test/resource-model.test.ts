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
    expect(field("kind")).toMatchObject({
      optional: true,
      computed: true,
      replace: true,
    });
    expect(field("active")).toMatchObject({ inUpdate: true, replace: false });
    expect(field("id")).toMatchObject({ computed: true, optional: false });
    expect(field("secret")?.sensitive).toBe(true);
    expect(field("dateUpdated")).toBeUndefined();
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
});
