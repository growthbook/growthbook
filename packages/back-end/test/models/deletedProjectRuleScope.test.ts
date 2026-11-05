import mongoose from "mongoose";
import type { Request } from "express";
import type { OrganizationInterface } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";
import { CasConflictError } from "back-end/src/models/BaseModel";
import {
  getFeature,
  removeProjectFromFeatures,
  updateFeature,
} from "back-end/src/models/FeatureModel";
import { setupApp } from "../api/api.setup";

// Deleting a project drops it from rule scopes. A landing that read the
// feature before that cleanup must not write the deleted project back.

const ORG_ID = "org_deleted_project_rule_scope";
const FLAG = "scoped_flag";
const org = {
  id: ORG_ID,
  name: "Deleted project rule scope",
  ownerEmail: "test@test.com",
  url: "",
  dateCreated: new Date(),
  members: [],
  settings: { environments: [{ id: "production", description: "" }] },
} as unknown as OrganizationInterface;

const features = () => mongoose.connection.collection("features");
const projects = () => mongoose.connection.collection("projects");

describe("removeProjectFromFeatures", () => {
  setupApp();
  const context = () =>
    new ReqContextClass({
      org,
      auditUser: { type: "api_key", apiKey: "key_test" },
      role: "admin",
      req: { query: {}, headers: {} } as unknown as Request,
    });

  beforeEach(async () => {
    for (const c of [features(), projects()]) {
      await c.deleteMany({ organization: ORG_ID });
    }
    for (const id of ["prj_kept", "prj_gone"]) {
      await projects().insertOne({
        id,
        organization: ORG_ID,
        name: id,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      });
    }
    const stamp = new Date(Date.now() - 60_000);
    await features().insertOne({
      id: FLAG,
      organization: ORG_ID,
      owner: "",
      project: "",
      valueType: "string",
      defaultValue: "a",
      version: 1,
      archived: false,
      tags: [],
      rules: [
        {
          id: "fr_scoped",
          type: "force",
          value: "b",
          enabled: true,
          allEnvironments: true,
          allProjects: false,
          projects: ["prj_kept", "prj_gone"],
        },
      ],
      environmentSettings: { production: { enabled: true } },
      dateCreated: stamp,
      dateUpdated: stamp,
    });
  });

  it("makes a landing that read the deleted scope lose its guard", async () => {
    const preImage = await getFeature(context(), FLAG);
    if (!preImage) throw new Error("seed missing");

    await projects().deleteOne({ organization: ORG_ID, id: "prj_gone" });
    await removeProjectFromFeatures(context(), "prj_gone");

    await expect(
      updateFeature(
        context(),
        preImage,
        { rules: preImage.rules },
        { casOnDateUpdated: preImage.dateUpdated },
      ),
    ).rejects.toBeInstanceOf(CasConflictError);
    const doc = await features().findOne({ organization: ORG_ID, id: FLAG });
    expect(doc?.rules[0].projects).toEqual(["prj_kept"]);
  });
});
