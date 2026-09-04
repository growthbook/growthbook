import mongoose from "mongoose";
import request from "supertest";
import { setupApp } from "./api.setup";

describe("POST /api/v1/metrics", () => {
  const { app, setReqContext } = setupApp();
  const organization = {
    id: "org_metric_create_order",
    settings: {},
    members: [],
  };

  beforeEach(() => {
    setReqContext({
      org: organization,
      auditUser: { type: "api_key", apiKey: "test-key" },
      permissions: {
        canReadMultiProjectResource: () => true,
        canCreateMetric: () => false,
        throwPermissionError: () => {
          throw new Error("Permission denied");
        },
      },
    });
  });

  it("does not register tags when metric creation is denied", async () => {
    await mongoose.connection.db!.collection("datasources").insertOne({
      id: "ds_metric_create_order",
      organization: organization.id,
      name: "Metric create order data source",
      type: "postgres",
      params: "",
      settings: {},
      projects: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
    });

    const response = await request(app)
      .post("/api/v1/metrics")
      .send({
        datasourceId: "ds_metric_create_order",
        name: "Denied metric",
        type: "count",
        tags: ["must-not-persist"],
        sql: {
          identifierTypes: ["user_id"],
          conversionSQL: "SELECT 1",
        },
      })
      .set("Authorization", "Bearer test-key");

    expect(response.status).toBe(400);
    expect(response.body.message).toContain("Permission denied");
    expect(
      await mongoose.connection
        .db!.collection("metrics")
        .countDocuments({ organization: organization.id }),
    ).toBe(0);
    expect(
      await mongoose.connection
        .db!.collection("tags")
        .countDocuments({ organization: organization.id }),
    ).toBe(0);
    expect(
      await mongoose.connection
        .db!.collection("definitionsversions")
        .countDocuments({ organization: organization.id }),
    ).toBe(0);
  });
});
