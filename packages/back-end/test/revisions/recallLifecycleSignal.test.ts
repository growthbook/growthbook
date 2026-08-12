import mongoose from "mongoose";
import type { Response } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import {
  postRecallReview,
  postReopen,
} from "back-end/src/routers/revision/revision.controller";
import { setupApp } from "../api/api.setup";

/**
 * Recall and reopen are different events. Both land on `draft` but mean opposite
 * things: recall RETRACTS a review request, clearing every verdict and disarming
 * any deferred publish; reopen REVIVES discarded work. Conflating them wakes
 * `revision.reopened` consumers on every recall and gives recall no event at all.
 *
 * The webhook half is the one that can regress silently: it is a single literal in
 * a call the type checker is happy with either way.
 */

const dispatch = jest.fn();
jest.mock("back-end/src/events/revisionWebhookAdapters", () => ({
  ...jest.requireActual("back-end/src/events/revisionWebhookAdapters"),
  getRevisionWebhookAdapter: () => ({ dispatch }),
}));

const ORG_ID = "org_recall_signal";
const org = {
  id: ORG_ID,
  name: "Recall Signal",
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

describe("recall is a distinct lifecycle signal from reopen", () => {
  setupApp();

  const REV_ID = "rev_recall_signal";

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

  const seed = async (status: string) => {
    for (const c of ["revisions", "constants"]) {
      await mongoose.connection
        .collection(c)
        .deleteMany({ organization: ORG_ID });
    }
    await mongoose.connection.collection("constants").insertOne({
      id: "cst_signal",
      organization: ORG_ID,
      key: "cst_signal",
      name: "cst_signal",
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
      status,
      authorId: "u_admin",
      reviews: [],
      activityLog: [],
      contributors: [],
      target: {
        type: "constant",
        id: "cst_signal",
        snapshot: { id: "cst_signal", key: "cst_signal", project: "" },
        proposedChanges: [],
      },
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });
  };

  const activityActions = async () => {
    const row = await mongoose.connection
      .collection("revisions")
      .findOne({ organization: ORG_ID, id: REV_ID });
    return ((row?.activityLog ?? []) as { action: string }[]).map(
      (e) => e.action,
    );
  };

  beforeEach(() => dispatch.mockClear());

  it("recall emits `recalled`, not `reopened`", async () => {
    await seed("pending-review");
    const { res, captured } = resSpy();
    await postRecallReview(req(), res);

    expect(captured.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][2]).toEqual({ type: "recalled" });
    expect(await activityActions()).toEqual(["recalled"]);
  });

  it("reopen still emits `reopened`", async () => {
    // The control. A fix that simply renamed the event everywhere would pass the
    // case above and break the consumer this one represents.
    await seed("discarded");
    const { res, captured } = resSpy();
    await postReopen(req(), res);

    expect(captured.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][2]).toEqual({ type: "reopened" });
    expect(await activityActions()).toEqual(["reopened"]);
  });
});
