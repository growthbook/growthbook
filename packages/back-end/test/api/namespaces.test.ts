import request from "supertest";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import { countActiveExperimentsUsingNamespace } from "back-end/src/models/ExperimentModel";
import { countFeaturesWithExperimentRuleInNamespace } from "back-end/src/models/FeatureModel";
import { setupApp } from "./api.setup";

jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: jest.fn(),
  updateOrganization: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentModel", () => ({
  countActiveExperimentsUsingNamespace: jest.fn(),
}));

jest.mock("back-end/src/models/FeatureModel", () => ({
  countFeaturesWithExperimentRuleInNamespace: jest.fn(),
}));

describe("namespaces API in-use guards", () => {
  const { app, setReqContext } = setupApp();

  beforeEach(() => {
    setReqContext({
      org: {
        id: "org_1",
        settings: {
          namespaces: [
            {
              name: "ns_checkout",
              label: "Checkout",
              description: "",
              status: "active",
              format: "multiRange",
              hashAttribute: "id",
              seed: "seed-1",
            },
          ],
        },
      },
      permissions: {
        canUpdateNamespace: () => true,
        canDeleteNamespace: () => true,
      },
    });
    // One experiment currently allocates traffic in the namespace; no legacy
    // inline feature experiment rules do.
    jest.mocked(countActiveExperimentsUsingNamespace).mockResolvedValue(1);
    jest
      .mocked(countFeaturesWithExperimentRuleInNamespace)
      .mockResolvedValue(0);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("refuses to change the hash attribute of a namespace in use", async () => {
    const response = await request(app)
      .put("/api/v1/namespaces/ns_checkout")
      .send({ hashAttribute: "device_id" })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/in use by 1 experiment/);
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("refuses when only a feature's inline experiment rule uses the namespace", async () => {
    jest.mocked(countActiveExperimentsUsingNamespace).mockResolvedValue(0);
    jest
      .mocked(countFeaturesWithExperimentRuleInNamespace)
      .mockResolvedValue(2);

    const response = await request(app)
      .put("/api/v1/namespaces/ns_checkout")
      .send({ hashAttribute: "device_id" })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/2 feature experiment rule/);
  });

  it("allows a hash attribute change when nothing uses the namespace", async () => {
    jest.mocked(countActiveExperimentsUsingNamespace).mockResolvedValue(0);

    const response = await request(app)
      .put("/api/v1/namespaces/ns_checkout")
      .send({ hashAttribute: "device_id" })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(response.body.namespace.hashAttribute).toBe("device_id");
    expect(updateOrganization).toHaveBeenCalled();
  });

  it("allows other edits that resend the current hash attribute while in use", async () => {
    const response = await request(app)
      .put("/api/v1/namespaces/ns_checkout")
      .send({ status: "inactive", hashAttribute: "id" })
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(200);
    expect(countActiveExperimentsUsingNamespace).not.toHaveBeenCalled();
    expect(updateOrganization).toHaveBeenCalled();
  });

  it("refuses to delete a namespace in use", async () => {
    const response = await request(app)
      .delete("/api/v1/namespaces/ns_checkout")
      .set("Authorization", "Bearer foo");

    expect(response.status).toBe(409);
    expect(updateOrganization).not.toHaveBeenCalled();
  });
});
