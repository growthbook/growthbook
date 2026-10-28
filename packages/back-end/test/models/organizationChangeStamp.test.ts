import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import omit from "lodash/omit";
import { OrganizationInterface } from "shared/types/organization";
import { testMongoUri } from "back-end/test/test-helpers";
import * as Stamped from "back-end/src/models/OrganizationModel";
import { ReqContext } from "back-end/types/request";

// The changeStamp pre-hook must change the stamp on every org write and leave
// the rest of the update exactly as it was. Each write runs twice: against the
// real module, and against a copy loaded without the hook (what main did).
type OrgModule = typeof Stamped;

const MODEL_FILE = path.join(
  __dirname,
  "../../src/models/OrganizationModel.ts",
);

let Unstamped: OrgModule;
let unstampedMongoose: typeof mongoose;

beforeAll(async () => {
  jest.isolateModules(() => {
    unstampedMongoose = jest.requireActual("mongoose");
    // The changeStamp hook is the only middleware the org schema registers.
    unstampedMongoose.Schema.prototype.pre = function () {
      return this;
    };
    Unstamped = jest.requireActual("back-end/src/models/OrganizationModel");
  });
  await Promise.all([
    mongoose.connect(testMongoUri()),
    unstampedMongoose.connect(testMongoUri()),
  ]);
});

afterAll(async () => {
  for (const m of [mongoose, unstampedMongoose]) {
    await m.connection.dropDatabase();
    await m.connection.close();
  }
});

beforeEach(async () => {
  for (const m of [mongoose, unstampedMongoose]) {
    await m.connection.collection("organizations").deleteMany({});
  }
});

const ORG_ID = "org_stamp";

function seedDoc() {
  const member = (id: string, project?: string) => ({
    id,
    role: "collaborator",
    dateCreated: new Date("2024-01-01T00:00:00Z"),
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: project
      ? [
          {
            project,
            role: "engineer",
            limitAccessByEnvironment: false,
            environments: [],
          },
          {
            project: "prj_keep",
            role: "readonly",
            limitAccessByEnvironment: false,
            environments: [],
          },
        ]
      : [],
  });
  return {
    id: ORG_ID,
    name: "Stamp Org",
    ownerEmail: "owner@example.com",
    url: "",
    dateCreated: new Date("2024-01-01T00:00:00Z"),
    members: [
      { ...member("u_admin"), role: "admin" },
      member("u_a", "prj_gone"),
      member("u_b"),
    ],
    invites: [
      {
        ...member("", "prj_gone"),
        email: "invitee@example.com",
        key: "inv_key",
        invitedBy: "u_admin",
      },
    ],
    pendingMembers: [
      {
        ...member("u_pending", "prj_gone"),
        name: "Pending",
        email: "pending@example.com",
      },
    ],
    customRoles: [
      { id: "myRole", description: "Mine", policies: ["ReadData"] },
      { id: "spare", description: "Spare", policies: ["ReadData"] },
    ],
    deactivatedRoles: ["spare"],
    settings: { environments: [{ id: "production" }], northStar: null },
    getStartedChecklistItems: ["first"],
    messages: [{ message: "hi", level: "info" }],
  };
}

async function seed(doc = seedDoc()) {
  // Raw inserts, so neither copy starts with a stamp
  for (const m of [mongoose, unstampedMongoose]) {
    await m.connection.collection("organizations").insertOne({ ...doc });
  }
}

async function readRaw(m: typeof mongoose) {
  return m.connection.collection("organizations").findOne({ id: ORG_ID });
}

