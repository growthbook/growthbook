import type { Request, Response } from "express";
import { scrubRevisionResponses } from "back-end/src/routers/revision/scrubRevisionResponses";
import { scrubRevisionForViewer } from "back-end/src/revisions/scrub";

jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: () => ({}),
}));
jest.mock("back-end/src/revisions", () => ({
  getAdapter: (type: string) =>
    type === "sdk-connection" ? { scrubForViewer: jest.fn() } : {},
}));
jest.mock("back-end/src/revisions/scrub", () => ({
  scrubRevisionForViewer: jest.fn(async (context, revision) => ({
    ...revision,
    scrubbed: true,
  })),
}));

const revision = (type: string) => ({
  id: type,
  target: { type, snapshot: {} },
});

function send(body: unknown) {
  const sent = jest.fn();
  const next = jest.fn();
  const res = { json: sent } as unknown as Response;
  scrubRevisionResponses({} as Request, res, next);
  res.json(body);
  return { sent, next, settled: () => new Promise(setImmediate) };
}

describe("scrubRevisionResponses", () => {
  it("sends a response with nothing to scrub as it is, at once", () => {
    const body = { status: 200, revision: revision("saved-group") };
    const { sent } = send(body);
    expect(sent).toHaveBeenCalledWith(body);
  });

  it("scrubs a revision and each of a list before sending", async () => {
    const { sent, settled } = send({
      status: 200,
      revision: revision("sdk-connection"),
      revisions: [revision("sdk-connection"), revision("saved-group")],
    });
    expect(sent).not.toHaveBeenCalled();
    await settled();
    expect(sent).toHaveBeenCalledWith({
      status: 200,
      revision: { ...revision("sdk-connection"), scrubbed: true },
      revisions: [
        { ...revision("sdk-connection"), scrubbed: true },
        revision("saved-group"),
      ],
    });
  });

  it("sends the error, never the revision, when scrubbing fails", async () => {
    jest
      .mocked(scrubRevisionForViewer)
      .mockRejectedValueOnce(new Error("boom"));
    const { sent, next, settled } = send({
      revision: revision("sdk-connection"),
    });
    await settled();
    expect(sent).not.toHaveBeenCalled();
    expect(next).toHaveBeenLastCalledWith(new Error("boom"));
  });
});
