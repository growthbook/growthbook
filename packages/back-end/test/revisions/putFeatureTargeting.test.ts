import { MockedFunction, vi } from "vitest";
import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { postFeatureFork, putFeature } from "back-end/src/controllers/features";
import { putOrganization } from "back-end/src/routers/organizations/organizations.controller";
import { publishRevision } from "back-end/src/models/FeatureModel";
import { setupApp } from "../api/api.setup";

// A lazy proxy, not a spread: the module's exports are getters that trip the
// temporal dead zone while its import cycle is still resolving.
vi.mock("back-end/src/models/FeatureModel", async () => {
  const actual = await vi.importActual<
    typeof import("back-end/src/models/FeatureModel")
  >("back-end/src/models/FeatureModel");
  const publishRevisionMock = vi.fn();
  return new Proxy(actual, {
    get: (target, key) =>
      key === "publishRevision"
        ? publishRevisionMock
        : Reflect.get(target, key),
  });
});

const mockPublishRevision = publishRevision as MockedFunction<
  typeof publishRevision
>;

const ORG_ID = "org_put_feature_targeting";
const FEATURE_ID = "targeted-flag";
const PRJ_A = "prj_a";
const PRJ_B = "prj_b";

const org = {
  id: ORG_ID,
  name: "Put Feature Targeting",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  customRoles: [
    {
      id: "flag_editor",
      description: "",
      policies: ["ReadData", "FlagsCreate", "FlagsEditDrafts", "FlagsPublish"],
    },
  ],
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    // Edits and publishes everywhere, but may not widen delivery anywhere.
    {
      id: "u_editor",
      role: "flag_editor",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

setupApp();

describe("putFeature targeting", () => {
  const reqFor = (userId: string, body: Record<string, unknown>) =>
    ({
      params: { id: FEATURE_ID },
      body,
      organization: org,
      userId,
      email: `${userId}@t.co`,
      name: userId,
      query: {},
      headers: {},
      audit: vi.fn(),
    }) as unknown as Parameters<typeof putFeature>[0];

  const resSpy = () => {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      locals: {
        eventAudit: {
          type: "dashboard",
          id: "u_admin",
          email: "a@t.co",
          name: "A",
        },
      },
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    return { res, captured };
  };

  const revisions = () => mongoose.connection.collection("featurerevisions");

  const seed = async (staged?: { targetingProjects: string[] }) => {
    for (const c of ["features", "featurerevisions", "projects"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    for (const id of [PRJ_A, PRJ_B]) {
      await mongoose.connection.collection("projects").insertOne({
        id,
        organization: ORG_ID,
        name: id,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
    }
    await mongoose.connection.collection("features").insertOne({
      id: FEATURE_ID,
      organization: ORG_ID,
      valueType: "boolean",
      defaultValue: "false",
      version: 1,
      project: PRJ_B,
      targetingProjects: [],
      environmentSettings: { production: { enabled: false, rules: [] } },
      rules: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await revisions().insertOne(
      revisionDoc({ version: 1, status: "published" }),
    );
    if (staged) {
      await revisions().insertOne(
        revisionDoc({ version: 2, status: "draft", metadata: staged }),
      );
    }
  };
  const revisionDoc = (overrides: Record<string, unknown>) => ({
    organization: ORG_ID,
    featureId: FEATURE_ID,
    baseVersion: 1,
    createdBy: {
      type: "dashboard",
      id: "u_admin",
      email: "a@t.co",
      name: "A",
    },
    comment: "",
    rules: {},
    defaultValue: "false",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    ...overrides,
  });

  it("refuses an unknown targeting project as a permission error before checking it exists", async () => {
    await seed();
    await expect(
      putFeature(
        reqFor("u_editor", { targetingProjects: ["prj_missing"] }),
        resSpy().res,
      ),
    ).rejects.toThrow(
      "You do not have permission to target project prj_missing",
    );

    await expect(
      putFeature(
        reqFor("u_admin", { targetingProjects: ["prj_missing"] }),
        resSpy().res,
      ),
    ).rejects.toThrow("Invalid project ids: prj_missing");
  });

  it("treats echoing a colleague's staged targeting as no addition, even without a baseline", async () => {
    await seed({ targetingProjects: [PRJ_A] });
    const { res, captured } = resSpy();
    await putFeature(
      reqFor("u_editor", { targetingProjects: [PRJ_A], description: "edited" }),
      res,
    );
    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({ draftVersion: 2 });
  });

  it("lets a staged targeting project be put back to the live value", async () => {
    await seed({ targetingProjects: [PRJ_A] });
    const { res, captured } = resSpy();
    await putFeature(
      reqFor("u_admin", { targetingProjects: [], targetDraftVersion: 2 }),
      res,
    );
    expect(captured.status).toBe(200);
    const draft = await revisions().findOne({
      organization: ORG_ID,
      version: 2,
    });
    expect(draft?.metadata?.targetingProjects).toEqual([]);
  });

  it("lets a draft put back what its base revision targeted, even after live moved on", async () => {
    await seed();
    // Base v1 targeted A; live is now v3 without it; draft v2 (from v1) dropped it.
    await revisions().updateOne(
      { organization: ORG_ID, version: 1 },
      { $set: { metadata: { targetingProjects: [PRJ_A] } } },
    );
    await revisions().insertMany([
      revisionDoc({
        version: 2,
        status: "draft",
        metadata: { targetingProjects: [] },
      }),
      revisionDoc({
        version: 3,
        status: "published",
        metadata: { targetingProjects: [] },
      }),
    ]);
    await mongoose.connection
      .collection("features")
      .updateOne(
        { organization: ORG_ID, id: FEATURE_ID },
        { $set: { version: 3 } },
      );

    const { res, captured } = resSpy();
    await putFeature(
      reqFor("u_editor", { targetingProjects: [PRJ_A], targetDraftVersion: 2 }),
      res,
    );
    expect(captured.status).toBe(200);
    const draft = await revisions().findOne({
      organization: ORG_ID,
      version: 2,
    });
    expect(draft?.metadata?.targetingProjects).toEqual([PRJ_A]);
  });

  it("refuses a published revision as the write target", async () => {
    await seed();
    await expect(
      putFeature(
        reqFor("u_admin", { description: "edited", targetDraftVersion: 1 }),
        resSpy().res,
      ),
    ).rejects.toThrow('Cannot edit a revision with status "published"');
  });

  it("forking a revision that targeted more takes the atom", async () => {
    await seed();
    await revisions().updateOne(
      { organization: ORG_ID, version: 1 },
      { $set: { metadata: { targetingProjects: [PRJ_A] } } },
    );
    const fork = (userId: string) =>
      postFeatureFork(
        {
          ...reqFor(userId, {}),
          params: { id: FEATURE_ID, version: "1" },
        } as unknown as Parameters<typeof postFeatureFork>[0],
        resSpy().res,
      );
    await expect(fork("u_editor")).rejects.toThrow(
      "You do not have permission to target project prj_a",
    );
    await expect(fork("u_admin")).resolves.toBeUndefined();
  });

  describe("a refused autoPublish", () => {
    const failingPublish = (landsPointer: boolean) =>
      mockPublishRevision.mockImplementation(async ({ feature, revision }) => {
        if (landsPointer) {
          await mongoose.connection
            .collection("features")
            .updateOne(
              { organization: ORG_ID, id: feature.id },
              { $set: { version: revision.version } },
            );
        }
        throw new Error("publish failed");
      });

    it("removes the draft it created when nothing landed", async () => {
      await seed();
      failingPublish(false);
      await expect(
        putFeature(
          reqFor("u_admin", { description: "edited", autoPublish: true }),
          resSpy().res,
        ),
      ).rejects.toThrow("publish failed");
      expect(
        await revisions().countDocuments({
          organization: ORG_ID,
          status: "draft",
        }),
      ).toBe(0);
    });

    it("keeps the draft when the live pointer already moved onto it", async () => {
      await seed();
      failingPublish(true);
      await expect(
        putFeature(
          reqFor("u_admin", { description: "edited", autoPublish: true }),
          resSpy().res,
        ),
      ).rejects.toThrow("publish failed");
      expect(
        await revisions().countDocuments({
          organization: ORG_ID,
          status: "draft",
        }),
      ).toBe(1);
    });
  });
});

describe("putOrganization targetingReviewMode", () => {
  const put = async (targetingReviewMode: unknown[]) => {
    const req = {
      body: { settings: { targetingReviewMode } },
      organization: org,
      userId: "u_admin",
      email: "a@t.co",
      name: "A",
      query: {},
      headers: {},
      audit: vi.fn(),
    } as unknown as Parameters<typeof putOrganization>[0];
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      locals: {},
      status(code: number) {
        captured.status = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        return this;
      },
    } as unknown as Response;
    await putOrganization(req, res);
    return captured;
  };

  it("refuses overlapping rules like the REST settings route", async () => {
    const captured = await put([
      { projects: [], mode: "loose" },
      { projects: [], mode: "strict" },
    ]);
    expect(captured.status).toBe(400);
    expect(captured.body).toMatchObject({
      message:
        "Only one organization-wide targetingReviewMode rule is allowed.",
    });
  });

  it("drops a rule naming a project that no longer exists instead of refusing the save", async () => {
    const captured = await put([{ projects: ["prj_nope"], mode: "loose" }]);
    expect(captured.status).toBe(200);
  });
});
