import type { Response } from "express";
import { getConfirmation } from "back-end/src/routers/confirmations/confirmations.controller";
import { encryptSecretFields } from "back-end/src/services/confirmations";
import { getConfirmationForDecider } from "back-end/src/services/confirmationDecisions";
import type { AuthRequest } from "back-end/src/types/AuthRequest";

jest.mock("back-end/src/api/api.router", () => ({ allRoutes: [] }));
jest.mock("back-end/src/services/organizations", () => ({
  getContextFromReq: () => ({
    models: { apiKeys: { dangerousGetById: async () => null } },
  }),
}));
jest.mock("back-end/src/services/confirmationDecisions", () => ({
  getConfirmationForDecider: jest.fn(),
  canDecide: () => true,
}));

const body = {
  name: "Warehouse",
  connection: {
    type: "postgres",
    host: "db.example.com",
    password: "hunter2",
  },
};

describe("getConfirmation", () => {
  it("shows a held connection without its secrets", async () => {
    jest.mocked(getConfirmationForDecider).mockResolvedValue({
      id: "cnf_1",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      actions: [],
      query: {},
      body: encryptSecretFields(body, ["connection"]),
      secretBodyFields: ["connection"],
      userId: null,
      requestedBy: null,
    } as never);
    const json = jest.fn();
    const res = { status: () => ({ json }) } as unknown as Response;

    await getConfirmation(
      { params: { id: "cnf_1" } } as AuthRequest<unknown, { id: string }>,
      res,
    );

    const sent = json.mock.calls[0][0];
    expect(JSON.stringify(sent)).not.toContain("hunter2");
    expect(sent.request.body).toEqual({
      name: "Warehouse",
      connection: {
        type: "postgres",
        host: "db.example.com",
        password: "[redacted]",
      },
    });
  });
});
