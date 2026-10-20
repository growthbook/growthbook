import type { AIChatMessage } from "shared/ai-chat";

// PROTOTYPE ONLY (set in review): the canned conversation the GrowthBot
// drawer opens onto with "Mock conversation" on (prototypeMockConversation
// .ts), served by the in-browser stub (prototypeAIStub.ts) as if it came
// from the server, so the drawer draws it with its real components:
//   1. A line chart: steps, then runExploration's result (the real
//      "Generated chart" card, with Open in Explorer and "Query & tool
//      response"), then a text reply.
//   2. A table: the same, as "Generated table", then a reply with a
//      markdown table.
//   3. A change to confirm: steps, a text summary, then the real "Apply
//      this change?" card from the conversation's pendingAction.
// The replies get the real thumbs up and down; "N steps completed" comes
// from the steps before each card. All data is made up.

export const MOCK_CONVERSATION_ID = "prototype_mock_conversation";
export const MOCK_CONVERSATION_TITLE = "Daily signups, by country";

const DAY = 24 * 60 * 60 * 1000;

// The last 30 days, oldest first, as YYYY-MM-DD.
function lastDays(count: number): string[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Array.from({ length: count }, (_, i) =>
    new Date(today.getTime() - (count - 1 - i) * DAY)
      .toISOString()
      .slice(0, 10),
  );
}

// Signups that climb, with a weekend dip and a peak two weeks ago.
function signupsFor(days: string[]): number[] {
  return days.map((day, i) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 0.78 : 1;
    const peak = i === days.length - 15 ? 1.35 : 1;
    return Math.round((310 + i * 6) * weekend * peak);
  });
}

const valueSignups = {
  type: "fact_table",
  name: "Signups",
  valueType: "count",
  valueColumn: null,
  unit: null,
  rowFilters: [],
};

function exploration(
  id: string,
  config: Record<string, unknown>,
  rows: { dimensions: (string | null)[]; values: number[] }[],
) {
  return {
    status: "success",
    snapshotId: `snp_${id}`,
    exploration: {
      id,
      status: "success",
      error: null,
      config,
      result: {
        rows: rows.map((r) => ({
          dimensions: r.dimensions,
          values: r.values.map((v, i) => ({
            metricId: `v${i}`,
            numerator: v,
            denominator: null,
          })),
        })),
      },
    },
  };
}

function chartResult() {
  const days = lastDays(30);
  const signups = signupsFor(days);
  return exploration(
    "exp_mock_signups_daily",
    {
      type: "fact_table",
      datasource: "ds_mock",
      chartType: "line",
      showAs: "total",
      dateRange: { predefined: "last30Days" },
      dimensions: [
        { dimensionType: "date", column: null, dateGranularity: "day" },
      ],
      dataset: {
        type: "fact_table",
        factTableId: "ftb_mock_events",
        values: [valueSignups],
      },
    },
    days.map((day, i) => ({ dimensions: [day], values: [signups[i]] })),
  );
}

const COUNTRIES: [string, number][] = [
  ["United States", 4210],
  ["United Kingdom", 1384],
  ["Germany", 1102],
  ["Canada", 893],
  ["Brazil", 761],
  ["India", 702],
];

function tableResult() {
  return exploration(
    "exp_mock_signups_country",
    {
      type: "fact_table",
      datasource: "ds_mock",
      chartType: "table",
      showAs: "total",
      dateRange: { predefined: "last30Days" },
      dimensions: [
        { dimensionType: "dynamic", column: "country", maxValues: 10 },
      ],
      dataset: {
        type: "fact_table",
        factTableId: "ftb_mock_events",
        values: [valueSignups],
      },
    },
    COUNTRIES.map(([country, n]) => ({
      dimensions: [country],
      values: [n],
    })),
  );
}

const json = (value: unknown) => JSON.stringify(value);

// The change the third turn asks to confirm (the conversation's
// pendingAction): the real card reads its method, path, summary and body.
export const MOCK_PENDING_ACTION = {
  id: "act_prototype_mock",
  method: "POST",
  path: "/api/v2/features",
  summary:
    "Create the feature flag **new-checkout-flow** (boolean, off by default) in the **Checkout** project.",
  body: {
    id: "new-checkout-flow",
    valueType: "boolean",
    defaultValue: "false",
    project: "prj_mock_checkout",
    description: "Gates the redesigned checkout flow.",
    tags: ["checkout"],
  },
  createdAt: Date.now(),
};

