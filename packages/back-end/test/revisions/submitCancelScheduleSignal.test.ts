import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { postSubmit } from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

const dispatch = jest.fn();
jest.mock("back-end/src/events/revisionWebhookAdapters", () => ({
  ...jest.requireActual("back-end/src/events/revisionWebhookAdapters"),
  getRevisionWebhookAdapter: () => ({ dispatch }),
}));

const ORG_ID = "org_submit_cancel_signal";
const org = {
  id: ORG_ID,
  name: "Submit Cancel Signal",
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
  settings: {},
} as unknown as OrganizationInterface;

describe("submitting unarmed cancels a schedule and signals it", () => {
  setupApp();

  const REV_ID = "rev_submit_cancel_signal";

  const resSpy = () => {
    const captured: { status?: number } = {};
    const res = {
      status(code: number) {
        captured.status = code;
        return this;
      },
      json() {
        return this;
      },
    } as unknown as Response;
    return { res, captured };
  };

  const req = () =>
    ({
      params: { id: REV_ID },
      body: {},
      query: {},
      organization: org,
      userId: "u_admin",
      email: "a@t.co",
      name: "A",
      headers: {},
    }) as never;

  const seed = async (armed: boolean) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_cancel",
      organization: ORG_ID,
      key: "cst_cancel",
      name: "cst_cancel",
      type: "string",
      value: "v",
      owner: "",
      project: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
    await mongoose.connection.collection("revisions").insertOne({
      id: REV_ID,
      organization: ORG_ID,
      version: 2,
      status: "draft",
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      ...(armed
        ? {
            autoPublishOnApproval: true,
            scheduledPublishAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          }
        : {}),
      target: {
        type: "constant",
        id: "cst_cancel",
        snapshot: { id: "cst_cancel", key: "cst_cancel", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const dispatchedTypes = () =>
    dispatch.mock.calls.map((c) => (c[2] as { type: string })?.type);

  const storedSchedule = async () => {
    const row = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });
    return {
      autoPublishOnApproval: row?.autoPublishOnApproval ?? null,
      scheduledPublishAt: row?.scheduledPublishAt ?? null,
    };
  };

  beforeEach(() => dispatch.mockClear());

  it("an armed revision submitted unarmed clears the schedule and emits publishScheduleChanged", async () => {
    await seed(true);
    const { res, captured } = resSpy();
    await postSubmit(req(), res);

    expect(captured.status).toBe(200);
    const schedule = await storedSchedule();
    expect(schedule.autoPublishOnApproval).not.toBe(true);
    expect(schedule.scheduledPublishAt ?? null).toBeNull();
    expect(dispatchedTypes()).toEqual(
      expect.arrayContaining(["reviewRequested", "publishScheduleChanged"]),
    );
  });

  it("an unarmed revision submitted unarmed emits no schedule signal", async () => {
    await seed(false);
    const { res, captured } = resSpy();
    await postSubmit(req(), res);

    expect(captured.status).toBe(200);
    expect(dispatchedTypes()).toContain("reviewRequested");
    expect(dispatchedTypes()).not.toContain("publishScheduleChanged");
  });
});
