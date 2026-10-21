import mongoose from "mongoose";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";
import { findAllOrganizations } from "back-end/src/models/OrganizationModel";

describe("findAllOrganizations search", () => {
  beforeAll(async () => {
    await connectTestMongo();
  }, 60000);

  afterAll(async () => {
    await disconnectTestMongo();
  });

  beforeEach(async () => {
    const orgs = mongoose.connection.collection("organizations");
    await orgs.deleteMany({});
    await orgs.insertMany(
      ["Acme (Prod)", "Acme Test", "foo.bar"].map((name, i) => ({
        id: `org_${i}`,
        name,
        ownerEmail: `owner${i}@example.com`,
        dateCreated: new Date(),
        members: [],
        invites: [],
        settings: {},
      })),
    );
  });

  it("treats the search as literal text, not a regex", async () => {
    // An unescaped "(" is an invalid regular expression.
    const parens = await findAllOrganizations(1, "Acme (");
    expect(parens.organizations.map((o) => o.name)).toEqual(["Acme (Prod)"]);

    const dot = await findAllOrganizations(1, "foo.bar");
    expect(dot.organizations.map((o) => o.name)).toEqual(["foo.bar"]);
    const wildcard = await findAllOrganizations(1, "foo.*");
    expect(wildcard.organizations).toHaveLength(0);
  });

  it("still matches case-insensitively and returns all orgs for an empty search", async () => {
    const acme = await findAllOrganizations(1, "ACME");
    expect(acme.organizations).toHaveLength(2);
    const all = await findAllOrganizations(1, "");
    expect(all.organizations).toHaveLength(3);
  });
});
