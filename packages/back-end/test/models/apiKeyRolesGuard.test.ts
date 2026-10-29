import mongoose from "mongoose";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { requireConfirmation } from "back-end/src/services/confirmations";
import { setupApp } from "../api/api.setup";

jest.mock("back-end/src/services/confirmations", () => ({
  ...jest.requireActual("back-end/src/services/confirmations"),
  requireConfirmation: jest.fn(),
}));

/**
 * The REST role write is guarded on the key the checks and confirmation saw,
 * so a key edited or deleted in between is refused with nothing audited.
 */

const ORG_ID = "org_api_key_roles_guard";

const org = {
  id: ORG_ID,
  name: "API key guard",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production" }] },
} as unknown as OrganizationInterface;

const roles = {
  role: "engineer",
  limitAccessByEnvironment: false,
  environments: [],
  additionalRoles: [],
  projectRoles: [],
};

describe("replaceRolesForApi's write guard", () => {
  setupApp();
  let context: ReqContextClass;
  const keys = () => mongoose.connection.collection("apikeys");
  const audits = () =>
    mongoose.connection
      .collection("audits")
      .find({ organization: ORG_ID, event: "apiKey.update" })
      .toArray();

  beforeEach(async () => {
    context = new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_caller" },
      role: "admin",
    });
    await keys().deleteMany({ organization: ORG_ID });
    await mongoose.connection
      .collection("audits")
      .deleteMany({ organization: ORG_ID });
    await keys().insertOne({
      id: "key_target",
      key: "secret_readonly_target",
      organization: ORG_ID,
      secret: true,
      role: "readonly",
      description: "target",
      limitAccessByEnvironment: false,
      environments: [],
      dateCreated: new Date(Date.now() - 60_000),
      dateUpdated: new Date(Date.now() - 60_000),
    });
  });

  it("saves and audits an untouched key", async () => {
    const { key, changed } = await context.models.apiKeys.replaceRolesForApi(
      "key_target",
      roles,
      false,
    );
    expect(changed).toBe(true);
    expect(key.role).toBe("engineer");
    expect(await audits()).toHaveLength(1);
  });

  it("is a 409 with nothing saved when the key changes while waiting", async () => {
    jest.mocked(requireConfirmation).mockImplementationOnce(async () => {
      await keys().updateOne(
        { id: "key_target" },
        { $set: { role: "analyst", dateUpdated: new Date() } },
      );
    });
    await expect(
      context.models.apiKeys.replaceRolesForApi("key_target", roles, false),
    ).rejects.toBeInstanceOf(CasConflictError);
    expect((await keys().findOne({ id: "key_target" }))?.role).toBe("analyst");
    expect(await audits()).toHaveLength(0);
  });

  it("is a 404 with nothing audited when the key is deleted while waiting", async () => {
    jest.mocked(requireConfirmation).mockImplementationOnce(async () => {
      await keys().deleteOne({ id: "key_target" });
    });
    await expect(
      context.models.apiKeys.replaceRolesForApi("key_target", roles, false),
    ).rejects.toMatchObject({ status: 404 });
    expect(await audits()).toHaveLength(0);
  });
});
