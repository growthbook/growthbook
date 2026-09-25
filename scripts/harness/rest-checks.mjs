#!/usr/bin/env node
// Replays the Setup-page harness cases, and the gates around them, through the
// public REST API alone. Each case seeds its own objects under a fresh run tag
// and reports PASS, FAIL, GAP (a known REST difference from the page) or INFO
// (behaviour recorded without a verdict). Nothing is cleaned up.
//
//   GB_KEY=secret_... node scripts/harness/rest-checks.mjs [case ...]

import fs from "node:fs";
import path from "node:path";
import {
  RUNS_DIR,
  call,
  createExperiment,
  createLinkedFlag,
  inspectExperiment,
  inDays,
  refValues,
  runTag,
  stageDraftValues,
  startExperiment,
} from "./lib.mjs";

const run = runTag("hxr");

class Verdict extends Error {
  constructor(status, note) {
    super(note);
    this.status = status;
  }
}
const gap = (note) => {
  throw new Verdict("GAP", note);
};
const info = (note) => {
  throw new Verdict("INFO", note);
};
function expect(ok, note) {
  if (!ok) throw new Verdict("FAIL", note);
}

async function refused(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e.message;
  }
}

async function flagState(experimentId, featureId) {
  const { flags } = await inspectExperiment(experimentId);
  return flags.find((f) => f.id === featureId);
}

async function refRuleId(featureId, version, experimentId) {
  const { revision } = await call(
    "GET",
    `/v2/features/${featureId}/revisions/${version}`,
  );
  return revision.rules.find(
    (r) => r.type === "experiment-ref" && r.experimentId === experimentId,
  ).id;
}

async function putRuleValues(featureId, version, experiment, values, extra) {
  const ruleId = await refRuleId(featureId, version, experiment.id);
  return call(
    "PUT",
    `/v2/features/${featureId}/revisions/${version}/rules/${ruleId}`,
    { rule: { variations: refValues(experiment, values), ...extra } },
  );
}

async function managedExperiment(slug, count, body) {
  const exp = await createExperiment(run, slug, count);
  await call("POST", `/v1/experiments/${exp.id}/variation-values`, {
    ...body,
    values: refValues(exp, body.values),
  });
  const { experiment } = await call("GET", `/v1/experiments/${exp.id}`);
  return { exp: experiment, featureId: experiment.linkedFeatures[0] };
}

async function unmanagedExperiment(slug, flag, { draft } = {}) {
  const exp = await createExperiment(run, slug, flag.values.length);
  const featureId = await createLinkedFlag(run, slug, exp, flag);
  if (draft) await stageDraftValues(featureId, exp, draft);
  return { exp, featureId };
}

