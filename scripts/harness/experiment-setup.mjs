#!/usr/bin/env node
// Seeds and inspects Setup-page save scenarios over the REST API, for driving
// the page in a browser. Nothing is cleaned up, so every run can be audited.
//
//   GB_KEY=secret_... node scripts/harness/experiment-setup.mjs seed [slug ...]
//   GB_KEY=secret_... node scripts/harness/experiment-setup.mjs inspect <run>
//
// GB_API (default http://localhost:3100/api) and GB_APP (default
// http://localhost:3000) point it at another dev server. SEED_DATASOURCE and
// SEED_ASSIGNMENT_QUERY pick the analysis source new experiments use.

import fs from "node:fs";
import path from "node:path";
import {
  APP,
  RUNS_DIR,
  call,
  createExperiment,
  createLinkedFlag,
  inDays,
  inspectExperiment,
  refValues,
  runTag,
  stageDraftValues,
  startExperiment,
} from "./lib.mjs";

const SCENARIOS = [
  {
    slug: "managed-string",
    checks: [
      "Type selector offers String/JSON/Number; Boolean disabled (3 variations)",
      'String → JSON converts values to {"value": …}; save; inspect: draft valueType json, defaultValue = control',
    ],
    about: "Managed string flag, three variations, pending draft",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 3);
      await call("POST", `/v1/experiments/${exp.id}/variation-values`, {
        valueType: "string",
        values: refValues(exp, ["control", "blue", "green"]),
      });
      return exp;
    },
  },
  {
    slug: "managed-json",
    checks: [
      "Sparse off expands Variation 1 onto control; control unchanged; inspect: sparse false",
      "Editing control moves the base the other variations patch onto",
    ],
    about: "Managed JSON flag with sparse values patching onto control",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await call("POST", `/v1/experiments/${exp.id}/variation-values`, {
        valueType: "json",
        sparse: true,
        values: refValues(exp, [
          JSON.stringify({ color: "gray", size: "md" }),
          JSON.stringify({ color: "violet" }),
        ]),
      });
      return exp;
    },
  },
  {
    slug: "unmanaged-live",
    checks: [
      "No type selector (unmanaged)",
      "Edit Variation 1, save; inspect: new draft v2, live unchanged",
    ],
    about: "Unmanaged number flag, live only (saving starts a draft)",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await createLinkedFlag(run, this.slug, exp, {
        valueType: "number",
        defaultValue: "0",
        values: ["0", "10"],
      });
      return exp;
    },
  },
  {
    slug: "unmanaged-draft",
    checks: [
      "Edit writes into draft v2, no v3",
      "Stage an edit, change the draft over REST, Save → 409 “changed since you loaded it”; Save again → still 409; inspect: other edit intact",
      "Discard clears the bar and restores the loaded value",
    ],
    about: "Unmanaged string flag with an open draft changing the values",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      const id = await createLinkedFlag(run, this.slug, exp, {
        valueType: "string",
        defaultValue: "off",
        values: ["off", "on"],
      });
      await stageDraftValues(id, exp, ["off", "on-draft"]);
      return exp;
    },
  },
  {
    slug: "multi-flag",
    checks: [
      "Edit both flags, Save → one POST /changes; inspect: a draft on each flag",
      "Malformed JSON → no request, value repaired in place, “save again”; second Save lands valid JSON",
    ],
    about: "Two unmanaged flags on one experiment: sparse JSON and boolean",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await createLinkedFlag(run, `${this.slug}-json`, exp, {
        valueType: "json",
        defaultValue: JSON.stringify({ layout: "list", density: "normal" }),
        sparse: true,
        values: [JSON.stringify({}), JSON.stringify({ layout: "grid" })],
      });
      await createLinkedFlag(run, `${this.slug}-bool`, exp, {
        valueType: "boolean",
        defaultValue: "false",
        values: ["false", "true"],
      });
      return exp;
    },
  },
  {
    slug: "config-backed",
    checks: [
      "Cells show the Config override editor",
      "Edit an override, save; inspect: new draft, sparse stays true",
    ],
    about:
      "Unmanaged JSON flag backed by a Config; values are override patches",
    async seed(run) {
      const configKey = `${run}-theme`;
      await call("POST", "/v1/configs", {
        key: configKey,
        name: `${run} theme`,
        value: { color: "gray", size: "md" },
      });
      const exp = await createExperiment(run, this.slug, 2);
      // REST names the config in `baseConfig`; the values are bare patches.
      await createLinkedFlag(run, this.slug, exp, {
        valueType: "json",
        baseConfig: configKey,
        defaultValue: "{}",
        sparse: true,
        values: ["{}", JSON.stringify({ color: "violet" })],
      });
      return exp;
    },
  },
  {
    slug: "wide",
    checks: [
      "Five variations: value cells wrap in step with the variation cards",
      "Edit targeting (Included %) and a value together, Save → both land",
    ],
    about: "Unmanaged flag across five variations",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 5);
      await createLinkedFlag(run, this.slug, exp, {
        valueType: "number",
        defaultValue: "0",
        values: ["0", "1", "2", "3", "4"],
      });
      return exp;
    },
  },
  {
    slug: "gate-schedule-lock",
    checks: [
      "Draft v2 is armed to publish in 2 days with edits locked",
      "Edit a value, Save → refused as locked for a scheduled publish (ideally the row is read-only)",
    ],
    about: "Unmanaged draft locked for a scheduled publish",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      const id = await createLinkedFlag(run, this.slug, exp, {
        valueType: "string",
        defaultValue: "off",
        values: ["off", "on"],
      });
      const version = await stageDraftValues(id, exp, ["off", "scheduled"]);
      await call(
        "POST",
        `/v2/features/${id}/revisions/${version}/schedule-publish`,
        {
          scheduledPublishAt: inDays(2),
          lockEdits: true,
        },
      );
      return exp;
    },
  },
  {
    slug: "gate-merge-conflict",
    checks: [
      "Draft v2 conflicts with live v3 (same rule changed on both)",
      "The page says the draft has a merge conflict",
      "Edit a value, Save → lands in v2; publishing still needs the conflict resolved",
    ],
    about: "Unmanaged draft whose rule live has since changed",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      const id = await createLinkedFlag(run, this.slug, exp, {
        valueType: "string",
        defaultValue: "off",
        values: ["off", "on"],
      });
      await stageDraftValues(id, exp, ["off", "draft-side"]);
      const other = await stageDraftValues(id, exp, ["off", "live-side"], {
        beside: true,
      });
      await call("POST", `/v2/features/${id}/revisions/${other}/publish`, {});
      return exp;
    },
  },
  {
    slug: "gate-scheduled-start",
    checks: [
      "Start is scheduled 3 days out",
      "Once the start is approved, value rows stay editable with the draft note",
    ],
    about: "Managed flag on an experiment with a pending scheduled start",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await call("POST", `/v1/experiments/${exp.id}/variation-values`, {
        valueType: "string",
        values: refValues(exp, ["a", "b"]),
      });
      await call("PUT", `/v1/experiments/${exp.id}/schedule`, {
        startAt: inDays(3),
      });
      return exp;
    },
  },
  {
    slug: "gate-running",
    checks: [
      "Experiment is running, flag rule live",
      "Value rows are editable with a note that saving makes a draft; Save → new draft, live unchanged",
    ],
    about: "Running experiment with an unmanaged flag",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await createLinkedFlag(run, this.slug, exp, {
        valueType: "string",
        defaultValue: "off",
        values: ["off", "on"],
      });
      await startExperiment(exp.id);
      return exp;
    },
  },
  {
    slug: "gate-stopped",
    checks: [
      "Experiment is stopped (inconclusive)",
      "Value rows are editable with the draft note; Save → new draft, live unchanged",
    ],
    about: "Stopped experiment with an unmanaged flag",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await createLinkedFlag(run, this.slug, exp, {
        valueType: "string",
        defaultValue: "off",
        values: ["off", "on"],
      });
      await startExperiment(exp.id);
      await call("POST", `/v1/experiments/${exp.id}/stop`, {
        results: "inconclusive",
      });
      return exp;
    },
  },
  {
    slug: "gate-approval",
    checks: [
      "As the second persona, approve the pending values",
      "As admin, edit a value and Save → the approval clears only if a review rule resets on change",
    ],
    about: "Managed flag with a pending draft awaiting another reviewer",
    async seed(run) {
      const exp = await createExperiment(run, this.slug, 2);
      await call("POST", `/v1/experiments/${exp.id}/variation-values`, {
        valueType: "string",
        values: refValues(exp, ["a", "b"]),
      });
      return exp;
    },
  },
];

