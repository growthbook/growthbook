import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { publishRevision } from "back-end/src/revisions/revisionActions";
import { getAdapter } from "back-end/src/revisions";
import { setupApp } from "./api.setup";

/**
 * Three fences of the generic landing, each exercised over the real engine the
 * way stranded-merge-recovery.test.ts does. The adapter's applyChanges is spied,
 * not mocked: the landing call has `isRevert: false`, a compensation restore has
 * `isRevert: true`, so the spy can fail one leg while the rest of the machinery
 * runs for real.
 */

const adapter = getAdapter("constant");

function makeOrg(id: string): OrganizationInterface {
  return {
    id,
    name: id,
    ownerEmail: "t@t.co",
    url: "",
    dateCreated: new Date(),
    members: [],
    settings: {},
  } as unknown as OrganizationInterface;
}

describe("generic landing fences", () => {
  const { app, setReqContext } = setupApp();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function seedConstant(orgId: string, key: string, value: string) {
    await mongoose.connection.collection("constants").insertOne({
      id: `cst_${key}`,
      organization: orgId,
      key,
      name: key,
      type: "string",
      value,
      owner: "",
      project: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  function makeContext(orgId: string): ReqContextClass {
    const ctx = new ReqContextClass({
      org: makeOrg(orgId),
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    setReqContext(ctx);
    return ctx;
  }

  async function draftRevision(key: string, value?: string): Promise<number> {
    const createRes = await request(app)
      .post(`/api/v1/constants-revisions/${key}`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(createRes.status).toBe(200);
    const version = createRes.body.revision.version;
    if (value !== undefined) {
      const editRes = await request(app)
        .put(`/api/v1/constants-revisions/${key}/${version}/value`)
        .send({ value })
        .set("Authorization", "Bearer foo");
      expect(editRes.status).toBe(200);
    }
    return version;
  }

  async function loadRevisionAndEntity(
    ctx: ReqContextClass,
    key: string,
    version: number,
  ) {
    const entity = await ctx.models.constants.getByKey(key);
    if (!entity) throw new Error("constant not found");
    const revision = await ctx.models.revisions.getByTargetAndVersion(
      "constant",
      entity.id,
      version,
    );
    if (!revision) throw new Error("revision not found");
    return { revision, entity };
  }

  /** A merged rival stamped now, so it wins getLatestMergedByTarget. */
  async function insertRivalMerged(orgId: string, entityId: string) {
    await mongoose.connection.collection("revisions").insertOne({
      id: `rev_rival_${orgId}`,
      organization: orgId,
      version: 99,
      status: "merged",
      authorId: "u_rival",
      reviews: [],
      activityLog: [],
      resolution: { action: "merged", userId: "", dateCreated: new Date() },
      target: {
        type: "constant",
        id: entityId,
        snapshot: { id: entityId, project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  }

  // A restore that fails leaves the change live; the buffered *.updated event is
  // the only announcement consumers get, and it must survive the failed landing.
  it("announces live state when compensation cannot restore it", async () => {
    const ORG = "org_fence_partial_state";
    const ctx = makeContext(ORG);
    await seedConstant(ORG, "fence_ps", "before");
    const version = await draftRevision("fence_ps", "after");
    const { revision, entity } = await loadRevisionAndEntity(
      ctx,
      "fence_ps",
      version,
    );

    const orig = adapter.applyChanges.bind(adapter);
    jest
      .spyOn(adapter, "applyChanges")
      .mockImplementation(async (c, current, values, opts) => {
        if (opts?.isRevert) throw new Error("restore failed");
        // Real write: live changes, the constant.updated event is deferred into
        // the landing's buffer, onPersisted reports. Then the next step "fails".
        await orig(c, current, values, opts);
        throw new Error("post-write step failed");
      });

    await expect(
      publishRevision(ctx, revision, entity as Record<string, unknown>),
    ).rejects.toThrow("post-write step failed");

    // The contract when live cannot go back: the change stays, the merged
    // revision stays as its record, and the deferred event is EMITTED.
    const live = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG, key: "fence_ps" });
    expect(live?.value).toBe("after");
    const stored = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG, id: revision.id });
    expect(stored?.status).toBe("merged");
    const events = await mongoose.connection
      .collection("events")
      .find({ organizationId: ORG })
      .toArray();
    expect(events.filter((e) => e.event === "constant.updated")).toHaveLength(
      1,
    );
  });

  // Recovery re-applies older state by definition, so a rival merge claimed during
  // its write must unwind it — the same post-write fence every other landing has.
  it("recovery unwinds when a rival merge claims during its write", async () => {
    const ORG = "org_fence_recovery";
    const ctx = makeContext(ORG);
    await seedConstant(ORG, "fence_rec", "before");
    const version = await draftRevision("fence_rec", "after");
    const { revision: draft, entity } = await loadRevisionAndEntity(
      ctx,
      "fence_rec",
      version,
    );

    // Strand it: merged on record, never applied.
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG, id: draft.id },
      {
        $set: {
          status: "merged",
          resolution: { action: "merged", userId: "", dateCreated: new Date() },
        },
      },
    );
    const { revision } = await loadRevisionAndEntity(ctx, "fence_rec", version);

    const orig = adapter.applyChanges.bind(adapter);
    jest
      .spyOn(adapter, "applyChanges")
      .mockImplementation(async (c, current, values, opts) => {
        if (opts?.isRevert) return orig(c, current, values, opts);
        // The rival lands its claim inside recovery's write window.
        await insertRivalMerged(ORG, (entity as { id: string }).id);
        return orig(c, current, values, opts);
      });

    await expect(
      publishRevision(ctx, revision, entity as Record<string, unknown>),
    ).rejects.toThrow(/changed while this was being applied/);

    // Unwound: live restored, the stranded merge kept for a retry, the recovery
    // lease released so that retry is not locked out.
    const live = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG, key: "fence_rec" });
    expect(live?.value).toBe("before");
    const stored = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG, id: revision.id });
    expect(stored?.status).toBe("merged");
    expect(
      (stored?.activityLog ?? []).filter(
        (e: { action: string }) => e.action === "merge-recovered",
      ),
    ).toHaveLength(0);
  });

  // Recovery's compensation restores the CASCADE too, not just the root — a
  // config recovery that strips descendant fields and then loses the fence must
  // put the descendants back, same as the ordinary landing's compensation.
  it("recovery compensation restores cascade writes, not just the root", async () => {
    const ORG = "org_fence_cascade";
    const ctx = makeContext(ORG);
    await seedConstant(ORG, "fence_casc_root", "before");
    await seedConstant(ORG, "fence_casc_child", "child-before");
    const version = await draftRevision("fence_casc_root", "after");
    const { revision: draft, entity } = await loadRevisionAndEntity(
      ctx,
      "fence_casc_root",
      version,
    );
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG, id: draft.id },
      {
        $set: {
          status: "merged",
          resolution: { action: "merged", userId: "", dateCreated: new Date() },
        },
      },
    );
    const { revision } = await loadRevisionAndEntity(
      ctx,
      "fence_casc_root",
      version,
    );
    const childPre = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG, key: "fence_casc_child" });

    const orig = adapter.applyChanges.bind(adapter);
    jest
      .spyOn(adapter, "applyChanges")
      .mockImplementation(async (c, current, values, opts) => {
        if (opts?.isRevert) return orig(c, current, values, opts);
        // Rival claims during the write, and the apply reports a cascade write
        // it also physically performed — the shape a config schema strip leaves.
        await insertRivalMerged(ORG, (entity as { id: string }).id);
        await mongoose.connection
          .collection("constants")
          .updateOne(
            { organization: ORG, key: "fence_casc_child" },
            { $set: { value: "child-stripped" } },
          );
        const innerOnPersisted = opts?.onPersisted;
        return orig(c, current, values, {
          ...opts,
          onPersisted: (result) => {
            innerOnPersisted?.({
              ...result,
              cascade: [
                {
                  before: childPre as Record<string, unknown> & { id: string },
                  written: { value: "child-stripped" },
                },
              ],
            });
          },
        });
      });

    await expect(
      publishRevision(ctx, revision, entity as Record<string, unknown>),
    ).rejects.toThrow(/changed while this was being applied/);

    const root = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG, key: "fence_casc_root" });
    expect(root?.value).toBe("before");
    const child = await mongoose.connection
      .collection("constants")
      .findOne({ organization: ORG, key: "fence_casc_child" });
    expect(child?.value).toBe("child-before");
  });

  // A deferred publish carries its approval bypass as persisted intent; the
  // armer's role alone must not force an unapproved schedule through at fire
  // time, however privileged the armer is.
  it("a deferred publish does not take approval bypass from the armer's role", async () => {
    const ORG = "org_fence_deferred";
    const ctx = makeContext(ORG);
    await seedConstant(ORG, "fence_def", "before");
    const version = await draftRevision("fence_def", "after");
    const { revision, entity } = await loadRevisionAndEntity(
      ctx,
      "fence_def",
      version,
    );
    await mongoose.connection
      .collection("revisions")
      .updateOne(
        { organization: ORG, id: revision.id },
        { $set: { status: "pending-review" } },
      );
    const { revision: pending } = await loadRevisionAndEntity(
      ctx,
      "fence_def",
      version,
    );

    jest.spyOn(adapter, "isApprovalRequiredForRevision").mockReturnValue(true);
    // The armer's role holds bypass — exactly what must NOT count here.
    jest.spyOn(adapter, "canBypassApproval").mockReturnValue(true);

    await expect(
      publishRevision(ctx, pending, entity as Record<string, unknown>, {
        deferred: true,
      }),
    ).rejects.toThrow(/must be approved/);

    // The same publish NOT deferred takes the role bypass, as before.
    await expect(
      publishRevision(ctx, pending, entity as Record<string, unknown>),
    ).resolves.toMatchObject({ status: "merged" });
  });

  // The no-op branch writes nothing, but it still claims a place in the merged
  // order — and config's beforeNoOpMerge replays cascades against that claim. A
  // rival claimed since must unwind it, exactly as the with-changes branch does.
  it("a no-op merge unwinds when it is no longer the newest claim", async () => {
    const ORG = "org_fence_noop";
    const ctx = makeContext(ORG);
    await seedConstant(ORG, "fence_noop", "same");
    const version = await draftRevision("fence_noop");
    const { revision, entity } = await loadRevisionAndEntity(
      ctx,
      "fence_noop",
      version,
    );

    // Inject the rival between the no-op's claim and its baseline read.
    const origGetById = ctx.models.constants.getById.bind(ctx.models.constants);
    let injected = false;
    jest
      .spyOn(ctx.models.constants, "getById")
      .mockImplementation(async (id: string) => {
        if (!injected) {
          injected = true;
          await insertRivalMerged(ORG, (entity as { id: string }).id);
        }
        return origGetById(id);
      });

    await expect(
      publishRevision(ctx, revision, entity as Record<string, unknown>),
    ).rejects.toThrow(/changed while this was being applied/);

    const stored = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG, id: revision.id });
    expect(stored?.status).toBe("draft");
  });
});
