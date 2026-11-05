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
    expect(go).toContain('createFields:        []string{"kind", "name"},');
    expect(go).toContain('jsonAttributes:      []string{"value"},');
  });

  it("emits plan modifiers and only the imports it uses", () => {
    expect(go).toContain(
      "PlanModifiers: []planmodifier.String{stateForUnknown{}, stringplanmodifier.RequiresReplace()},",
    );
    expect(go).toContain("ElementType: types.StringType,");
    expect(go).toContain(
      '"github.com/hashicorp/terraform-plugin-framework/types"',
    );
    expect(go).not.toContain("float64planmodifier");
  });

  it("refuses resources with problems", () => {
    expect(() => renderResource(analyzeResource(spec, "gadget"))).toThrow(
      "Can't generate gadget: no delete",
    );
  });

  it("lists generated resources in the registry", () => {
    expect(renderRegistry([analyzeResource(spec, "widget")])).toContain(
      "\twidgetResource,\n",
    );
  });
});
