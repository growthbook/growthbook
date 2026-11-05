import {
  Field,
  FieldType,
  jsonName,
  jsonNameOverrides,
  ResourceModel,
  stableComputedFields,
} from "./resource-model";

const framework = "github.com/hashicorp/terraform-plugin-framework";

const kinds = {
  string: { attribute: "String", element: "StringType", modifier: "string" },
  json: { attribute: "String", element: "StringType", modifier: "string" },
  bool: { attribute: "Bool", element: "BoolType", modifier: "bool" },
  int64: { attribute: "Int64", element: "Int64Type", modifier: "int64" },
  float64: {
    attribute: "Float64",
    element: "Float64Type",
    modifier: "float64",
  },
  list: { attribute: "List", element: "", modifier: "list" },
  object: { attribute: "SingleNested", element: "", modifier: "object" },
} as const;

const goString = (value: string) => JSON.stringify(value);
const indent = (text: string, depth: number) =>
  text.replace(/^(?=.)/gm, "\t".repeat(depth));

// Data sources read by id (or by name, through the list), so everything else
// is computed.
type DataRole = "key" | "lookup" | "computed";

function dataField(field: Field, role: DataRole): Field {
  const type: FieldType =
    field.type.kind === "object"
      ? {
          kind: "object",
          fields: field.type.fields.map((f) => dataField(f, "computed")),
        }
      : field.type.kind === "list" && field.type.element.kind === "object"
        ? {
            kind: "list",
            element: {
              kind: "object",
              fields: field.type.element.fields.map((f) =>
                dataField(f, "computed"),
              ),
            },
          }
        : field.type;
  return {
    ...field,
    type,
    required: role === "key",
    optional: role === "lookup",
    computed: role !== "key",
    replace: false,
    defaultValue: undefined,
  };
}

class GoFile {
  // Import path to alias ("" for none).
  imports = new Map<string, string>([[`${framework}/resource/schema`, ""]]);
  data = false;

  attributes(fields: Field[], nested: boolean): string {
    const pkg = this.data ? "dsschema" : "schema";
    const entries = [...fields]
      .sort((a, b) => a.attribute.localeCompare(b.attribute))
      .map(
        (field) =>
          `${goString(field.attribute)}: ${this.attribute(field, nested)},`,
      );
    return `map[string]${pkg}.Attribute{\n${indent(entries.join("\n"), 1)}\n}`;
  }

  attribute(field: Field, nested: boolean): string {
    const { type } = field;
    const schemaPkg = this.data ? "dsschema" : "schema";
    const lines: string[] = [];
    if (field.required) lines.push("Required: true,");
    if (field.optional) lines.push("Optional: true,");
    if (field.computed) lines.push("Computed: true,");
    if (field.sensitive) lines.push("Sensitive: true,");
    if (field.description) {
      lines.push(`Description: ${goString(field.description)},`);
    }

    let name: string = kinds[type.kind].attribute;
    if (type.kind === "list") {
      if (type.element.kind === "object") {
        name = "ListNested";
        lines.push(
          `NestedObject: ${schemaPkg}.NestedAttributeObject{\n\tAttributes: ${indent(
            this.attributes(type.element.fields, true),
            1,
          ).trimStart()},\n},`,
        );
      } else {
        lines.push(`ElementType: ${this.elementType(type.element)},`);
      }
    }
    if (type.kind === "object") {
      lines.push(`Attributes: ${this.attributes(type.fields, true)},`);
    }
    if (field.defaultValue !== undefined) {
      lines.push(`Default: ${this.defaultValue(field)},`);
    }

    const modifiers: string[] = [];
    const pkg = `${kinds[type.kind].modifier}planmodifier`;
    const topLevel = !nested && !this.data;
    // Objects stay unknown on update, so they aren't resent from state and
    // the server's normalised version is accepted.
    const isObject =
      type.kind === "object" ||
      (type.kind === "list" && type.element.kind === "object");
    const keepable =
      field.inCreate ||
      field.inUpdate ||
      stableComputedFields.includes(field.json);
    if (
      topLevel &&
      field.computed &&
      field.defaultValue === undefined &&
      !isObject &&
      keepable
    ) {
      modifiers.push("stateForUnknown{}");
    }
    if (topLevel && field.replace) {
      this.imports.set(`${framework}/resource/schema/${pkg}`, "");
      modifiers.push(`${pkg}.RequiresReplace()`);
    }
    if (modifiers.length) {
      const kind = kinds[type.kind].attribute.replace("SingleNested", "Object");
      this.imports.set(`${framework}/resource/schema/planmodifier`, "");
      lines.push(
        `PlanModifiers: []planmodifier.${kind}{${modifiers.join(", ")}},`,
      );
    }
    return `${schemaPkg}.${name}Attribute{\n${indent(lines.join("\n"), 1)}\n}`;
  }

  dataAttributes(model: ResourceModel): string {
    this.data = true;
    this.imports.set(`${framework}/datasource/schema`, "dsschema");
    const byName = lookupByName(model);
    const fields = model.fields
      .filter((field) => field.inModel || field.parent)
      .map((field) =>
        dataField(
          field,
          field.parent
            ? "key"
            : field.attribute === model.idAttribute ||
                (byName && field.json === "name")
              ? byName
                ? "lookup"
                : "key"
              : "computed",
        ),
      );
    const rendered = this.attributes(fields, false);
    this.data = false;
    return rendered;
  }

