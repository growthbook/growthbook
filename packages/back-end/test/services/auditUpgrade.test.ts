import { AuditInterface } from "shared/types/audit";
import { Environment } from "shared/types/organization";
import { ReqContext } from "back-end/types/request";
import {
  upgradeAuditDetailsForRead,
  upgradeAuditDetailsListForRead,
} from "back-end/src/services/auditUpgrade";

// ---------------------------------------------------------------------------
// upgradeAuditDetailsForRead is a pure transform on AuditInterface + context.
//
// Responsibilities (in order of importance):
//   1. Do not mutate the input audit document.
//   2. Pass non-feature audits through unchanged (reference-equal).
//   3. For feature audits whose details contain full-shaped feature snapshots
//      in `pre` / `post`, run them through the feature JIT upgrader so v0/v1
//      legacy snapshots read out as v2.
//   4. Degrade to the original audit on any parse or upgrade failure —
//      history endpoints must never 500 because of a malformed legacy row.
//   5. Never mistake a partial snapshot (toggle map, archive diff) for a full
//      feature document; those must pass through with their fields intact.
// ---------------------------------------------------------------------------

const ORG_ENVS: Environment[] = [
  { id: "dev", description: "" },
  { id: "production", description: "" },
];

function mockContext(): ReqContext {
  return {
    org: { settings: { environments: ORG_ENVS } },
  } as unknown as ReqContext;
}

const BASE_META = {
  id: "feat_test",
  organization: "org_test",
  owner: "tester",
  dateCreated: "2024-01-01T00:00:00.000Z",
  dateUpdated: "2024-01-01T00:00:00.000Z",
  valueType: "boolean" as const,
  defaultValue: "true",
  version: 1,
  tags: [],
};

function v1Feature() {
  return {
    ...BASE_META,
    environmentSettings: {
      dev: {
        enabled: true,
        rules: [
          {
            id: "r1",
            type: "force",
            description: "",
            value: "true",
            enabled: true,
          },
        ],
      },
      production: {
        enabled: true,
        rules: [
          {
            id: "r1",
            type: "force",
            description: "",
            value: "true",
            enabled: true,
          },
        ],
      },
    },
  };
}

function v2Feature() {
  return {
    ...BASE_META,
    rules: [
      {
        id: "r1",
        uid: "ruid_test_r1_*",
        type: "force",
        description: "",
        value: "true",
        enabled: true,
        allEnvironments: true,
      },
    ],
    environmentSettings: {
      dev: { enabled: true },
      production: { enabled: true },
    },
  };
}

function baseAudit(overrides: Partial<AuditInterface> = {}): AuditInterface {
  return {
    id: "aud_1",
    organization: "org_test",
    user: { system: true },
    event: "feature.update",
    entity: { object: "feature", id: "feat_test", name: "Feat Test" },
    dateCreated: new Date("2024-02-01"),
    ...overrides,
  } as AuditInterface;
}

