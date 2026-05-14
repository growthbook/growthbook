import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import * as path from "path";
import { z } from "zod";
import {
  ContextualBanditInterface,
  ContextualBanditQueryInterface,
  contextualBanditEventValidator,
} from "shared/validators";
import {
  getContextualBanditSettingsForStatsEngine,
  parseContextualBanditResultForEvent,
  runContextualBanditStatsEngine,
} from "back-end/src/services/stats";
import { statsServerPool } from "back-end/src/services/python";

jest.mock("back-end/src/services/python", () => ({
  statsServerPool: {
    acquire: jest.fn(),
    release: jest.fn(),
  },
}));

const fixturePath = path.join(
  __dirname,
  "..",
  "fixtures",
  "contextual-bandit",
  "mock-input.json",
);
const statsPath = path.join(__dirname, "..", "..", "..", "stats");

const contextualBanditStatsEngineInputSchema = z.strictObject({
  settings: z.strictObject({
    var_names: z.array(z.string()),
    var_ids: z.array(z.string()),
    reweight: z.boolean(),
    decision_metric: z.string(),
    bandit_weights_seed: z.number(),
    contextual_attributes: z.array(z.string()),
    current_weights_by_context: z.record(z.string(), z.array(z.number())),
    max_leaves: z.number(),
    min_users_per_leaf: z.number(),
    tree_model: z.enum(["regression_tree", "linear_thompson"]),
    top_two: z.boolean(),
  }),
  rows: z.array(
    z.strictObject({
      variation: z.string(),
      context_id: z.string(),
      main_sum: z.number(),
      main_sum_squares: z.number(),
      n: z.number(),
    }),
  ),
});

describe("contextual bandit stats seam", () => {
  it("serializes contextual bandit settings from CB, CBAQ, and latest CBE state", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const cb = {
      id: "cb_test",
      organization: "org",
      dateCreated: date,
      dateUpdated: date,
      experiment: "exp_test",
      cbaqId: "cbaq_test",
      contextualAttributes: ["country"],
      maxContexts: 300,
      treeModel: "regression_tree",
      minUsersPerLeaf: 25,
      maxLeaves: 4,
      holdoutPercent: 0,
      stickyBucketing: false,
      canonicalFormVersion: "v1",
      phases: [
        {
          phase: 0,
          seed: 321,
          currentLeafWeights: [
            {
              contextId: "ctx_a",
              condition: { country: "US" },
              weights: [0.4, 0.6],
            },
          ],
        },
      ],
    } as ContextualBanditInterface;
    const cbaq = {
      id: "cbaq_test",
      organization: "org",
      dateCreated: date,
      dateUpdated: date,
      owner: "",
      name: "query",
      description: "",
      datasource: "ds_test",
      projects: [],
      userIdType: "user_id",
      query: "select * from assignments",
      attributes: [{ attribute: "country", kind: "categorical" }],
      topValuesLookbackDays: 30,
    } as ContextualBanditQueryInterface;

    const settings = getContextualBanditSettingsForStatsEngine(
      cb,
      cbaq,
      null,
      0,
      {
        variations: [
          { id: "0", name: "Control", weight: 0.5 },
          { id: "1", name: "Treatment", weight: 0.5 },
        ],
        decisionMetric: "met_revenue",
      },
    );

    expect(settings).toMatchObject({
      var_ids: ["0", "1"],
      var_names: ["Control", "Treatment"],
      decision_metric: "met_revenue",
      bandit_weights_seed: 321,
      contextual_attributes: ["country"],
      current_weights_by_context: { ctx_a: [0.4, 0.6] },
      max_leaves: 4,
      min_users_per_leaf: 25,
      tree_model: "regression_tree",
    });
  });

  it("uses the in-process stats engine path for contextual bandit inputs", async () => {
    const input = contextualBanditStatsEngineInputSchema.parse(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const server = {
      call: jest.fn().mockResolvedValue({
        result: [],
        tree_summary: { model: "regression_tree", nodes: [], metadata: {} },
        update_message: "ok",
        error: null,
      }),
    };
    (statsServerPool.acquire as jest.Mock).mockResolvedValue(server);

    await runContextualBanditStatsEngine(input);

    expect(server.call).toHaveBeenCalledWith(input);
    expect(statsServerPool.release).toHaveBeenCalledWith(server);
  });

  it("round-trips TS JSON through Python mock stats and parses a CBE write shape", () => {
    const input = contextualBanditStatsEngineInputSchema.parse(
      JSON.parse(readFileSync(fixturePath, "utf8")),
    );
    const serialized = JSON.stringify(input);
    const python = spawnSync(
      "bash",
      [
        "-lc",
        [
          ". $(poetry env info --path)/bin/activate",
          "GROWTHBOOK_CB_MOCK_STATS=1 python -c \"import json, sys; from gbstats.gbstats import process_contextual_bandit_results; payload = json.loads(sys.stdin.read()); print(json.dumps(process_contextual_bandit_results(payload['rows'], payload['settings']), allow_nan=True))\"",
        ].join("\n"),
      ],
      {
        cwd: statsPath,
        env: process.env,
        input: serialized,
        encoding: "utf8",
      },
    );

    expect(python.status).toBe(0);
    const statsResult = JSON.parse(python.stdout);
    const eventFields = parseContextualBanditResultForEvent(
      statsResult,
      input.rows,
      input.settings,
    );

    const event = contextualBanditEventValidator.parse({
      id: "cbe_roundtrip",
      organization: "org_roundtrip",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      experiment: "exp_roundtrip",
      phase: 0,
      contextualBanditSnapshotId: "cbs_roundtrip",
      contextualBanditQueryId: "cbaq_roundtrip",
      canonicalFormVersion: "v1",
      treeModel: input.settings.tree_model,
      holdoutPercent: 0,
      ...eventFields,
    });

    expect(event.contextResults).toHaveLength(12);
    expect(event.contextResults[0].variations).toHaveLength(2);
    expect(event.treeSummary.model).toBe("regression_tree");
    expect(event.totalUsersThisTick).toBe(
      input.rows.reduce((sum, row) => sum + row.n, 0),
    );
  });
});
