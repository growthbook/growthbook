import { analyzeResource, Field } from "./resource-model";
import { Spec } from "./spec";

export type ReadinessStatus =
  | "generated"
  | "needs-annotation"
  | "needs-override";

export type ReadinessRow = {
  resource: string;
  status: ReadinessStatus;
  reasons: string[];
  notes: string[];
};

const named = (fields: Field[], test: (field: Field) => boolean) =>
  fields
    .filter(test)
    .map((field) => field.json)
    .join(", ");

// Terraform docs show these as bare names, nested fields as `parent.child`.
function undescribed(fields: Field[], prefix = ""): string[] {
  return fields.flatMap((field) => {
    const path = prefix + field.json;
    const own = field.description || field.parent ? [] : [path];
    const nested =
      field.type.kind === "object"
        ? field.type.fields
        : field.type.kind === "list" && field.type.element.kind === "object"
          ? field.type.element.fields
          : [];
    return [...own, ...undescribed(nested, `${path}.`)];
  });
}

function assessDescribed(spec: Spec, name: string): ReadinessRow {
  const { operations, fields, problems, dataOnly } = analyzeResource(
    spec,
    name,
  );
  const notes: string[] = [];
  if (dataOnly) notes.push("data sources only");
  else if (!operations.get && operations.list) notes.push("read via list");
  if (!dataOnly && !operations.update) {
    notes.push("no update: every change replaces");
  }
  for (const [label, test] of [
    ["replace on change", (f: Field) => f.replace && !!operations.update],
    ["JSON", (f: Field) => f.type.kind === "json"],
    ["sensitive", (f: Field) => f.sensitive],
    ["write-only", (f: Field) => !f.inModel],
    // Unannotated: removing the line keeps the server's value.
    [
      "kept when removed",
      (f: Field) =>
        f.optional &&
        f.computed &&
        f.defaultValue === undefined &&
        !f.serverDefault,
    ],
  ] as const) {
    const list = named(fields, test);
    if (list) notes.push(`${label}: ${list}`);
  }
  notes.push(
    `${fields.filter((f) => f.computed && !f.inCreate && !f.inUpdate).length} computed`,
  );
  const missing = undescribed(fields);
  if (missing.length) notes.push(`no description: ${missing.join(", ")}`);

  return {
    resource: name,
    status: problems.length ? "needs-override" : "generated",
    reasons: problems,
    notes,
  };
}

// Collections with a POST and item routes that no resource claims yet.
function undescribedCandidates(spec: Spec): ReadinessRow[] {
  const claimed = new Set<string>();
  for (const name of Object.keys(spec["x-growthbook-resources"])) {
    for (const operation of Object.values(
      analyzeResource(spec, name).operations,
    )) {
      claimed.add(operation.path);
    }
  }
  const paths = Object.keys(spec.paths);
  const supersededByV2 = (path: string) =>
    path.startsWith("/v1/") && path.replace(/^\/v1\//, "/v2/") in spec.paths;
  return paths
    .filter(
      (path) =>
        !claimed.has(path) &&
        !supersededByV2(path) &&
        spec.paths[path].post &&
        paths.some((other) => new RegExp(`^${path}/\\{\\w+\\}$`).test(other)),
    )
    .map((path) => ({
      resource: path,
      status: "needs-annotation",
      reasons: [],
      notes: [],
    }));
}

export function assessReadiness(spec: Spec): ReadinessRow[] {
  return [
    ...Object.keys(spec["x-growthbook-resources"]).map((name) =>
      assessDescribed(spec, name),
    ),
    ...undescribedCandidates(spec),
  ];
}

export function formatReadiness(rows: ReadinessRow[]): string {
  const order: ReadinessStatus[] = [
    "generated",
    "needs-annotation",
    "needs-override",
  ];
  const sorted = [...rows].sort(
    (a, b) => order.indexOf(a.status) - order.indexOf(b.status),
  );
  const counts = order.map(
    (status) =>
      `${rows.filter((row) => row.status === status).length} ${status}`,
  );
  return [
    "| Resource | Status | Why | Notes |",
    "| --- | --- | --- | --- |",
    ...sorted.map(
      (row) =>
        `| ${row.resource} | ${row.status} | ${row.reasons.join("; ")} | ${row.notes.join("; ")} |`,
    ),
    "",
    counts.join(", "),
  ].join("\n");
}
