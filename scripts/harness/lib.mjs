// Shared REST client and seeding helpers for the Setup-page harnesses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const API = process.env.GB_API || "http://localhost:3100/api";
export const APP = process.env.GB_APP || "http://localhost:3000";
const KEY = process.env.GB_KEY;
const DATASOURCE = process.env.SEED_DATASOURCE || "ds_6x0d1wvpkuau52dw";
const ASSIGNMENT_QUERY = process.env.SEED_ASSIGNMENT_QUERY || "anonymous_id";
export const RUNS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "runs",
);

export function writeManifest(run, data) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNS_DIR, `${run}.json`),
    JSON.stringify(data, null, 2),
  );
}

// A revision's rule for the experiment.
export const findRefRule = (revision, experimentId) =>
  (revision?.rules ?? []).find(
    (r) => r.type === "experiment-ref" && r.experimentId === experimentId,
  );

if (!KEY) {
  console.error("Set GB_KEY to a secret API key.");
  process.exit(1);
}

export function runTag(prefix) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `${prefix}-${stamp}`;
}

export async function call(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // The API allows 60 requests a minute; wait the window out.
    if (res.status === 429 && attempt < 6) {
      const wait = Number(res.headers.get("retry-after")) || 15;
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      throw new Error(
        `${method} ${route} → ${res.status}: ${json.message ?? text}`,
      );
    }
    return json;
  }
}

const arms = (count) =>
  Array.from({ length: count }, (_, i) => ({
    key: String(i),
    name: i === 0 ? "Control" : `Variation ${i}`,
  }));

export async function createExperiment(run, slug, variationCount) {
  const trackingKey = `${run}-${slug}`;
  const { experiment } = await call("POST", "/v1/experiments", {
    trackingKey,
    name: `${run} ${slug}`,
    hypothesis: `Seeded by the Setup-page harness (${slug}).`,
    datasourceId: DATASOURCE,
    assignmentQueryId: ASSIGNMENT_QUERY,
    variations: arms(variationCount),
  });
  return experiment;
}

export const refValues = (experiment, values) =>
  experiment.variations.map((v, i) => ({
    variationId: v.variationId,
    value: values[i],
  }));

export async function createLinkedFlag(run, slug, experiment, flag) {
  const id = `${run}-${slug}`;
  await call("POST", "/v2/features", {
    id,
    owner: "",
    valueType: flag.valueType,
    defaultValue: flag.defaultValue,
    ...(flag.baseConfig && { baseConfig: flag.baseConfig }),
    rules: [
      {
        type: "experiment-ref",
        experimentId: experiment.id,
        variations: refValues(experiment, flag.values),
        ...(flag.sparse && { sparse: true }),
        allEnvironments: true,
      },
    ],
  });
  return id;
}

// An open draft that changes the experiment's values, beside what is live.
export async function stageDraftValues(
  featureId,
  experiment,
  values,
  { beside = false } = {},
) {
  // `beside` opens another draft past the org's per-flag draft cap.
  const { revision } = await call(
    "POST",
    `/v2/features/${featureId}/revisions${beside ? "?overrideDraftLimit=true" : ""}`,
    {},
  );
  const rule = findRefRule(revision, experiment.id);
  await call(
    "PUT",
    `/v2/features/${featureId}/revisions/${revision.version}/rules/${rule.id}`,
    { rule: { variations: refValues(experiment, values) } },
  );
  return revision.version;
}

function refRuleState(revision, experimentId) {
  const rule = findRefRule(revision, experimentId);
  return rule
    ? { values: rule.variations.map((v) => v.value), sparse: !!rule.sparse }
    : null;
}

export async function inspectExperiment(experimentId) {
  const { experiment } = await call("GET", `/v1/experiments/${experimentId}`);
  const phase = experiment.phases?.[experiment.phases.length - 1];
  const out = {
    experiment: {
      id: experiment.id,
      status: experiment.status,
      hypothesis: experiment.hypothesis,
      description: experiment.description,
      variations: experiment.variations.map((v) => `${v.key}:${v.name}`),
      weights: phase?.trafficSplit?.map((t) => t.weight),
    },
    flags: [],
  };
  for (const featureId of experiment.linkedFeatures ?? []) {
    const { feature } = await call("GET", `/v2/features/${featureId}`);
    const { revisions } = await call(
      "GET",
      `/v2/features/${featureId}/revisions?limit=10`,
    );
    const drafts = revisions.filter((r) =>
      ["draft", "pending-review", "changes-requested", "approved"].includes(
        r.status,
      ),
    );
    out.flags.push({
      id: featureId,
      valueType: feature.valueType,
      defaultValue: feature.defaultValue,
      managedBy: feature.managedBy ?? null,
      live: {
        version: feature.revision?.version ?? null,
        ...refRuleState(feature, experiment.id),
      },
      drafts: drafts.map((d) => ({
        version: d.version,
        status: d.status,
        valueType: d.metadata?.valueType ?? null,
        defaultValue: d.defaultValue,
        ...refRuleState(d, experiment.id),
      })),
    });
  }
  return out;
}

export const inDays = (days) =>
  new Date(Date.now() + days * 864e5).toISOString();

// Ticks the manual pre-launch items so `/start` only meets the real gates.
export async function startExperiment(experimentId) {
  const { checklistItems } = await call(
    "GET",
    `/v1/experiments/${experimentId}/start-checklist`,
  );
  const manual = checklistItems
    .filter((i) => i.manual && i.status !== "complete")
    .map((i) => i.key);
  if (manual.length) {
    await call(
      "POST",
      `/v1/experiments/${experimentId}/start-checklist/manual/complete`,
      { keys: manual },
    );
  }
  return call("POST", `/v1/experiments/${experimentId}/start`, {});
}
