import { vi } from "vitest";
import { omit } from "lodash";
import { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import {
  createSDKConnection,
  editSDKConnection,
  findSDKConnectionById,
} from "back-end/src/models/SdkConnectionModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

vi.mock("back-end/src/services/features", () => ({
  queueSDKPayloadRefresh: vi.fn(),
}));

vi.mock("back-end/src/services/audit", () => ({
  createModelAuditLogger: () => ({
    logCreate: vi.fn(),
    logUpdate: vi.fn(),
    logDelete: vi.fn(),
  }),
}));

const mockedRefresh = vi.mocked(queueSDKPayloadRefresh);

const org: OrganizationInterface = {
  id: "org_1",
  url: "",
  dateCreated: new Date(),
  name: "Test org",
  ownerEmail: "test@test.com",
  members: [],
  invites: [],
};

// Built after connecting, since creating a context sets up the models, which
// needs the database.
let context: ReqContextClass;

const createConnection = () =>
  createSDKConnection(context, {
    organization: "org_1",
    name: "Connection",
    languages: ["javascript"],
    sdkVersion: "1.7.0",
    environment: "production",
    projects: [],
    encryptPayload: true,
    hashSecureAttributes: true,
    includeVisualExperiments: false,
    includeDraftExperiments: false,
    includeExperimentNames: true,
    includeRedirectExperiments: false,
    includeRuleIds: false,
    includeProjectIdInMetadata: false,
    includeCustomFieldsInMetadata: false,
    allowedCustomFieldsInMetadata: [],
    includeTagsInMetadata: false,
  });

// The REST API update handler passes every field it did not receive as
// `undefined` rather than leaving it out.
const leftOut = {
  name: undefined,
  languages: undefined,
  environment: undefined,
  encryptPayload: undefined,
  hashSecureAttributes: undefined,
  includeExperimentNames: undefined,
};

describe("editSDKConnection", () => {
  beforeAll(async () => {
    await connectTestMongo();
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
    });
  });
  afterAll(disconnectTestMongo);
  beforeEach(() => mockedRefresh.mockClear());

  it("rebuilds the payload from the saved values of fields that were left out", async () => {
    const connection = await createConnection();
    mockedRefresh.mockClear();

    await editSDKConnection(context, connection, {
      ...leftOut,
      includeRuleIds: true,
    });

    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    const [rebuilt] = mockedRefresh.mock.calls[0][0].sdkConnections ?? [];
    // Everything but the edited field, and the fields the edit always
    // recomputes, should match what was saved.
    expect(rebuilt).toMatchObject({
      ...omit(connection, ["proxy", "dateUpdated", "includeRuleIds"]),
      includeRuleIds: true,
    });
  });

  it("does not rebuild the payload when the sent fields are unchanged", async () => {
    const connection = await createConnection();
    mockedRefresh.mockClear();

    await editSDKConnection(context, connection, {
      ...leftOut,
      includeRuleIds: connection.includeRuleIds,
    });

    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("leaves the saved connection's other fields as they were", async () => {
    const connection = await createConnection();

    await editSDKConnection(context, connection, {
      ...leftOut,
      includeRuleIds: true,
    });

    const saved = await findSDKConnectionById(context, connection.id);
    expect(saved).toMatchObject({
      ...omit(connection, ["proxy", "dateUpdated", "includeRuleIds"]),
      includeRuleIds: true,
    });
  });
});
