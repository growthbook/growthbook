import type {
  OptimizelyData,
  OptimizelyMetric,
  OptimizelyRule,
} from "./optimizely-importing";

// Stand-in for an Optimizely project, used by `?dummy=true` on the importer
// page. Covers what imports cleanly and what shows as "Can't import".

const audience = (id: number, name: string, conditions: unknown) => ({
  id,
  name,
  description: `${name} (dummy audience)`,
  conditions: JSON.stringify(conditions),
});

const attribute = (name: string, match_type: string, value?: unknown) => ({
  type: "custom_attribute",
  name,
  match_type,
  value,
});

const metric = (
  aggregator: string,
  event_id: number | null,
  extra: Partial<OptimizelyMetric> = {},
): OptimizelyMetric => ({
  aggregator,
  event_id,
  scope: "visitor",
  winning_direction: "increasing",
  ...extra,
});

const delivery = (
  id: number,
  key: string,
  name: string,
  variation: string,
  extra: Partial<OptimizelyRule> = {},
): OptimizelyRule => ({
  id,
  key,
  name,
  type: "targeted_delivery",
  enabled: true,
  status: "running",
  percentage_included: 10000,
  audience_conditions: [],
  variations: { [variation]: { key: variation, percentage_included: 10000 } },
  ...extra,
});

const abTest = (
  id: number,
  key: string,
  name: string,
  metrics: OptimizelyMetric[],
): OptimizelyRule => ({
  id,
  key,
  name,
  type: "a/b",
  enabled: true,
  status: "running",
  percentage_included: 10000,
  audience_conditions: [],
  variations: {
    off: { key: "off", name: "Off", percentage_included: 5000 },
    on: { key: "on", name: "On", percentage_included: 5000 },
  },
  metrics,
});

const ON_OFF = [
  { key: "off", name: "Off", enabled: false },
  { key: "on", name: "On", enabled: true },
];

export const DUMMY_OPTIMIZELY_DATA: OptimizelyData = {
  project: { id: 1, name: "Dummy Shop", is_flags_enabled: true },
  environments: [
    { id: 1, key: "production", name: "Production", is_primary: true },
    { id: 2, key: "staging", name: "Staging", priority: 2 },
    { id: 3, key: "development", name: "Development", priority: 3 },
  ],
  audiences: [
    audience(101, "Pro plan", [
      "and",
      ["or", ["or", attribute("plan", "exact", "pro")]],
    ]),
    audience(102, "Adults in the US", [
      "and",
      attribute("age", "ge", 18),
      attribute("country", "exact", "US"),
    ]),
    audience(103, "Not on the legacy app", [
      "not",
      attribute("app_version", "semver_lt", "3.0.0"),
    ]),
    audience(104, "Real-time segment", [
      "and",
      { type: "third_party_dimension", name: "vip", match_type: "qualified" },
    ]),
  ],
  events: [
    { id: 201, key: "purchase", name: "Purchase" },
    { id: 202, key: "add_to_cart", name: "Add to Cart" },
    { id: 203, key: "page_view", name: "Page View" },
  ],
  flags: [
    {
      id: 301,
      key: "new_checkout",
      name: "New Checkout",
      description: "One-page checkout flow",
      variations: ON_OFF,
      rulesets: {
        production: {
          enabled: true,
          default_variation_key: "off",
          rule_priorities: ["checkout_test", "pro_rollout", "everyone"],
          rules: {
            checkout_test: abTest(401, "checkout_test", "Checkout Test", [
              metric("unique", 201),
              metric("count", 202),
              metric("sum", 201, { field: "revenue" }),
              metric("sum", 201, { field: "value", scope: "event" }),
              metric("ratio", null, {
                display_title: "Purchases per cart add",
                metrics: [
                  { aggregator: "count", event_id: 201, role: "numerator" },
                  { aggregator: "unique", event_id: 202, role: "denominator" },
                ],
              }),
              metric("unique", 201, {
                display_title: "Large shoe purchases",
                event_properties: {
                  filter: {
                    combine_operator: "and",
                    conditions: [
                      {
                        name: "category",
                        operator: "equal_to",
                        value: "shoes",
                      },
                      { name: "size", operator: "greater_than", value: 10 },
                    ],
                  },
                },
              }),
              metric("unique", 203, { scope: "session" }),
            ]),
            pro_rollout: delivery(402, "pro_rollout", "Pro Rollout", "on", {
              percentage_included: 2500,
              audience_conditions: [
                "and",
                { audience_id: 101 },
                ["not", { audience_id: 103 }],
              ],
              allow_list: {
                a: { user_id: "qa-user-1", variation: { key: "on" } },
              },
            }),
            everyone: delivery(403, "everyone", "Everyone Else", "on", {
              status: "paused",
            }),
          },
        },
        staging: { enabled: true, default_variation_key: "on" },
        development: { enabled: false, default_variation_key: "off" },
      },
    },
    {
      id: 302,
      key: "search_config",
      name: "Search Config",
      variable_definitions: {
        algorithm: { key: "algorithm", type: "string", default_value: "bm25" },
        page_size: { key: "page_size", type: "integer", default_value: "20" },
        boosts: { key: "boosts", type: "json", default_value: "{}" },
      },
      variations: [
        ...ON_OFF,
        {
          key: "semantic",
          name: "Semantic",
          enabled: true,
          variables: {
            algorithm: { value: "semantic" },
            boosts: { value: '{"title":2}' },
          },
        },
      ],
      rulesets: {
        production: {
          enabled: true,
          default_variation_key: "on",
          rule_priorities: ["us_adults"],
          rules: {
            us_adults: delivery(404, "us_adults", "US Adults", "semantic", {
              audience_conditions: ["or", { audience_id: 102 }],
            }),
          },
        },
        staging: { enabled: true, default_variation_key: "semantic" },
        development: { enabled: true, default_variation_key: "on" },
      },
    },
    {
      id: 303,
      key: "homepage_hero",
      name: "Homepage Hero",
      variations: ON_OFF,
      rulesets: {
        production: {
          enabled: true,
          default_variation_key: "off",
          rule_priorities: ["hero_bandit"],
          rules: {
            hero_bandit: {
              ...delivery(405, "hero_bandit", "Hero Bandit", "on"),
              type: "multi_armed_bandit",
            },
          },
        },
      },
    },
  ],
};
