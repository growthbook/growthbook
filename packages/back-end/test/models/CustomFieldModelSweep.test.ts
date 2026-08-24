// `CustomFieldModel` cannot be a process's first module — `services/context.ts`
// dereferences it at module scope. Load that side of the cycle first, as the
// real entry points do.
import "back-end/src/services/context";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { CustomFieldModel } from "back-end/src/models/CustomFieldModel";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { Context } from "back-end/src/models/BaseModel";

const ORG = "org_sweep";
const OTHER_ORG = "org_other";

const context = {
  org: { id: ORG, settings: { environments: [{ id: "production" }] } },
  permissions: { canManageCustomFields: () => true },
  hasPremiumFeature: () => true,
  auditLog: jest.fn().mockResolvedValue(undefined),
  populateForeignRefs: jest.fn().mockResolvedValue(undefined),
  registerTags: jest.fn().mockResolvedValue(undefined),
  models: {},
} as unknown as Context;

const now = new Date("2026-01-01T00:00:00Z");

const field = (id: string, name = id) => ({
  id,
  name,
  description: "",
  placeholder: "",
  defaultValue: "",
  type: "text" as const,
  values: "",
  required: false,
  projects: [],
  sections: ["feature" as const, "experiment" as const],
  dateCreated: now,
  dateUpdated: now,
  active: true,
});

describe("deleteCustomField value sweep", () => {
  let mongod: MongoMemoryServer;
  let model: CustomFieldModel;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    model = new CustomFieldModel(context);
    await waitForIndexes();
  });

  // These are seeded through the raw driver, so they are absent from
  // `mongoose.connection.collections` and have to be cleared by name.
  const TOUCHED = [
    "customfields",
    "features",
    "experiments",
    "experimenttemplates",
    "featurerevisions",
  ];

  afterEach(async () => {
    jest.clearAllMocks();
    for (const name of TOUCHED) {
      await mongoose.connection.db!.collection(name).deleteMany({});
    }
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  const raw = (name: string) => mongoose.connection.db!.collection(name);

  // `fields` seeds the org's container directly so duplicate ids are expressible;
  // `addCustomField` rejects them, but legacy documents carry them.
  const seedContainer = async (fields: ReturnType<typeof field>[]) => {
    await raw("customfields").insertOne({
      id: "cfd_container",
      organization: ORG,
      fields,
      dateCreated: now,
      dateUpdated: now,
    });
  };

  const seedCarriers = async (organization = ORG) => {
    await raw("features").insertOne({
      organization,
      id: `feat_${organization}`,
      customFields: { cfd_doomed: "v", cfd_keep: "k" },
    });
    await raw("experiments").insertOne({
      organization,
      id: `exp_${organization}`,
      customFields: { cfd_doomed: "v", cfd_keep: "k" },
    });
    await raw("experimenttemplates").insertOne({
      organization,
      id: `tmplt_${organization}`,
      customFields: { cfd_doomed: "v", cfd_keep: "k" },
    });
  };

  const seedRevision = async (version: number, status: string) => {
    await raw("featurerevisions").insertOne({
      organization: ORG,
      featureId: "feat_org_sweep",
      version,
      status,
      metadata: { customFields: { cfd_doomed: "v", cfd_keep: "k" } },
    });
  };

  const customFieldsOf = async (collection: string, id: string) =>
    (await raw(collection).findOne({ id }))?.customFields;

  const revisionCustomFields = async (version: number) =>
    (await raw("featurerevisions").findOne({ version }))?.metadata
      ?.customFields;

  it("strips the key from every carrier that seeds a live record", async () => {
    await seedContainer([field("cfd_doomed"), field("cfd_keep")]);
    await seedCarriers();

    await model.deleteCustomField("cfd_doomed");

    // Experiment templates matter most: they seed new experiments, and creates
    // validate with no baseline, so a stale key there is unhealable.
    for (const [collection, id] of [
      ["features", "feat_org_sweep"],
      ["experiments", "exp_org_sweep"],
      ["experimenttemplates", "tmplt_org_sweep"],
    ]) {
      expect(await customFieldsOf(collection, id)).toEqual({ cfd_keep: "k" });
    }
  });

  it("strips open revisions and keeps published and discarded ones", async () => {
    await seedContainer([field("cfd_doomed"), field("cfd_keep")]);
    await seedRevision(1, "published");
    await seedRevision(2, "draft");
    await seedRevision(3, "pending-review");
    await seedRevision(4, "approved");
    await seedRevision(5, "changes-requested");
    await seedRevision(6, "discarded");
    // Auto-published when its parent lands, so it would restore the key.
    await seedRevision(7, "pending-parent");

    await model.deleteCustomField("cfd_doomed");

    for (const open of [2, 3, 4, 5, 7]) {
      expect(await revisionCustomFields(open)).toEqual({ cfd_keep: "k" });
    }
    for (const history of [1, 6]) {
      expect(await revisionCustomFields(history)).toEqual({
        cfd_doomed: "v",
        cfd_keep: "k",
      });
    }
  });

  it("keeps values while another field still uses the id, and strips on the last copy", async () => {
    await seedContainer([
      field("cfd_doomed", "First"),
      field("cfd_doomed", "Second"),
    ]);
    await seedCarriers();

    await model.deleteCustomField("cfd_doomed");

    expect(await customFieldsOf("features", "feat_org_sweep")).toEqual({
      cfd_doomed: "v",
      cfd_keep: "k",
    });

    await model.deleteCustomField("cfd_doomed");

    expect(await customFieldsOf("features", "feat_org_sweep")).toEqual({
      cfd_keep: "k",
    });
  });

  it("leaves other organizations' documents alone", async () => {
    await seedContainer([field("cfd_doomed")]);
    await seedCarriers();
    await seedCarriers(OTHER_ORG);

    await model.deleteCustomField("cfd_doomed");

    expect(await customFieldsOf("features", "feat_org_other")).toEqual({
      cfd_doomed: "v",
      cfd_keep: "k",
    });
  });
});
