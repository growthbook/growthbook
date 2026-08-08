import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { setupApp } from "../api/api.setup";

/**
 * Compensation must remove the linkage entry it ADDED, not whatever occupies the
 * slot when it runs.
 *
 * The check was presence-only — "is this feature linked?" — which cannot see an
 * ABA. A writer who unlinks the feature and re-links it leaves a DIFFERENT entry
 * there: same feature id, new `dateAdded`. An entry was there before and an entry
 * is there now, so the old check says "still ours" and deletes theirs.
 *
 * `dateAdded` is the discriminator, and the comparison belongs inside the model's
 * own read-modify-write rather than in a caller that reads, decides, then writes.
 *
 * Being inside the method is still not enough on its own: read, decide, then
 * replace the WHOLE map is the same ABA one layer down, just narrowed to the
 * moment between the read and the write. The last case below drives exactly that
 * interleaving.
 */

const ORG_ID = "org_holdout_ownership";
const org = {
  id: ORG_ID,
  name: "Holdout Ownership",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

describe("holdout linkage removal is ownership-checked", () => {
  setupApp();

  const HOLDOUT_ID = "hld_own";
  const FEATURE_ID = "feat_own";

  const context = () =>
    new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });

  const seed = async (linkedFeatures: Record<string, unknown>) => {
    await mongoose.connection
      .collection("holdouts")
      .deleteMany({ organization: ORG_ID });
    await mongoose.connection.collection("holdouts").insertOne({
      id: HOLDOUT_ID,
      organization: ORG_ID,
      name: "Holdout",
      project: "",
      linkedFeatures,
      linkedExperiments: {},
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const linkedFeatures = async () =>
    (
      await mongoose.connection
        .collection("holdouts")
        .findOne({ organization: ORG_ID, id: HOLDOUT_ID })
    )?.linkedFeatures ?? {};

  it("declines to remove an entry a later writer put there", async () => {
    const ours = new Date("2026-01-01T00:00:00Z");
    const theirs = new Date("2026-02-01T00:00:00Z");
    // Their re-link is what is live now. Ours is long gone.
    await seed({ [FEATURE_ID]: { id: FEATURE_ID, dateAdded: theirs } });

    await context().models.holdout.removeLinkageFromHoldout(HOLDOUT_ID, {
      featureId: FEATURE_ID,
      expectFeatureEntry: { dateAdded: ours },
    });

    const live = (await linkedFeatures()) as Record<
      string,
      { dateAdded: Date }
    >;
    expect(live[FEATURE_ID]).toBeDefined();
    expect(new Date(live[FEATURE_ID].dateAdded).toISOString()).toBe(
      theirs.toISOString(),
    );
  });

  it("removes the entry when it is still the one it added", async () => {
    // The control. A guard that refused everything would pass the case above and
    // leave every failed publish's linkage behind.
    const ours = new Date("2026-01-01T00:00:00Z");
    await seed({ [FEATURE_ID]: { id: FEATURE_ID, dateAdded: ours } });

    await context().models.holdout.removeLinkageFromHoldout(HOLDOUT_ID, {
      featureId: FEATURE_ID,
      expectFeatureEntry: { dateAdded: ours },
    });

    expect(await linkedFeatures()).toEqual({});
  });

  it("still drops whatever is there when no entry is named", async () => {
    // Callers that mean "unlink this feature" outright — not compensating for
    // something they wrote — pass no entry and must keep working.
    await seed({
      [FEATURE_ID]: { id: FEATURE_ID, dateAdded: new Date() },
    });

    await context().models.holdout.removeLinkageFromHoldout(HOLDOUT_ID, {
      featureId: FEATURE_ID,
    });

    expect(await linkedFeatures()).toEqual({});
  });

  it("declines a relink that lands between its own read and write", async () => {
    // The ownership test above proves the COMPARISON; this proves it is asked at
    // the right moment. `dateAdded` decided against an earlier read, followed by an
    // unguarded whole-map write, deletes a relink that arrived in between — the
    // check passes, and the write it authorized is already stale.
    //
    // Injected into `compute`, which by construction runs after the CAS has read
    // the row and before it writes it — the one window the whole finding is about.
    // Without the guard the write matches anyway and their entry is gone; with it,
    // the write is refused, the loop re-reads, and the comparison — now against
    // THEIR entry — declines.
    const ours = new Date("2026-01-01T00:00:00Z");
    const theirs = new Date("2026-03-01T00:00:00Z");
    await seed({ [FEATURE_ID]: { id: FEATURE_ID, dateAdded: ours } });

    const holdoutModel = context().models.holdout;
    const model = Object.getPrototypeOf(holdoutModel);
    const realCas = model.updateWithCas;
    let raced = false;
    jest.spyOn(model, "updateWithCas").mockImplementation(async function (
      this: unknown,
      id: string,
      fields: string[],
      compute: (doc: unknown) => unknown,
      options: unknown,
    ) {
      return await realCas.call(
        this,
        id,
        fields,
        async (doc: unknown) => {
          if (!raced) {
            raced = true;
            await mongoose.connection.collection("holdouts").updateOne(
              { organization: ORG_ID, id: HOLDOUT_ID },
              {
                $set: {
                  [`linkedFeatures.${FEATURE_ID}`]: {
                    id: FEATURE_ID,
                    dateAdded: theirs,
                  },
                },
              },
            );
          }
          return compute(doc);
        },
        options,
      );
    });

    try {
      await holdoutModel.removeLinkageFromHoldout(HOLDOUT_ID, {
        featureId: FEATURE_ID,
        expectFeatureEntry: { dateAdded: ours },
      });
    } finally {
      jest.restoreAllMocks();
    }

    expect(raced).toBe(true);
    const live = (await linkedFeatures()) as Record<
      string,
      { dateAdded: Date }
    >;
    expect(new Date(live[FEATURE_ID]?.dateAdded).toISOString()).toBe(
      theirs.toISOString(),
    );
  });

  it("reports the entry it wrote, and null when one was already there", async () => {
    // The other half: the rewind can only name what it added if the forward pass
    // hands it back. `addFeatureToHoldout` lets an existing entry win the spread,
    // so in that case it added nothing and must say so — otherwise compensation
    // would claim ownership of an entry it never wrote.
    await seed({});
    const added = await context().models.holdout.addFeatureToHoldout(
      HOLDOUT_ID,
      FEATURE_ID,
    );
    expect(added?.id).toBe(FEATURE_ID);

    const again = await context().models.holdout.addFeatureToHoldout(
      HOLDOUT_ID,
      FEATURE_ID,
    );
    expect(again).toBeNull();
  });
});
