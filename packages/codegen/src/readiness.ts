import {
  indexOperations,
  LocatedOperation,
  requestSchema,
  responseSchema,
  schemaNode,
  schemaProperties,
  Spec,
} from "./spec";

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

function isUnion(spec: Spec, value: unknown): boolean {
  const node = schemaNode(spec, value);
  const branches = node.anyOf ?? node.oneOf;
  if (!branches) return false;
  const nonNull = branches.filter(
    (branch) => schemaNode(spec, branch).type !== "null",
  );
  return nonNull.length > 1;
}

// The model a single-resource response wraps, e.g. `{ project: Project }`.
function wrappedModel(
  spec: Spec,
  operation: LocatedOperation | undefined,
): Record<string, unknown> | null {
  if (!operation) return null;
  const envelope = schemaProperties(spec, responseSchema(operation.operation));
  const keys = Object.keys(envelope ?? {});
  if (!envelope || keys.length !== 1) return null;
  return schemaProperties(spec, envelope[keys[0]]);
}

function bodyFields(
  spec: Spec,
  operation: LocatedOperation | undefined,
): string[] {
  if (!operation) return [];
  return Object.keys(
    schemaProperties(spec, requestSchema(operation.operation)) ?? {},
  );
}

function assessDescribed(
  spec: Spec,
  name: string,
  operations: Record<string, LocatedOperation | undefined>,
): ReadinessRow {
  const { create, get, list, update, delete: del } = operations;
  const reasons: string[] = [];
  const notes: string[] = [];

  if (!create) reasons.push("no create");
  if (!del) reasons.push("no delete");
  if (!get && !list) reasons.push("no read");
  if (!get && list) notes.push("read via list");

  const model = wrappedModel(spec, get ?? create);
  if (!model) {
    reasons.push("response is not one wrapped model");
  } else {
    const createFields = bodyFields(spec, create);
    const updateFields = bodyFields(spec, update);
    const unions = [
      ...Object.entries(model),
      ...Object.entries(
        schemaProperties(spec, create && requestSchema(create.operation)) ?? {},
      ),
    ]
      .filter(([, value]) => isUnion(spec, value))
      .map(([field]) => field);
    if (unions.length) {
      reasons.push(`union fields: ${[...new Set(unions)].join(", ")}`);
    }

    const replaced = update
      ? createFields.filter((field) => !updateFields.includes(field))
      : createFields;
    if (!update) notes.push("no update: every change replaces");
    else if (replaced.length)
      notes.push(`replace on change: ${replaced.join(", ")}`);

    const sensitive = Object.entries(model)
      .filter(([, value]) => schemaNode(spec, value)["x-growthbook-sensitive"])
      .map(([field]) => field);
    if (sensitive.length) notes.push(`sensitive: ${sensitive.join(", ")}`);

    const computed = Object.keys(model).filter(
      (field) => !createFields.includes(field) && !updateFields.includes(field),
    );
    notes.push(`${computed.length} computed`);
  }

  return {
    resource: name,
    status: reasons.length ? "needs-override" : "generated",
    reasons,
    notes,
  };
}

// Collections with a POST and item routes that no resource claims yet.
function undescribedCandidates(
  spec: Spec,
  claimed: Set<string>,
): ReadinessRow[] {
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
  const index = indexOperations(spec);
  const claimed = new Set<string>();
  const described = Object.entries(spec["x-growthbook-resources"]).map(
    ([name, { operations }]) => {
      const located = Object.fromEntries(
        Object.entries(operations).map(([action, operationId]) => {
          const operation = operationId ? index.get(operationId) : undefined;
          if (operation) claimed.add(operation.path);
          return [action, operation];
        }),
      );
      return assessDescribed(spec, name, located);
    },
  );
  return [...described, ...undescribedCandidates(spec, claimed)];
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