async function loadOrg(mod: OrgModule): Promise<OrganizationInterface> {
  const org = await mod.findOrganizationById(ORG_ID);
  if (!org) throw new Error("seeded org is missing");
  return org;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Runs one write on both copies and compares the stored docs and results.
async function expectStampedWrite(
  write: (mod: OrgModule) => Promise<unknown>,
  { changes = true }: { changes?: boolean } = {},
) {
  const before = await readRaw(mongoose);
  const stampBefore = await Stamped.findOrganizationChangeStamp(ORG_ID);

  const stampedResult = await write(Stamped);
  const unstampedResult = await write(Unstamped);

  const stamped = await readRaw(mongoose);
  const unstamped = await readRaw(unstampedMongoose);
  expect(unstamped).not.toHaveProperty("changeStamp");
  expect(omit(stamped, ["_id", "changeStamp"])).toEqual(
    omit(unstamped, ["_id"]),
  );
  expect(stampedResult).toEqual(unstampedResult);

  const stampAfter = await Stamped.findOrganizationChangeStamp(ORG_ID);
  if (changes) {
    expect(stampAfter).toMatch(UUID);
    expect(stampAfter).not.toBe(stampBefore);
    expect(omit(stamped, ["changeStamp"])).not.toEqual(
      omit(before, ["changeStamp"]),
    );
  } else {
    expect(stampAfter).toBe(stampBefore);
  }
  return { stamped, stampedResult };
}

const newMember = {
  id: "u_new",
  role: "readonly",
  dateCreated: new Date("2024-02-01T00:00:00Z"),
  limitAccessByEnvironment: false,
  environments: [],
};

describe("organization changeStamp", () => {
  it("reads as an empty string before the first hooked write", async () => {
    await seed();
    expect(await Stamped.findOrganizationChangeStamp(ORG_ID)).toBe("");
    expect(await Stamped.findOrganizationChangeStamp("org_missing")).toBe(null);
    const loaded = await Stamped.findOrganizationByIdWithChangeStamp(ORG_ID);
    expect(loaded?.stamp).toBe("");
    expect(loaded?.value).not.toHaveProperty("changeStamp");
  });

  it("is never part of the loaded organization", async () => {
    await seed();
    await Stamped.updateOrganization(ORG_ID, { name: "Renamed" });
    const loaded = await Stamped.findOrganizationByIdWithChangeStamp(ORG_ID);
    expect(loaded?.stamp).toMatch(UUID);
    expect(loaded?.value).not.toHaveProperty("changeStamp");
    expect(await Stamped.findOrganizationById(ORG_ID)).not.toHaveProperty(
      "changeStamp",
    );
  });

  it("createOrganization stores no stamp", async () => {
    const org = await Stamped.createOrganization({
      email: "new@example.com",
      userId: "u_creator",
      name: "Fresh",
    });
    expect(await Stamped.findOrganizationChangeStamp(org.id)).toBe("");
  });

  it("updateOrganization with $set", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.updateOrganization(ORG_ID, {
        name: "Renamed",
        settings: { environments: [{ id: "staging" }] },
      }),
    );
  });

  it("updateOrganization with $unset", async () => {
    await seed({ ...seedDoc(), restrictLoginMethod: "oidc" } as ReturnType<
      typeof seedDoc
    >);
    await expectStampedWrite((m) =>
      m.updateOrganization(
        ORG_ID,
        { name: "Unset" },
        { restrictLoginMethod: 1 },
      ),
    );
  });

  it("updateOrganization with only a dotted $unset (AI settings cleanup)", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.updateOrganization(ORG_ID, {}, {
        "settings.environments": 1,
      } as unknown as Partial<Record<"restrictLoginMethod", 1>>),
    );
  });

  it("removeProjectRolesForProject (positional $pull)", async () => {
    await seed();
    const { stamped } = await expectStampedWrite(async (m) =>
      m.removeProjectRolesForProject(await loadOrg(m), "prj_gone"),
    );
    expect(JSON.stringify(stamped)).not.toContain("prj_gone");
    expect(JSON.stringify(stamped)).toContain("prj_keep");
  });

  it("addOrganizationMemberIfSeatAvailable ($push/$pull with $expr filter)", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.addOrganizationMemberIfSeatAvailable(ORG_ID, newMember, 10),
    );
  });

  it("addOrganizationMemberIfSeatAvailable leaves the stamp alone when no seat matches", async () => {
    await seed();
    await expectStampedWrite(
      (m) => m.addOrganizationMemberIfSeatAvailable(ORG_ID, newMember, 1),
      { changes: false },
    );
  });

  it("addOrganizationInviteIfSeatAvailable", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.addOrganizationInviteIfSeatAvailable(
        ORG_ID,
        {
          ...newMember,
          email: "second@example.com",
          key: "inv_2",
          invitedBy: "u_admin",
        },
        null,
      ),
    );
  });

  it("acceptOrganizationInvite", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.acceptOrganizationInvite(ORG_ID, "inv_key", {
        ...newMember,
        id: "u_pending",
      }),
    );
  });

  it("setOrganizationMessages (implicit $set with validators)", async () => {
    await seed();
    await expectStampedWrite((m) =>
      m.setOrganizationMessages(ORG_ID, [
        { message: "careful", level: "warning" },
      ]),
    );
  });

  it("addGetStartedChecklistItem ($addToSet)", async () => {
    await seed();
    await expectStampedWrite((m) => m.addGetStartedChecklistItem(ORG_ID, "x"));
  });

  it("updateMember", async () => {
    await seed();
    await expectStampedWrite(async (m) =>
      m.updateMember(await loadOrg(m), "u_b", { role: "engineer" }),
    );
  });

  it("addCustomRole, editCustomRole, deactivateRoleById, activateRoleById", async () => {
    await seed();
    await expectStampedWrite(async (m) =>
      m.addCustomRole(await loadOrg(m), {
        id: "another",
        description: "Another",
        policies: ["ReadData"],
      }),
    );
    await expectStampedWrite(async (m) =>
      m.editCustomRole(await loadOrg(m), "another", {
        description: "Edited",
        policies: ["ReadData"],
      }),
    );
    await expectStampedWrite(async (m) =>
      m.deactivateRoleById(await loadOrg(m), "another"),
    );
    await expectStampedWrite(async (m) =>
      m.activateRoleById(await loadOrg(m), "another"),
    );
  });

  it("removeCustomRole", async () => {
    await seed();
    await expectStampedWrite(async (m) =>
      m.removeCustomRole(
        {
          org: await loadOrg(m),
          teams: [],
          models: {
            apiKeys: { dangerousGetAllApiKeysInOrg: async () => [] },
          },
        } as unknown as ReqContext,
        "spare",
      ),
    );
  });

  it("covers every write the model makes", () => {
    // A write that skips the hook (create aside) needs its own stamp and a case above.
    const source = fs.readFileSync(MODEL_FILE, "utf8");
    const modelCalls = new Set(
      [...source.matchAll(/OrganizationModel\.(\w+)\(/g)].map((m) => m[1]),
    );
    expect([...modelCalls].sort()).toEqual([
      "create",
      "find",
      "findOne",
      "findOneAndUpdate",
      "updateOne",
    ]);
    const rawCalls = new Set(
      [...source.matchAll(/getCollection\(COLLECTION\)\s*\.(\w+)\(/g)].map(
        (m) => m[1],
      ),
    );
    expect([...rawCalls].sort()).toEqual(["find", "findOne"]);
    expect(source).not.toMatch(
      /\.(save|bulkWrite|replaceOne|insertMany|deleteOne|deleteMany)\(/,
    );
  });
});
