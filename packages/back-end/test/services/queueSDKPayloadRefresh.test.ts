import { EventEmitter } from "events";

// Each call marks the start of one refresh: it is refreshSDKPayloadCache's first step.
const mockGetContextForAgendaJob = jest.fn((org: { id: string }) => {
  throw new Error(`refresh started for ${org.id}`);
});

jest.mock("back-end/src/services/organizations", () => ({
  getContextForAgendaJobByOrgObject: (org: { id: string }) =>
    mockGetContextForAgendaJob(org),
}));

import type { Request } from "express";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";

function makeRequest() {
  const res = Object.assign(new EventEmitter(), {
    headersSent: false,
    destroyed: false,
  });
  const req = { res } as unknown as Request;
  return { req, res };
}

function makeContext(req?: Request): ReqContext {
  return { org: { id: "org_1" }, req } as unknown as ReqContext;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  mockGetContextForAgendaJob.mockClear();
  jest.spyOn(logger, "error").mockImplementation(() => logger);
});

describe("queueSDKPayloadRefresh", () => {
  it("coalesces refreshes queued during one request into one", async () => {
    const { req, res } = makeRequest();

    queueSDKPayloadRefresh({
      context: makeContext(req),
      payloadKeys: [{ environment: "production", project: "" }],
    });
    // A separate context for the same request, as getContextFromReq returns.
    queueSDKPayloadRefresh({
      context: makeContext(req),
      payloadKeys: [
        { environment: "production", project: "" },
        { environment: "dev", project: "" },
      ],
    });
    await flush();
    expect(mockGetContextForAgendaJob).not.toHaveBeenCalled();

    res.emit("close");
    await flush();
    expect(mockGetContextForAgendaJob).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately without a request", async () => {
    queueSDKPayloadRefresh({
      context: makeContext(),
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await flush();
    expect(mockGetContextForAgendaJob).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately once headers are sent", async () => {
    const { req, res } = makeRequest();
    res.headersSent = true;

    queueSDKPayloadRefresh({
      context: makeContext(req),
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await flush();
    expect(mockGetContextForAgendaJob).toHaveBeenCalledTimes(1);
  });

  it("refreshes immediately when the client already disconnected", async () => {
    const { req, res } = makeRequest();
    res.destroyed = true;
    res.emit("close");

    queueSDKPayloadRefresh({
      context: makeContext(req),
      payloadKeys: [{ environment: "production", project: "" }],
    });
    await flush();
    expect(mockGetContextForAgendaJob).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce a refresh that skips a project", async () => {
    const { req } = makeRequest();

    queueSDKPayloadRefresh({
      context: makeContext(req),
      payloadKeys: [{ environment: "production", project: "" }],
      skipRefreshForProject: "prj_1",
    });
    await flush();
    expect(mockGetContextForAgendaJob).toHaveBeenCalledTimes(1);
  });
});
