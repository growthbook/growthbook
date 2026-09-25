/**
 * FAKE DATA for the Diagnostics stream's `?dummy=true` path only.
 *
 * The managed `feature_usage` table has no identity column and no attributes
 * yet. These stand in for them so the stream can be designed against them:
 * `unit_id` (the name docs/docs/features/diagnostics.mdx already uses) and
 * `attributes`, a flat JSON-serializable key/value object — the shape the SDK
 * evaluates against and the one Event Logs already carries
 * (`z.record(z.string(), z.unknown())` in shared/validators/event-logs.ts).
 *
 * When the real columns land, delete this file and its two uses in
 * getDummyDiagnosticsRows. Nothing else reads it.
 */

type AttributeValue = string | number | boolean;

interface DummyUser {
  unitId: string;
  /** Fixed per user, so the same person never changes country between rows. */
  attributes: Record<string, AttributeValue>;
  /** Share of rows; skewed so some users recur several times. */
  weight: number;
}

/**
 * Twelve users with mixed SDKs, hence mixed attribute sets: 0 to 20 keys, with
 * strings, booleans, numbers and dates-as-strings. Two send nothing at all —
 * server-side jobs and older SDKs commonly don't — which is the empty case the
 * UI has to handle, not an edge.
 */
const USERS: DummyUser[] = [
  {
    unitId: "user_104829",
    weight: 9,
    attributes: {
      id: "user_104829",
      deviceId: "d_7f3a91c2",
      loggedIn: true,
      employee: false,
      company: "Northwind Traders",
      country: "US",
      browser: "chrome",
      deviceType: "desktop",
      url: "https://app.example.com/checkout",
      path: "/checkout",
      appVersion: "4.12.0",
      plan: "pro",
      accountAgeDays: 412,
      signupDate: "2025-08-09",
      betaTester: true,
      language: "en-US",
      timezone: "America/New_York",
      sessionCount: 87,
    },
  },
  {
    unitId: "user_220417",
    weight: 7,
    attributes: {
      id: "user_220417",
      deviceId: "ios_4b20e8",
      loggedIn: true,
      country: "GB",
      deviceType: "mobile",
      platform: "ios",
      osVersion: "18.1",
      appVersion: "4.11.2",
      plan: "free",
      language: "en-GB",
      lastPurchaseAt: "2026-09-18T14:22:05Z",
    },
  },
  {
    unitId: "user_387102",
    weight: 6,
    attributes: {
      id: "user_387102",
      deviceId: "d_c0a4e7b9",
      loggedIn: true,
      employee: true,
      company: "GrowthBook",
      country: "DE",
      browser: "firefox",
      deviceType: "desktop",
      url: "https://app.example.com/settings/billing",
      path: "/settings/billing",
      appVersion: "4.12.0",
      plan: "enterprise",
      accountAgeDays: 1203,
      signupDate: "2023-06-11",
      betaTester: false,
      language: "de-DE",
      timezone: "Europe/Berlin",
      sessionCount: 1540,
      cartValue: 0,
      seats: 45,
    },
  },
  {
    // A server-side job: evaluates flags, sends no attributes.
    unitId: "user_091553",
    weight: 5,
    attributes: {},
  },
  {
    unitId: "user_512330",
    weight: 5,
    attributes: {
      id: "user_512330",
      deviceId: "and_91d0f3",
      loggedIn: false,
      country: "BR",
      deviceType: "mobile",
      platform: "android",
      osVersion: "14",
      appVersion: "4.10.7",
      language: "pt-BR",
    },
  },
  {
    unitId: "user_600218",
    weight: 4,
    attributes: {
      id: "user_600218",
      deviceId: "d_52be0a14",
      loggedIn: true,
      employee: true,
      company: "GrowthBook",
      country: "US",
      browser: "safari",
      deviceType: "desktop",
      url: "https://app.example.com/features",
      path: "/features",
      plan: "enterprise",
      signupDate: "2024-01-22",
      betaTester: true,
      timezone: "America/Los_Angeles",
    },
  },
  {
    // An older SDK that predates attribute reporting.
    unitId: "user_733901",
    weight: 4,
    attributes: {},
  },
  {
    unitId: "user_845127",
    weight: 3,
    attributes: {
      id: "user_845127",
      loggedIn: false,
      country: "CA",
      browser: "edge",
      deviceType: "desktop",
      path: "/pricing",
    },
  },
  {
    unitId: "user_918264",
    weight: 3,
    attributes: {
      id: "user_918264",
      deviceId: "rn_e07c55",
      loggedIn: true,
      company: "Contoso",
      country: "IN",
      deviceType: "tablet",
      platform: "react-native",
      appVersion: "4.12.0",
      plan: "pro",
      accountAgeDays: 58,
      signupDate: "2026-07-29",
      language: "en-IN",
    },
  },
  {
    unitId: "user_276640",
    weight: 2,
    attributes: {
      id: "user_276640",
      deviceId: "d_aa31f6d0",
      loggedIn: true,
      employee: false,
      company: "Fabrikam",
      country: "FR",
      browser: "chrome",
      deviceType: "mobile",
      url: "https://app.example.com/reports/42",
      path: "/reports/42",
      appVersion: "4.12.0",
      plan: "pro",
      accountAgeDays: 730,
      signupDate: "2024-09-25",
      language: "fr-FR",
      timezone: "Europe/Paris",
    },
  },
  {
    unitId: "user_450098",
    weight: 1,
    attributes: {
      id: "user_450098",
      loggedIn: true,
      company: "Adatum",
      country: "AU",
      plan: "free",
      accountAgeDays: 3,
      signupDate: "2026-09-22",
    },
  },
  {
    unitId: "user_689315",
    weight: 1,
    attributes: {
      id: "user_689315",
      deviceId: "d_19c8e2f7",
      loggedIn: false,
      country: "JP",
      browser: "chrome",
      deviceType: "desktop",
      path: "/",
      language: "ja-JP",
    },
  },
];

const TOTAL_WEIGHT = USERS.reduce((sum, u) => sum + u.weight, 0);

/**
 * The user for a row, weighted and deterministic: the same index always gets
 * the same user, so the stream is stable across renders, but the order is
 * scrambled enough that repeat users are spread through the set rather than
 * bunched.
 */
export function dummyUserForRow(index: number): {
  unit_id: string;
  attributes: Record<string, AttributeValue>;
} {
  // Knuth's multiplicative hash, reduced to [0, 1).
  const r = ((index * 2654435761) >>> 0) / 2 ** 32;
  let pick = r * TOTAL_WEIGHT;
  const user =
    USERS.find((u) => (pick -= u.weight) < 0) ?? USERS[USERS.length - 1];
  return { unit_id: user.unitId, attributes: { ...user.attributes } };
}