const CASES = {
  async "managed-type-change"() {
    const { exp, featureId } = await managedExperiment("m-type", 3, {
      valueType: "string",
      values: ["control", "blue", "green"],
    });
    const json = ["control", "blue", "green"].map((value) =>
      JSON.stringify({ value }),
    );
    await call("PUT", `/v1/experiments/${exp.id}/variation-values`, {
      valueType: "json",
      values: refValues(exp, json),
    });
    const [draft] = (await flagState(exp.id, featureId)).drafts;
    expect(draft?.valueType === "json", `draft valueType ${draft?.valueType}`);
    expect(
      JSON.parse(draft.defaultValue).value === "control",
      `default ${draft.defaultValue} is not control`,
    );
  },

  async "managed-sparse-off"() {
    const control = JSON.stringify({ color: "gray", size: "md" });
    const { exp, featureId } = await managedExperiment("m-sparse", 2, {
      valueType: "json",
      sparse: true,
      values: [control, JSON.stringify({ color: "violet" })],
    });
    await call("PUT", `/v1/experiments/${exp.id}/variation-values`, {
      sparse: false,
      values: refValues(exp, [
        control,
        JSON.stringify({ color: "violet", size: "md" }),
      ]),
    });
    const [draft] = (await flagState(exp.id, featureId)).drafts;
    expect(draft?.sparse === false, `sparse is ${draft?.sparse}`);
    expect(draft.defaultValue === control, "control is no longer the default");
  },

  async "unmanaged-live-starts-draft"() {
    const { exp, featureId } = await unmanagedExperiment(
      "u-live",
      { valueType: "number", defaultValue: "0", values: ["0", "10"] },
      { draft: ["0", "25"] },
    );
    const state = await flagState(exp.id, featureId);
    expect(
      state.live.values.join() === "0,10",
      `live moved: ${state.live.values}`,
    );
    expect(
      state.drafts.length === 1 && state.drafts[0].values.join() === "0,25",
      `drafts ${JSON.stringify(state.drafts)}`,
    );
  },

  async "unmanaged-draft-edited-in-place"() {
    const { exp, featureId } = await unmanagedExperiment(
      "u-draft",
      { valueType: "string", defaultValue: "off", values: ["off", "on"] },
      { draft: ["off", "on-draft"] },
    );
    await putRuleValues(featureId, 2, exp, ["off", "on-edited"]);
    const { drafts } = await flagState(exp.id, featureId);
    expect(
      drafts.length === 1 && drafts[0].version === 2,
      `drafts ${drafts.map((d) => d.version)}`,
    );
    expect(drafts[0].values[1] === "on-edited", `value ${drafts[0].values}`);
  },

  async "concurrent-draft-edit"() {
    const { exp, featureId } = await unmanagedExperiment(
      "u-race",
      { valueType: "string", defaultValue: "off", values: ["off", "on"] },
      { draft: ["off", "base"] },
    );
    await putRuleValues(featureId, 2, exp, ["off", "theirs"]);
    // A writer that read "base" and never saw "theirs".
    await putRuleValues(featureId, 2, exp, ["off", "mine"]);
    const { drafts } = await flagState(exp.id, featureId);
    if (drafts[0].values[1] === "mine") {
      gap(
        "no compare-and-set on rule writes: a stale writer silently replaced another edit (the page refuses with 409)",
      );
    }
  },

  async "multi-flag-not-atomic"() {
    const exp = await createExperiment(run, "u-multi", 2);
    const good = await createLinkedFlag(run, "u-multi-a", exp, {
      valueType: "string",
      defaultValue: "a",
      values: ["a", "b"],
    });
    const bad = await createLinkedFlag(run, "u-multi-b", exp, {
      valueType: "number",
      defaultValue: "0",
      values: ["0", "1"],
    });
    await stageDraftValues(good, exp, ["a", "b2"]);
    const why = await refused(
      stageDraftValues(bad, exp, ["0", "not-a-number"]),
    );
    expect(!!why, "an invalid number was accepted");
    const a = await flagState(exp.id, good);
    if (a.drafts[0]?.values[1] === "b2") {
      gap(
        `two flags are two requests: the first landed while the second was refused (${why})`,
      );
    }
  },

  async "malformed-json-unmanaged"() {
    const { exp, featureId } = await unmanagedExperiment(
      "u-json",
      {
        valueType: "json",
        defaultValue: "{}",
        values: ["{}", JSON.stringify({ layout: "grid" })],
      },
      { draft: ["{}", JSON.stringify({ layout: "list" })] },
    );
    const why = await refused(
      putRuleValues(featureId, 2, exp, ["{}", '{"layout":"grid"}}']),
    );
    if (why) {
      expect(/invalid JSON/.test(why), `refused for another reason: ${why}`);
      return;
    }
    const { drafts } = await flagState(exp.id, featureId);
    let valid = true;
    try {
      JSON.parse(drafts[0].values[1]);
    } catch {
      valid = false;
    }
    expect(valid, `stored malformed JSON: ${drafts[0].values[1]}`);
  },

  async "malformed-json-managed"() {
    const { exp, featureId } = await managedExperiment("m-json", 2, {
      valueType: "json",
      values: ["{}", JSON.stringify({ a: 1 })],
    });
    const why = await refused(
      call("PUT", `/v1/experiments/${exp.id}/variation-values`, {
        values: refValues(exp, ["{}", '{"a":1}}']),
      }),
    );
    if (why) return;
    const [draft] = (await flagState(exp.id, featureId)).drafts;
    let valid = true;
    try {
      JSON.parse(draft.values[1]);
    } catch {
      valid = false;
    }
    expect(valid, `stored malformed JSON: ${draft.values[1]}`);
  },

  async "config-backed-override"() {
    const configKey = `${run}-theme`;
    await call("POST", "/v1/configs", {
      key: configKey,
      name: `${run} theme`,
      value: { color: "gray", size: "md" },
    });
    const { exp, featureId } = await unmanagedExperiment(
      "u-config",
      {
        valueType: "json",
        baseConfig: configKey,
        defaultValue: "{}",
        sparse: true,
        values: ["{}", JSON.stringify({ color: "violet" })],
      },
      { draft: ["{}", JSON.stringify({ color: "teal" })] },
    );
    const { drafts } = await flagState(exp.id, featureId);
    expect(drafts[0]?.sparse === true, "sparse was dropped");
    expect(
      JSON.parse(drafts[0].values[1]).color === "teal",
      `value ${drafts[0].values[1]}`,
    );
  },

  async "gate-schedule-lock"() {
    const { exp, featureId } = await unmanagedExperiment(
      "g-lock",
      { valueType: "string", defaultValue: "off", values: ["off", "on"] },
      { draft: ["off", "scheduled"] },
    );
    await call(
      "POST",
      `/v2/features/${featureId}/revisions/2/schedule-publish`,
      { scheduledPublishAt: inDays(2), lockEdits: true },
    );
    const why = await refused(
      putRuleValues(featureId, 2, exp, ["off", "sneaked-in"]),
    );
    expect(!!why, "edited a draft locked for a scheduled publish");
    expect(/locked|schedule/i.test(why), `refused for another reason: ${why}`);
  },

  async "gate-merge-conflict"() {
    const { exp, featureId } = await unmanagedExperiment(
      "g-merge",
      { valueType: "string", defaultValue: "off", values: ["off", "on"] },
      { draft: ["off", "draft-side"] },
    );
    const other = await stageDraftValues(featureId, exp, ["off", "live-side"], {
      beside: true,
    });
    await call(
      "POST",
      `/v2/features/${featureId}/revisions/${other}/publish`,
      {},
    );
    const status = await call(
      "GET",
      `/v2/features/${featureId}/revisions/2/merge-status`,
    );
    const editWhy = await refused(
      putRuleValues(featureId, 2, exp, ["off", "draft-side-2"]),
    );
    const publishWhy = await refused(
      call("POST", `/v2/features/${featureId}/revisions/2/publish`, {}),
    );
    expect(!!publishWhy, "a conflicting draft published over live");
    info(
      `merge-status ${JSON.stringify(status).slice(0, 120)}; editing the conflicted draft ${editWhy ? `refused (${editWhy})` : "allowed"}; publish refused (${publishWhy})`,
    );
  },

  async "gate-scheduled-start"() {
    const { exp } = await managedExperiment("g-start", 2, {
      valueType: "string",
      values: ["a", "b"],
    });
    await call("PUT", `/v1/experiments/${exp.id}/schedule`, {
      startAt: inDays(3),
    });
    const why = await refused(
      call("PUT", `/v1/experiments/${exp.id}/variation-values`, {
        values: refValues(exp, ["a", "b-late"]),
      }),
    );
    // Values land in a draft; what goes out at start is still gated by review.
    expect(!why, `value edit during a pending scheduled start refused: ${why}`);
  },

  async "gate-stopped-experiment"() {
    const { exp, featureId } = await unmanagedExperiment("g-stopped", {
      valueType: "string",
      defaultValue: "off",
      values: ["off", "on"],
    });
    await startExperiment(exp.id);
    await call("POST", `/v1/experiments/${exp.id}/stop`, {
      results: "inconclusive",
    });
    const why = await refused(
      stageDraftValues(featureId, exp, ["off", "on-2"]),
    );
    expect(!why, `drafting new values after stopping was refused: ${why}`);
    const state = await flagState(exp.id, featureId);
    expect(state.live.values[1] === "on", "a draft edit moved live");
  },

  async "gate-running-experiment"() {
    const { exp, featureId } = await unmanagedExperiment("g-running", {
      valueType: "string",
      defaultValue: "off",
      values: ["off", "on"],
    });
    const startWhy = await refused(startExperiment(exp.id));
    if (startWhy) info(`could not start the experiment: ${startWhy}`);
    const why = await refused(
      stageDraftValues(featureId, exp, ["off", "on-2"]),
    );
    // The page allows it too: values land in a draft and publish through review.
    expect(!why, `drafting new values while running was refused: ${why}`);
  },

  async "gate-approval-reset"() {
    const { exp, featureId } = await managedExperiment("g-approve", 2, {
      valueType: "string",
      values: ["a", "b"],
    });
    const approveWhy = await refused(
      call("POST", `/v1/experiments/${exp.id}/variation-values/submit-review`, {
        action: "approve",
        comment: "harness",
      }),
    );
    if (approveWhy) {
      info(
        `self-approval refused (${approveWhy}); run the approval from the second persona`,
      );
    }
    await call("PUT", `/v1/experiments/${exp.id}/variation-values`, {
      values: refValues(exp, ["a", "b-after-approval"]),
    });
    const [draft] = (await flagState(exp.id, featureId)).drafts;
    // Only a review rule with "reset review on change" clears an approval.
    info(`after an edit the draft is ${draft.status}`);
  },
};

const only = process.argv.slice(2);
const results = [];
for (const [name, fn] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  let status = "PASS";
  let note = "";
  try {
    await fn();
  } catch (e) {
    status = e instanceof Verdict ? e.status : "ERROR";
    note = e.message;
  }
  results.push({ name, status, note });
  console.log(`${status.padEnd(5)} ${name}${note ? ` — ${note}` : ""}`);
}
fs.mkdirSync(RUNS_DIR, { recursive: true });
fs.writeFileSync(
  path.join(RUNS_DIR, `${run}.json`),
  JSON.stringify(
    { run, createdAt: new Date().toISOString(), results },
    null,
    2,
  ),
);
console.log(`\nRun ${run}`);