async function seed() {
  const run = runTag("hx");
  const manifest = { run, createdAt: new Date().toISOString(), scenarios: [] };
  const only = process.argv.slice(3);
  for (const scenario of SCENARIOS) {
    if (only.length && !only.includes(scenario.slug)) continue;
    try {
      const exp = await scenario.seed(run);
      manifest.scenarios.push({
        slug: scenario.slug,
        about: scenario.about,
        experimentId: exp.id,
        url: `${APP}/experiment/${exp.id}#overview`,
        checks: scenario.checks,
      });
      console.log(`✓ ${scenario.slug.padEnd(16)} ${APP}/experiment/${exp.id}`);
      scenario.checks.forEach((c) => console.log(`    - ${c}`));
    } catch (e) {
      manifest.scenarios.push({ slug: scenario.slug, error: e.message });
      console.log(`✗ ${scenario.slug.padEnd(16)} ${e.message}`);
    }
  }
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(RUNS_DIR, `${run}.json`),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`\nRun ${run}. Inspect with: inspect ${run}`);
}

async function inspect(target) {
  const manifestPath = path.join(RUNS_DIR, `${target}.json`);
  const ids = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
        .scenarios.filter((s) => s.experimentId)
        .map((s) => [s.slug, s.experimentId])
    : [[target, target]];
  for (const [slug, id] of ids) {
    console.log(`\n## ${slug}`);
    console.log(JSON.stringify(await inspectExperiment(id), null, 2));
  }
}

const [command, arg] = process.argv.slice(2);
if (command === "seed") await seed();
else if (command === "inspect" && arg) await inspect(arg);
else {
  console.error("Usage: seed [slug ...] | inspect <run or experiment id>");
  process.exit(1);
}
