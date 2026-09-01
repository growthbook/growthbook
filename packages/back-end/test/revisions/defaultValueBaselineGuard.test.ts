import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { postFeatureDefaultValue } from "back-end/src/controllers/features";
import { setupApp } from "../api/api.setup";

const ORG_ID = "org_default_value_guard";
const FEATURE_ID = "default-value-guarded-flag";

const org = {
  id: ORG_ID,
  name: "Default Value Guard",
  ownerEmail: "t@t.co",
  url: "",
  dateCreated: new Date(),
  members: [
    {
      id: "u_admin",
      role: "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
  ],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

describe("postFeatureDefaultValue baseline guard", () => {
  setupApp();

  const reqFor = (
    version: number,
    body: Record<string, unknown>,
  ): Parameters<typeof postFeatureDefaultValue>[0] =>
    ({
      params: { id: FEATURE_ID, version: String(version) },
      body,
      organization: org,
      userId: "u_admin",
      email: "a@t.co",
      name: "A",
      query: {},
      headers: {},
      audit: jest.fn(),
    }) as unknown as Parameters<typeof postFeatureDefaultValue>[0];

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

  const seed = async (draftDefaultValue: string) => {
    for (const c of ["features", "featurerevisions"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("features").insertOne({
      id: FEATURE_ID,
      organization: ORG_ID,
      valueType: "string" as const,
      defaultValue: "live",
      version: 1,
      project: "",
      environmentSettings: { production: { enabled: true, rules: [] } },
      rules: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    for (const [version, status, value] of [
      [1, "published", "live"],
      [2, "draft", draftDefaultValue],
    ] as const) {
      await mongoose.connection.collection("featurerevisions").insertOne({
        organization: ORG_ID,
        featureId: FEATURE_ID,
        version,
        status,
        baseVersion: 1,
        createdBy: {
          type: "dashboard",
          id: "u_admin",
          email: "a@t.co",
          name: "A",
        },
        comment: "",
        rules: [],
        defaultValue: value,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
    }
  };

  const storedDefault = async (version: number) =>
    (
      await mongoose.connection
        .collection("featurerevisions")
        .findOne({ organization: ORG_ID, featureId: FEATURE_ID, version })
    )?.defaultValue;

  it("saves when the baseline matches the draft", async () => {
    await seed("live");
    const { res, captured } = resSpy();
    await postFeatureDefaultValue(
      reqFor(2, { defaultValue: "mine", baseline: { defaultValue: "live" } }),
      res,
    );
    expect(captured.status).toBe(200);
    expect(await storedDefault(2)).toBe("mine");
  });

  it("409s and writes nothing when the draft moved under the editor", async () => {
    await seed("theirs");
    const { res, captured } = resSpy();
    await postFeatureDefaultValue(
      reqFor(2, { defaultValue: "mine", baseline: { defaultValue: "live" } }),
      res,
    );
    expect(captured.status).toBe(409);
    expect(await storedDefault(2)).toBe("theirs");
  });

  it("409s when another write lands between the baseline check and the write", async () => {
    await seed("live");
    const { res, captured } = resSpy();
    const collection = mongoose.connection.collection("featurerevisions");
    const realFindOne = collection.findOne.bind(collection);
    let raced = false;
    jest
      .spyOn(collection, "findOne")
      .mockImplementation(async (...args: unknown[]) => {
        const doc = await (
          realFindOne as (...a: unknown[]) => Promise<unknown>
        )(...args);
        if (!raced) {
          raced = true;
          await collection.updateOne(
            { organization: ORG_ID, featureId: FEATURE_ID, version: 2 },
            { $set: { defaultValue: "landed-first", dateUpdated: new Date() } },
          );
        }
        return doc;
      });

    try {
      await postFeatureDefaultValue(
        reqFor(2, { defaultValue: "mine", baseline: { defaultValue: "live" } }),
        res,
      );
    } finally {
      jest.restoreAllMocks();
    }

    expect(captured.status).toBe(409);
    expect(await storedDefault(2)).toBe("landed-first");
  });

  it("keeps last-write-wins when no baseline is sent", async () => {
    await seed("theirs");
    const { res, captured } = resSpy();
    await postFeatureDefaultValue(reqFor(2, { defaultValue: "mine" }), res);
    expect(captured.status).toBe(200);
    expect(await storedDefault(2)).toBe("mine");
  });
});