export function mockConversationMessages(): AIChatMessage[] {
  // Spread over the last hour, a few seconds a step.
  let ts = Date.now() - 60 * 60 * 1000;
  const next = () => (ts += 4000);
  let n = 0;
  const id = (role: string) => `proto_mock_${role}_${++n}`;

  const user = (content: string): AIChatMessage => ({
    role: "user",
    id: id("user"),
    ts: next(),
    content,
  });
  const say = (text: string): AIChatMessage => ({
    role: "assistant",
    id: id("assistant"),
    ts: next(),
    content: text,
  });
  const call = (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    text?: string,
  ): AIChatMessage => ({
    role: "assistant",
    id: id("assistant"),
    ts: next(),
    content: [
      ...(text ? [{ type: "text" as const, text }] : []),
      { type: "tool-call" as const, toolCallId, toolName, args },
    ],
  });
  const result = (
    toolCallId: string,
    toolName: string,
    value: unknown,
  ): AIChatMessage => ({
    role: "tool",
    id: id("tool"),
    ts: next(),
    content: [
      { type: "tool-result", toolCallId, toolName, result: json(value) },
    ],
  });

  return [
    // 1. The chart.
    user("Chart our daily signups for the last 30 days"),
    call(
      "tc_skill_1",
      "loadSkill",
      { name: "product-analytics" },
      "I'll look for an events table with signups.",
    ),
    result("tc_skill_1", "loadSkill", {
      summary: "Loaded the product-analytics skill.",
    }),
    call("tc_fact_1", "callApi", {
      method: "GET",
      path: "/api/v1/fact-tables",
    }),
    result("tc_fact_1", "callApi", {
      status: 200,
      body: {
        factTables: [{ id: "ftb_mock_events", name: "Events" }],
      },
    }),
    call("tc_explore_1", "runExploration", {
      factTableId: "ftb_mock_events",
      metric: "Signups",
      chartType: "line",
      dateRange: "last30Days",
      granularity: "day",
    }),
    result("tc_explore_1", "runExploration", chartResult()),
    say(
      "Signups have grown steadily over the last 30 days, from about **310 a day** to **480**. Weekends run roughly 20% lower, and there was a one-day spike two weeks ago, likely from the newsletter.\n\nWant me to break this down by country?",
    ),

    // 2. The table.
    user("Yes, break it down by country"),
    call("tc_explore_2", "runExploration", {
      factTableId: "ftb_mock_events",
      metric: "Signups",
      chartType: "table",
      dateRange: "last30Days",
      dimension: "country",
    }),
    result("tc_explore_2", "runExploration", tableResult()),
    say(
      "The **United States** accounts for almost half of all signups. Here are the top three against the previous 30 days:\n\n| Country | Signups | Previous 30 days | Change |\n| --- | ---: | ---: | ---: |\n| United States | 4,210 | 3,880 | +8.5% |\n| United Kingdom | 1,384 | 1,402 | −1.3% |\n| Germany | 1,102 | 951 | +15.9% |\n\nGermany is growing fastest.",
    ),

    // 3. The change to confirm (the card itself is the pendingAction).
    user(
      "Create a feature flag so we can roll out the new checkout flow there first",
    ),
    call(
      "tc_skill_3",
      "loadSkill",
      { name: "feature-flags" },
      "I'll set up a flag in the Checkout project.",
    ),
    result("tc_skill_3", "loadSkill", {
      summary: "Loaded the feature-flags skill.",
    }),
    call("tc_projects_3", "callApi", {
      method: "GET",
      path: "/api/v1/projects",
    }),
    result("tc_projects_3", "callApi", {
      status: 200,
      body: { projects: [{ id: "prj_mock_checkout", name: "Checkout" }] },
    }),
    say(
      "I'll create **new-checkout-flow**, a boolean flag that's off by default, in the **Checkout** project. Once it exists, I can add a rule that turns it on for Germany first.\n\nPlease confirm the change below.",
    ),
  ];
}