  defaultValue({ json, type, defaultValue }: Field): string {
    const value =
      type.kind === "json" ? JSON.stringify(defaultValue) : defaultValue;
    const constructors: Partial<Record<FieldType["kind"], string>> = {
      string: "StaticString",
      json: "StaticString",
      bool: "StaticBool",
      int64: "StaticInt64",
      float64: "StaticFloat64",
    };
    const constructor = constructors[type.kind];
    if (!constructor) {
      throw new Error(
        `Defaults aren't supported on ${type.kind} field ${json}`,
      );
    }
    const pkg = `${kinds[type.kind].modifier}default`;
    this.imports.set(`${framework}/resource/schema/${pkg}`, "");
    return `${pkg}.${constructor}(${JSON.stringify(value)})`;
  }

  elementType(type: FieldType): string {
    this.imports.set(`${framework}/types`, "");
    return `types.${kinds[type.kind].element}`;
  }

  render(body: string): string {
    const imports = [...this.imports]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, alias]) => `\t${alias ? `${alias} ` : ""}${goString(path)}`)
      .join("\n");
    return `// Code generated by codegen from the GrowthBook OpenAPI spec. DO NOT EDIT.

package provider

import (
${imports}
)

${body}
`;
  }
}

// Listable resources with a name can be looked up by it instead of the id.
export function lookupByName(model: ResourceModel): boolean {
  return (
    !!model.operations.list &&
    !model.parentAttributes.length &&
    model.fields.some((field) => field.json === "name" && field.inModel)
  );
}

export function goVariable(model: ResourceModel): string {
  return `${jsonName(model.name)}Resource`;
}

function operation(
  model: ResourceModel,
  action: keyof ResourceModel["operations"],
) {
  const op = model.operations[action];
  if (!op) return "nil";
  const paginated = op.paginated ? ", paginated: true" : "";
  return `&operation{method: ${goString(op.method)}, path: ${goString(op.path)}, responseKey: ${goString(op.responseKey)}${paginated}}`;
}

const stringSlice = (values: string[]) =>
  `[]string{${values.map(goString).join(", ")}}`;

export function renderResource(model: ResourceModel): string {
  if (model.problems.length) {
    throw new Error(
      `Can't generate ${model.name}: ${model.problems.join("; ")}`,
    );
  }
  const file = new GoFile();
  const label = model.name.replace(/_/g, " ");
  const attributes = (test: (field: Field) => boolean) =>
    stringSlice(
      model.fields
        .filter(test)
        .map((field) => field.attribute)
        .sort(),
    );

  if (model.dataOnly) file.imports.delete(`${framework}/resource/schema`);
  const resourceOnly = model.dataOnly
    ? ""
    : `
	createFields:        ${attributes((field) => field.inCreate)},
	updateFields:        ${attributes((field) => field.inUpdate)},
	writeOnlyAttributes: ${attributes((field) => !field.inModel && !field.parent)},
	clearableAttributes: ${attributes((field) => field.clearable)},
	schema: schema.Schema{
		Description: ${goString(`Manages a GrowthBook ${label}.`)},
		Attributes: ${indent(file.attributes(model.fields, false), 2).trimStart()},
	},`;
  const body = `var ${goVariable(model)} = resourceDescriptor{
	name:                ${goString(model.name)},${model.dataOnly ? "\n\tdataOnly:            true," : ""}
	idAttribute:         ${goString(model.idAttribute)},${
    model.parentAttributes.length
      ? `\n\tparentAttributes:    ${stringSlice(model.parentAttributes)},`
      : ""
  }
	create:              ${operation(model, "create")},
	get:                 ${operation(model, "get")},
	list:                ${operation(model, "list")},
	update:              ${operation(model, "update")},
	delete:              ${operation(model, "delete")},
	jsonAttributes:      ${attributes((field) => field.type.kind === "json")},${resourceOnly}
	dataSchema: dsschema.Schema{
		Description: ${goString(`Reads a GrowthBook ${label} by ${lookupByName(model) ? `${model.idAttribute} or name` : model.idAttribute}.`)},
		Attributes: ${indent(file.dataAttributes(model), 2).trimStart()},
	},
}`;
  return file.render(body);
}

export function renderRegistry(models: ResourceModel[]): string {
  const entries = models.map((model) => `\t${goVariable(model)},`).join("\n");
  // Shared across resources, since convert.go maps names without knowing which.
  const overrides = new Map<string, string>();
  for (const model of models) {
    for (const [attribute, json] of jsonNameOverrides(model.fields)) {
      const existing = overrides.get(attribute);
      if (existing !== undefined && existing !== json) {
        throw new Error(`${attribute} is both ${existing} and ${json}`);
      }
      overrides.set(attribute, json);
    }
  }
  const names = [...overrides]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([attribute, json]) => `\t${goString(attribute)}: ${goString(json)},`)
    .join("\n");
  return `// Code generated by codegen from the GrowthBook OpenAPI spec. DO NOT EDIT.

package provider

var generatedResources = []resourceDescriptor{
${entries}
}

// JSON names that jsonName can't derive from the attribute name.
var jsonNameOverrides = map[string]string{
${names}
}
`;
}
