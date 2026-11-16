import request from "supertest";
import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { dispatchFeatureRevisionEvent } from "back-end/src/services/featureRevisionEvents";
import { setupApp } from "../api.setup";

// The REST feature update handlers write the feature document once, in the
// landing inside createAndPublishRevision. A second write would let the
// request that landed first put its value back over the one that landed second.

// Only the dispatch is stubbed: it runs right after the landing, so a request
// can be held there while another one lands.
jest.mock("back-end/src/services/featureRevisionEvents", () => ({
  ...jest.requireActual("back-end/src/services/featureRevisionEvents"),
  dispatchFeatureRevisionEvent: jest.fn(),
}));

const mockDispatch = dispatchFeatureRevisionEvent as jest.MockedFunction<
  typeof dispatchFeatureRevisionEvent
>;

const ORG_ID = "org_rest_update_overlap";
const org = {
  id: ORG_ID,
  name: "REST update overlap",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const FLAG = "overlap_flag";

function makeContext(): ReqContextClass {
  return new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: "key_admin" },
    role: "admin",
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
}

async function insertFeature(): Promise<void> {
  await mongoose.connection.collection("features").insertOne({
    id: FLAG,
    organization: ORG_ID,
    owner: "",
    description: "",
    valueType: "string",
    defaultValue: "start",
    version: 1,
    archived: false,
    tags: [],
    rules: [],
    environmentSettings: { production: { enabled: true } },
    prerequisites: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });
  await mongoose.connection.collection("featurerevisions").insertOne({
    id: `frev_${FLAG}_1`,
    organization: ORG_ID,
    featureId: FLAG,
    version: 1,
    baseVersion: 0,
    status: "published",
    createdBy: { type: "api_key", apiKey: "key_admin" },
    comment: "",
    defaultValue: "start",
    rules: [],
    dateCreated: new Date(),
    dateUpdated: new Date(),
    datePublished: new Date(),
  });
}

function readFeatureDoc() {
  return mongoose.connection
    .collection("features")
    .findOne({ organization: ORG_ID, id: FLAG });
}

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("overlapping REST feature updates", () => {
  const { app, setReqContext } = setupApp();
  const send = (path: string, body: unknown) =>
    request(app).post(path).send(body).set("Authorization", "Bearer foo");

  beforeEach(async () => {
    setReqContext(makeContext());
    await insertFeature();
  });

  afterEach(() => {
    mockDispatch.mockReset();
    jest.restoreAllMocks();
  });

  it.each([
    { version: "v1", path: `/api/v1/features/${FLAG}` },
    { version: "v2", path: `/api/v2/features/${FLAG}` },
  ])(
    "$version: the later landing is not reverted by the earlier request",
    async ({ path }) => {
      const gate = deferred();
      let dispatches = 0;
      mockDispatch.mockImplementation(async () => {
        dispatches += 1;
        // The first request to land waits here until the gate opens.
        if (dispatches === 1) await gate.promise;
      });

      // Started now (supertest sends on `then`), awaited after B lands.
      const requestA = send(path, { defaultValue: "from-a" }).then((r) => r);
      let responseA: Awaited<typeof requestA>;
      try {
        await waitUntil(() => dispatches === 1);

        const responseB = await send(path, { defaultValue: "from-b" });
        expect(responseB.status).toBe(200);
        expect(responseB.body.feature.defaultValue).toBe("from-b");
        expect(responseB.body.feature.revision.version).toBe(3);
      } finally {
        // Never leave request A parked, even if an assertion above throws.
        gate.resolve();
        responseA = await requestA;
      }
      expect(responseA.status).toBe(200);
      expect(responseA.body.feature.defaultValue).toBe("from-a");
      expect(responseA.body.feature.revision.version).toBe(2);

      const doc = await readFeatureDoc();
      expect(doc?.defaultValue).toBe("from-b");
      expect(doc?.version).toBe(3);
    },
  );

  it("v1: a scheduled rule sets nextScheduledUpdate from the new rules", async () => {
    // Scheduled rules are a paid feature.
    jest
      .spyOn(ReqContextClass.prototype, "hasPremiumFeature")
      .mockReturnValue(true);
    const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    startsAt.setMilliseconds(0);
    const response = await send(`/api/v1/features/${FLAG}`, {
      environments: {
        production: {
          enabled: true,
          rules: [
            {
              type: "force",
              value: "later",
              scheduleRules: [
                { enabled: true, timestamp: startsAt.toISOString() },
                { enabled: false, timestamp: null },
              ],
            },
          ],
        },
      },
    });
    expect(response.status).toBe(200);
    expect(response.body.feature.revision.version).toBe(2);

    const doc = await readFeatureDoc();
    expect(doc?.version).toBe(2);
    expect(doc?.nextScheduledUpdate).toEqual(startsAt);
  });

  it("a request that changes nothing leaves the document untouched", async () => {
    const before = await readFeatureDoc();
    const response = await send(`/api/v1/features/${FLAG}`, {
      defaultValue: "start",
    });
    expect(response.status).toBe(200);
    expect(response.body.feature.defaultValue).toBe("start");
    expect(response.body.feature.revision.version).toBe(1);

    const after = await readFeatureDoc();
    expect(after?.version).toBe(1);
    expect(after?.dateUpdated).toEqual(before?.dateUpdated);
  });
});
