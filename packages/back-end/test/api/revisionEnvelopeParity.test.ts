import type { Revision } from "shared/enterprise";
import type { ApiReqContext } from "back-end/types/api";

/**
 * The three generic-entity revision serializers must emit the SAME envelope.
 *
 * Configs, Constants and Saved Groups differ only in their payload (`baseX` /
 * `proposedX`). Everything else — status, reviews, activity log, schedule,
 * resolution, dates — is one shared shape. When each serializer spelled that
 * shape out for itself, the copies drifted silently: the Config response
 * omitted `stale` entirely, so API and webhook consumers could not tell a
 * superseded verdict from a standing one. Three reviewers read past it; it was
 * eventually caught by a human diffing the files side by side.
 *
 * This pins the invariant instead. It compares the serializers to EACH OTHER
 * rather than to a golden fixture, so it keeps holding as the envelope grows —
 * a new field is fine, a new field in only two of three is not.
 */

jest.mock("back-end/src/services/owner", () => ({
  // The real one batches a Mongo lookup for owner emails; identity keeps this a
  // pure shape test. Batching itself is exercised by the API suites.
  resolveOwnerEmails: async <T>(docs: T[]) => docs,
}));

import { toApiConfigRevisions } from "back-end/src/api/configs/toApiConfigRevision";
import { toApiConstantRevisions } from "back-end/src/api/constants/toApiConstantRevision";
import { toApiSavedGroupRevisions } from "back-end/src/api/saved-groups/toApiSavedGroupRevision";

// A revision exercising every OPTIONAL branch of the envelope at once: title,
// contributors, revertedFrom, resolution, a stale verdict and a plain one, and
// an activity entry carrying both snapshot fields. A field that only one
// serializer emits shows up as a key-set difference below.
const revision = {
  id: "rev_parity",
  organization: "org_parity",
  version: 3,
  title: "parity fixture",
  status: "approved",
  authorId: "u_author",
  contributors: ["u_author", "u_editor"],
  revertedFrom: "rev_older",
  reviewCycle: 2,
  reviews: [
    {
      id: "rvw_stale",
      userId: "u_reviewer",
      decision: "approve",
      comment: "superseded by a later cycle",
      stale: true,
      dateCreated: new Date("2026-01-02T03:04:05Z"),
    },
    {
      id: "rvw_live",
      userId: "u_reviewer2",
      decision: "request-changes",
      dateCreated: new Date("2026-01-03T03:04:05Z"),
    },
  ],
  activityLog: [
    {
      id: "act_1",
      userId: "u_author",
      action: "created",
      description: "This revision reverts changes from Revision 1",
      dateCreated: new Date("2026-01-01T00:00:00Z"),
      proposedChangesSnapshot: [],
      targetSnapshot: { id: "ent", key: "ent" },
    },
  ],
  resolution: {
    action: "merged",
    userId: "u_publisher",
    dateCreated: new Date("2026-01-04T00:00:00Z"),
  },
  autoPublishOnApproval: true,
  scheduledPublishAt: new Date("2026-02-01T00:00:00Z"),
  target: {
    type: "constant",
    id: "ent",
    snapshot: { id: "ent", key: "ent", project: "" },
    proposedChanges: [],
  },
  dateCreated: new Date("2026-01-01T00:00:00Z"),
  dateUpdated: new Date("2026-01-05T00:00:00Z"),
} as unknown as Revision;

// Each serializer reaches for its own model's projector; identity is enough to
// compare envelopes, and keeps entity payload shape out of this test.
const identity = { toApiInterface: (s: unknown) => s };
const context = {
  models: {
    constants: identity,
    configs: identity,
    savedGroups: identity,
  },
} as unknown as ApiReqContext;

const PAYLOAD_KEYS = new Set([
  "baseConstant",
  "proposedConstant",
  "baseConfig",
  "proposedConfig",
  "baseSavedGroup",
  "proposedSavedGroup",
]);

const envelopeOf = (shaped: object) =>
  Object.fromEntries(
    Object.entries(shaped).filter(([k]) => !PAYLOAD_KEYS.has(k)),
  );

describe("revision API envelope parity", () => {
  const shaped = async () => {
    const [constant] = await toApiConstantRevisions([revision], context);
    const [config] = await toApiConfigRevisions([revision], context);
    const [savedGroup] = await toApiSavedGroupRevisions([revision], context);
    return { constant, config, savedGroup };
  };

  it("emits an identical envelope for all three entities", async () => {
    const { constant, config, savedGroup } = await shaped();

    // Deep equality, not just key names: a field present everywhere but
    // computed differently (the `toIsoString` null handling that had drifted)
    // fails here too.
    expect(envelopeOf(config)).toEqual(envelopeOf(constant));
    expect(envelopeOf(savedGroup)).toEqual(envelopeOf(constant));
  });

  it("carries every envelope field", async () => {
    // Parity alone cannot see a field dropped from the SHARED envelope — all
    // three lose it together and still match each other. That blind spot is new:
    // before unification a regression hit one entity, now it hits all of them.
    // So the field set is pinned explicitly. Adding a field means updating this
    // list, which is the point — it makes the change deliberate.
    const { constant } = await shaped();

    expect(Object.keys(envelopeOf(constant)).sort()).toEqual([
      "activityLog",
      "authorId",
      "autoPublishOnApproval",
      "contributors",
      "dateCreated",
      "dateUpdated",
      "id",
      "proposedChanges",
      "resolution",
      "revertedFrom",
      "reviews",
      "scheduledPublishAt",
      "status",
      "title",
      "version",
    ]);
  });

  it("gives every entity the same payload field pair", async () => {
    const { constant, config, savedGroup } = await shaped();

    expect(Object.keys(constant).filter((k) => PAYLOAD_KEYS.has(k))).toEqual([
      "baseConstant",
      "proposedConstant",
    ]);
    expect(Object.keys(config).filter((k) => PAYLOAD_KEYS.has(k))).toEqual([
      "baseConfig",
      "proposedConfig",
    ]);
    expect(Object.keys(savedGroup).filter((k) => PAYLOAD_KEYS.has(k))).toEqual([
      "baseSavedGroup",
      "proposedSavedGroup",
    ]);
  });

  it("carries each verdict's stale flag", async () => {
    // The specific field that went missing. Both values matter: emitting a
    // constant `false` would satisfy a presence-only check while still hiding
    // every superseded verdict.
    const { constant, config, savedGroup } = await shaped();

    for (const shape of [constant, config, savedGroup]) {
      expect(shape.reviews.map((r) => r.stale)).toEqual([true, false]);
    }
  });

  it("treats a missing or null date as the epoch rather than throwing", async () => {
    // The three copies disagreed here: two tested `=== undefined` and would
    // have thrown on a null stored date; one tested `== null`.
    const nulled = {
      ...revision,
      reviews: [{ ...revision.reviews[0], dateCreated: null }],
    } as unknown as Revision;

    const [constant] = await toApiConstantRevisions([nulled], context);
    const [config] = await toApiConfigRevisions([nulled], context);
    const [savedGroup] = await toApiSavedGroupRevisions([nulled], context);

    const epoch = new Date(0).toISOString();
    for (const shape of [constant, config, savedGroup]) {
      expect(shape.reviews[0].dateCreated).toBe(epoch);
    }
  });
});
