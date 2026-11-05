import { analyzeResource } from "../src/resource-model";
import { renderRegistry, renderResource } from "../src/terraform";
import { spec } from "./fixture";

describe("renderResource", () => {
  const go = renderResource(analyzeResource(spec, "widget"));

  it("emits the descriptor the engine reads", () => {
    expect(go).toContain("var widgetResource = resourceDescriptor{");
    expect(go).toContain(
      'update:              &operation{method: "PUT", path: "/v1/widgets/{id}", responseKey: "widget"},',
    );
    expect(go).toContain(
      'createFields:        []string{"kind", "name", "slug"},',
    );
    expect(go).toContain('jsonAttributes:      []string{"value"},');
    expect(go).toContain('clearableAttributes: []string{"kind"},');
  });

  it("emits plan modifiers, defaults and only the imports it uses", () => {
    expect(go).toContain(
      "PlanModifiers: []planmodifier.String{stringplanmodifier.RequiresReplace()},",
    );
    expect(go).toContain(
      "PlanModifiers: []planmodifier.String{stateForUnknown{}},",
    );
    expect(go).toContain("Default: booldefault.StaticBool(true),");
    expect(go).toContain("ElementType: types.StringType,");
    expect(go).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/types"',
    );
    expect(go).not.toContain("float64planmodifier");
  });

  it("emits a data source schema keyed by the id", () => {
    const data = go.slice(go.indexOf("dataSchema:"));
    expect(go).toContain(
      'dsschema "github.com/hashicorp/terraform-plugin-framework/datasource/schema"',
    );
    expect(data).toMatch(
      /"id": dsschema\.StringAttribute\{\n\t+Required: true,/,
    );
    expect(data).toMatch(
      /"name": dsschema\.StringAttribute\{\n\t+Computed: true,/,
    );
    expect(data).not.toContain("PlanModifiers");
    expect(data).not.toContain("Default:");
  });

  it("refuses resources with problems", () => {
    expect(() => renderResource(analyzeResource(spec, "gadget"))).toThrow(
      "Can't generate gadget: no delete",
    );
  });

  it("emits parents, and leaves objects unknown on update", () => {
    const part = renderResource(analyzeResource(spec, "part"));
    expect(part).toContain('parentAttributes:    []string{"widget_id"},');
    expect(part).not.toContain("planmodifier.Object{stateForUnknown{}}");
    expect(go).not.toContain("parentAttributes");
  });

  it("only keeps response-only values from state when they can't change", () => {
    const part = renderResource(analyzeResource(spec, "part"));
    const attribute = (name: string) =>
      part.slice(part.indexOf(`"${name}": schema.`)).split("\n\t\t\t},")[0];
    expect(attribute("id")).toContain("stateForUnknown{}");
    expect(attribute("owner_email")).not.toContain("stateForUnknown{}");
  });

  it("lists generated resources in the registry", () => {
    expect(renderRegistry([analyzeResource(spec, "widget")])).toContain(
      "\twidgetResource,\n",
    );
  });
});
