import type { FeatureInterface } from "shared/types/feature";
import type { Context } from "back-end/src/models/BaseModel";
import { onFeatureUpdate } from "back-end/src/models/FeatureModel";
import { withBufferedPayloadRefreshes } from "back-end/src/revisions/landingSequence";

const FEATURE_ID = "feat_straggler";
const EMIT_PROBE = "emit-probe: live emit branch was taken";

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function ctx(
  getAllProjectIds: () => Promise<string[]>,
  emitAttempted: jest.Mock,
): Context {
  return {
    org: {
      id: "org_straggler",
      settings: { environments: [{ id: "production", description: "" }] },
      isVercelIntegration: false,
    },
    getAllProjectIds,
    sdkPayloadRefreshBuffer: null,
    bulkPublishDeferredEvents: null,
    models: {
      savedGroups: {
        getAll: async () => {
          emitAttempted();
          throw new Error(EMIT_PROBE);
        },
      },
    },
  } as unknown as Context;
}

const before = {
  id: FEATURE_ID,
  organization: "org_straggler",
  version: 1,
  valueType: "boolean",
  defaultValue: "false",
  description: "before",
  owner: "",
  tags: [],
  project: "",
  rules: [],
  environmentSettings: { production: { enabled: true, rules: [] } },
  dateCreated: new Date(0),
  dateUpdated: new Date(0),
} as unknown as FeatureInterface;
const after = { ...before, description: "after" } as FeatureInterface;

/**
 * `onFeatureUpdate` as a real straggler: fired fire-and-forget, suspended on the
 * project lookup, and resuming while the NEXT landing is open.
 *
 * The whole capture-at-write-time fix rests on one property that cannot be seen from
 * the helper boundary — that the capture sits above the first await in the only
 * producer that can suspend. Moving it below the await is invisible to every other
 * test here.
 *
 * No module mocks. The seam is `models.savedGroups.getAll`, which
 * `logFeatureUpdatedEvent` awaits as its first statement, so a throw there marks the
 * live-emit branch as taken without reaching mongoose.
 *
 * The fire-and-forget structure is load-bearing, not decoration: awaiting the producer
 * inside its own landing leaves buffer #1 open at the post-await capture point, and
 * the mutation passes. Verified as a control before trusting either case below.
 *
 * The producer resumes MID-landing-2 rather than after it, which is both the faithful
 * race (the first feature's hook resuming while the loop applies the second) and quiet
 * — resuming after landing #2 settles falls through to a live payload refresh.
 */
describe("onFeatureUpdate as a straggler (resumes mid-next-landing)", () => {
  it("emits for a landing that stood, while a later landing rolls the feature back", async () => {
    const projectIds = gate<string[]>();
    const emitAttempted = jest.fn();
    const context = ctx(() => projectIds.promise, emitAttempted);
    let producer!: Promise<void>;

    await withBufferedPayloadRefreshes(context, "landing-1", async () => {
      producer = onFeatureUpdate(context, before, after);
      await Promise.resolve();
    });

    await expect(
      withBufferedPayloadRefreshes(context, "landing-2", async () => {
        context.bulkPublishRestoredEntities?.add(FEATURE_ID);
        projectIds.resolve([]);
        await expect(producer).rejects.toThrow(EMIT_PROBE);
        expect(context.bulkPublishDeferredEvents?.entries).toEqual([]);
        throw new Error("second landing failed");
      }),
    ).rejects.toThrow("second landing failed");

    expect(emitAttempted).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a landing that rolled the feature back, while a later landing stands", async () => {
    const projectIds = gate<string[]>();
    const emitAttempted = jest.fn();
    const context = ctx(() => projectIds.promise, emitAttempted);
    let producer!: Promise<void>;

    await expect(
      withBufferedPayloadRefreshes(context, "landing-1", async () => {
        producer = onFeatureUpdate(context, before, after);
        await Promise.resolve();
        context.bulkPublishRestoredEntities?.add(FEATURE_ID);
        throw new Error("first landing failed");
      }),
    ).rejects.toThrow("first landing failed");

    await withBufferedPayloadRefreshes(context, "landing-2", async () => {
      projectIds.resolve([]);
      await expect(producer).resolves.toBeUndefined();
      expect(context.bulkPublishDeferredEvents?.entries).toEqual([]);
    });

    expect(emitAttempted).not.toHaveBeenCalled();
  });
});
