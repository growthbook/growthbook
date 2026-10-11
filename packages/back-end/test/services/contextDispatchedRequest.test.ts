import type { Request } from "express";
import { ReqContextClass } from "back-end/src/services/context";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

// No request is a background job (Slack builds one); a request is the web
// chat's own POST.
const makeContext = (req?: Partial<Request>) =>
  new ReqContextClass({
    org: {
      id: "org",
      name: "Org",
      ownerEmail: "admin@example.com",
      url: "",
      dateCreated: new Date(),
      members: [{ id: "admin", role: "admin" }],
    },
    user: { id: "admin", email: "admin@example.com" },
    auditUser: { type: "dashboard", id: "admin", email: "admin@example.com" },
    req: req as Request | undefined,
  });

beforeAll(connectTestMongo, 60000);
afterAll(async () => {
  await waitForIndexes();
  await disconnectTestMongo();
});

it.each([
  { caller: "Slack", req: undefined, default: true },
  {
    caller: "web chat",
    req: { body: { message: "archive it" }, query: {} },
    default: false,
  },
])(
  "reads ignoreWarnings from a dispatched request for a $caller context",
  ({ req, default: withoutDispatch }) => {
    const context = makeContext(req);
    expect(context.ignoreWarnings).toBe(withoutDispatch);
    context.dispatchedRequest = { body: {} };
    expect(context.ignoreWarnings).toBe(false);
    context.dispatchedRequest = { body: { ignoreWarnings: true } };
    expect(context.ignoreWarnings).toBe(true);
    context.dispatchedRequest = { query: { ignoreWarnings: "true" } };
    expect(context.ignoreWarnings).toBe(true);
    context.dispatchedRequest = null;
    expect(context.ignoreWarnings).toBe(withoutDispatch);
  },
);