describe("upgradeAuditDetailsForRead", () => {
  describe("pass-through cases (reference-equal output)", () => {
    it("returns input unchanged for non-feature entity types", () => {
      const audit = baseAudit({
        entity: { object: "experiment", id: "exp_1", name: "E" },
        event: "experiment.update",
        details: JSON.stringify({ pre: { foo: "bar" }, post: { foo: "baz" } }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when details is undefined", () => {
      const audit = baseAudit({ details: undefined });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when details is empty string", () => {
      const audit = baseAudit({ details: "" });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when details is malformed JSON", () => {
      const audit = baseAudit({ details: "{not: valid json" });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when details is JSON but not an object", () => {
      const audit = baseAudit({ details: JSON.stringify("just a string") });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when pre/post are toggle maps (feature.toggle)", () => {
      // feature.toggle writes env→bool maps, not feature docs. Must not
      // be mistaken for snapshots.
      const audit = baseAudit({
        event: "feature.toggle",
        details: JSON.stringify({
          pre: { dev: true, production: false },
          post: { dev: true, production: true },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged for feature.revision.update (small diff + change tag)", () => {
      // Lock-in: revision-scoped audits emitted by `recordRevisionUpdate`
      // carry a tiny `{ version }` diff plus a `change` tag in `context`
      // (e.g. "rule.add", "rule.update", "rule.reorder"). They MUST pass
      // through untouched — if anyone later starts embedding a full
      // FeatureRevisionInterface (with v1-shape `rules: Record<string, ...>`)
      // in these audits, the upgrader will silently no-op on the revision
      // and this test will start failing, flagging the gap.
      const audit = baseAudit({
        event: "feature.revision.update",
        details: JSON.stringify({
          pre: { version: 3 },
          post: { version: 3 },
          context: { change: "rule.add", environments: ["dev"] },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged for feature.revision.create (metadata only)", () => {
      // Another revision-scoped audit: the payload is { featureId, version,
      // baseVersion, comment } — has `featureId` (not `id`), lacks
      // `valueType`/`environmentSettings`, and so must pass through.
      const audit = baseAudit({
        event: "feature.revision.create",
        details: JSON.stringify({
          post: {
            featureId: "feat_test",
            version: 4,
            baseVersion: 3,
            comment: "new draft",
          },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged for feature.revision.approve (status diff)", () => {
      const audit = baseAudit({
        event: "feature.revision.approve",
        details: JSON.stringify({
          pre: { status: "pending-review" },
          post: { status: "approved" },
          context: { version: 3, comment: "LGTM" },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when pre/post are archive diffs", () => {
      const audit = baseAudit({
        event: "feature.archive",
        details: JSON.stringify({
          pre: { archived: false },
          post: { archived: true },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when pre/post are arrays", () => {
      const audit = baseAudit({
        details: JSON.stringify({ pre: [1, 2, 3], post: [4, 5, 6] }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when details has only `context`", () => {
      const audit = baseAudit({
        details: JSON.stringify({ context: { reason: "something" } }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });

    it("returns input unchanged when a 'feature-like' object is missing id", () => {
      // id is mandatory for the detector — a bare { valueType: ... } isn't
      // something the upgrader can consume.
      const audit = baseAudit({
        details: JSON.stringify({
          pre: { valueType: "boolean", defaultValue: "true" },
        }),
      });
      expect(upgradeAuditDetailsForRead(audit, mockContext())).toBe(audit);
    });
  });

  describe("upgrade cases (returns new audit with v2 snapshot)", () => {
    it("flattens a v1 feature in `post` (create event)", () => {
      const audit = baseAudit({
        event: "feature.create",
        details: JSON.stringify({ post: v1Feature() }),
      });

      const out = upgradeAuditDetailsForRead(audit, mockContext());

      expect(out).not.toBe(audit);
      const parsed = JSON.parse(out.details!);
      expect(parsed.post.rules).toBeInstanceOf(Array);
      expect(parsed.post.rules.length).toBe(1);
      expect(parsed.post.rules[0].id).toBe("r1");
      expect(parsed.post.rules[0].uid).toBeDefined();
      expect(parsed.post.rules[0].allEnvironments).toBe(true);
    });

    it("flattens v1 in both `pre` and `post` (update event)", () => {
      const audit = baseAudit({
        details: JSON.stringify({
          pre: v1Feature(),
          post: v1Feature(),
        }),
      });
      const out = upgradeAuditDetailsForRead(audit, mockContext());
      const parsed = JSON.parse(out.details!);
      expect(parsed.pre.rules).toBeInstanceOf(Array);
      expect(parsed.post.rules).toBeInstanceOf(Array);
      expect(parsed.pre.rules[0].uid).toBeDefined();
      expect(parsed.post.rules[0].uid).toBeDefined();
    });

    it("flattens v1 in `pre` only (delete event)", () => {
      const audit = baseAudit({
        event: "feature.delete",
        details: JSON.stringify({ pre: v1Feature() }),
      });
      const out = upgradeAuditDetailsForRead(audit, mockContext());
      const parsed = JSON.parse(out.details!);
      expect(parsed.pre.rules).toBeInstanceOf(Array);
      expect(parsed.post).toBeUndefined();
    });

    it("preserves other envelope fields (context) verbatim", () => {
      const audit = baseAudit({
        details: JSON.stringify({
          pre: v1Feature(),
          post: v1Feature(),
          context: { revisionId: "rev_1", reason: "merge" },
        }),
      });
      const out = upgradeAuditDetailsForRead(audit, mockContext());
      const parsed = JSON.parse(out.details!);
      expect(parsed.context).toEqual({
        revisionId: "rev_1",
        reason: "merge",
      });
    });

    it("is idempotent on v2 snapshots (round-trip preserves uids)", () => {
      // A v2 snapshot passes through buildFeatureInterface unchanged in
      // terms of rule identity; the upgrade itself becomes a no-op at the
      // rule level.
      const audit = baseAudit({
        details: JSON.stringify({
          pre: v2Feature(),
          post: v2Feature(),
        }),
      });
      const out = upgradeAuditDetailsForRead(audit, mockContext());
      const parsed = JSON.parse(out.details!);
      expect(parsed.pre.rules[0].uid).toBe("ruid_test_r1_*");
      expect(parsed.post.rules[0].uid).toBe("ruid_test_r1_*");
    });

    it("does not touch the input audit (no mutation)", () => {
      const original = baseAudit({
        details: JSON.stringify({ post: v1Feature() }),
      });
      const originalDetails = original.details;
      upgradeAuditDetailsForRead(original, mockContext());
      expect(original.details).toBe(originalDetails);
    });
  });

  describe("upgradeAuditDetailsListForRead", () => {
    it("preserves order and length", () => {
      const audits: AuditInterface[] = [
        baseAudit({
          id: "a1",
          event: "feature.toggle",
          details: JSON.stringify({ pre: {}, post: {} }),
        }),
        baseAudit({
          id: "a2",
          event: "feature.update",
          details: JSON.stringify({ pre: v1Feature(), post: v1Feature() }),
        }),
        baseAudit({
          id: "a3",
          entity: { object: "experiment", id: "exp_1" },
          event: "experiment.start",
        }),
      ];
      const out = upgradeAuditDetailsListForRead(audits, mockContext());
      expect(out.length).toBe(3);
      expect(out[0].id).toBe("a1");
      expect(out[1].id).toBe("a2");
      expect(out[2].id).toBe("a3");
    });

    it("returns reference-equal entries for pass-through cases and new references only for upgraded ones", () => {
      const passthrough = baseAudit({
        id: "a1",
        entity: { object: "experiment", id: "exp_1" },
      });
      const upgradable = baseAudit({
        id: "a2",
        details: JSON.stringify({ post: v1Feature() }),
      });
      const out = upgradeAuditDetailsListForRead(
        [passthrough, upgradable],
        mockContext(),
      );
      expect(out[0]).toBe(passthrough);
      expect(out[1]).not.toBe(upgradable);
    });
  });
});
