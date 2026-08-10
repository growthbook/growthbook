import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { publishRevision } from "back-end/src/revisions/revisionActions";
import { getAdapter } from "back-end/src/revisions";
import { setupApp } from "./api.setup";

/**
 * Publishing claims the merge before touching the live entity, so a crash
 * between the two leaves a revision recorded as "merged" whose changes never
 * landed. Re-publishing is the documented recovery. The claim runs against the
 * real `RevisionModel` (whose `canUpdate` refuses merged revisions to keep
 * history immutable), so no mock can cover it — this strands a revision the way
 * production does and drives the real engine over it.
 *
 * Drives `publishRevision` directly: the REST publish handlers carry their own
 * inline copies of the publish flow and never reach the shared engine, so
 * recovery is currently reachable only from the internal revision controller.
 */

const ORG_ID = "org_stranded_recovery";
const GROUP_ID = "grp_stranded_recovery";

const org = {
  id: ORG_ID,
  name: "Stranded Recovery",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: {},
} as unknown as OrganizationInterface;

describe("re-publishing a revision whose merge was claimed but never applied", () => {
  const { app, setReqContext } = setupApp();

  let ctx: ReqContextClass;

  function currentContext(): ReqContextClass {
    return ctx;
  }

  async function seedStrandedRevision(): Promise<number> {
    ctx = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });
    setReqContext(ctx);

    await mongoose.connection.collection("savedgroups").insertOne({
      id: GROUP_ID,
      organization: ORG_ID,
      groupName: "Stranded group",
      owner: "",
      type: "condition",
      condition: '{"id": {"$in": ["before"]}}',
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const createRes = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(createRes.status).toBe(200);
    const version = createRes.body.revision.version;

    const editRes = await request(app)
      .put(`/api/v1/saved-groups-revisions/${GROUP_ID}/${version}/condition`)
      .send({ condition: '{"id": {"$in": ["after"]}}' })
      .set("Authorization", "Bearer foo");
    expect(editRes.status).toBe(200);

    // Strand it exactly as a mid-publish crash would: the merge is recorded —
    // resolution stamp included, since the claim path always writes one — and
    // the entity still holds its old value. Editing may already have published
    // (this org requires no approval), so roll the entity back explicitly
    // rather than assuming the edit left it behind.
    await mongoose.connection.collection("revisions").updateOne(
      { organization: ORG_ID, "target.id": GROUP_ID, version },
      {
        $set: {
          status: "merged",
          resolution: { action: "merged", userId: "", dateCreated: new Date() },
        },
      },
    );
    await mongoose.connection
      .collection("savedgroups")
      .updateOne(
        { id: GROUP_ID },
        { $set: { condition: '{"id": {"$in": ["before"]}}' } },
      );

    return version;
  }

  async function recover(version: number): Promise<void> {
    const context = currentContext();
    const revision = await context.models.revisions.getByTargetAndVersion(
      "saved-group",
      GROUP_ID,
      version,
    );
    if (!revision) throw new Error("revision not found");
    const entity = await getAdapter("saved-group")
      .getModel(context)
      .getById(GROUP_ID);
    await publishRevision(
      context,
      revision,
      entity as unknown as Record<string, unknown>,
    );
  }

  it("refuses a superseded merged revision even when live matches its base", async () => {
    // The replay hazard. Content differing from live is true of EVERY superseded
    // revision, and live can be walked back to an old revision's base — so
    // neither mark identifies a stranded merge. What does is that a merge which
    // never landed is still the NEWEST, because nothing published after it.
    //
    // Here revision N is published, then a later revision returns the group to
    // N's own base. N now satisfies both weaker marks and must still be refused:
    // re-applying it would silently overwrite whatever came after.
    const version = await seedStrandedRevision();
    await recover(version);

    // A later revision, published after N, walks the value back to N's base.
    const laterRes = await request(app)
      .post(`/api/v1/saved-groups-revisions/${GROUP_ID}`)
      .send({})
      .set("Authorization", "Bearer foo");
    expect(laterRes.status).toBe(200);
    const laterVersion = laterRes.body.revision.version;
    const laterEdit = await request(app)
      .put(
        `/api/v1/saved-groups-revisions/${GROUP_ID}/${laterVersion}/condition`,
      )
      .send({ condition: '{"id": {"$in": ["before"]}}' })
      .set("Authorization", "Bearer foo");
    expect(laterEdit.status).toBe(200);
    const laterPublish = await request(app)
      .post(
        `/api/v1/saved-groups-revisions/${GROUP_ID}/${laterVersion}/publish`,
      )
      .send({})
      .set("Authorization", "Bearer foo");
    expect(laterPublish.status).toBe(200);

    const live = await mongoose.connection
      .collection("savedgroups")
      .findOne({ id: GROUP_ID });
    expect(live?.condition).toBe('{"id": {"$in": ["before"]}}');

    await expect(recover(version)).rejects.toThrow(
      /Cannot publish a revision with status/,
    );

    // And nothing was applied on the way to the refusal.
    const after = await mongoose.connection
      .collection("savedgroups")
      .findOne({ id: GROUP_ID });
    expect(after?.condition).toBe('{"id": {"$in": ["before"]}}');
  });

  it("applies the stranded changes and records the recovery", async () => {
    const version = await seedStrandedRevision();

    await recover(version);

    const doc = await mongoose.connection
      .collection("savedgroups")
      .findOne({ id: GROUP_ID });
    expect(doc?.condition).toBe('{"id": {"$in": ["after"]}}');

    const revision = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, "target.id": GROUP_ID, version });
    expect(
      (revision?.activityLog ?? []).filter(
        (e: { action: string }) => e.action === "merge-recovered",
      ),
    ).toHaveLength(1);
  });

  it("does not apply or re-record a second time", async () => {
    const version = await seedStrandedRevision();

    await recover(version);

    // Move the live entity out from under the recovered revision. A second
    // recovery would overwrite this; an idempotent one leaves it alone.
    await mongoose.connection
      .collection("savedgroups")
      .updateOne(
        { id: GROUP_ID },
        { $set: { condition: '{"id": {"$in": ["later"]}}' } },
      );

    // A second recovery must be a no-op, not a re-apply. It may also refuse
    // outright once there is nothing left to apply; either is idempotent.
    await recover(version).catch(() => undefined);

    const doc = await mongoose.connection
      .collection("savedgroups")
      .findOne({ id: GROUP_ID });
    expect(doc?.condition).toBe('{"id": {"$in": ["later"]}}');

    const revision = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, "target.id": GROUP_ID, version });
    expect(
      (revision?.activityLog ?? []).filter(
        (e: { action: string }) => e.action === "merge-recovered",
      ),
    ).toHaveLength(1);
  });
});
