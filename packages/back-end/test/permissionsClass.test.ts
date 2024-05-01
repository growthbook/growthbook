import { Permissions } from "../../shared/src/permissions";
import { roleToPermissionMap } from "../src/util/organization.util";
import { OrganizationInterface } from "../types/organization";

const testOrg: OrganizationInterface = {
  id: "org_sktwi1id9l7z9xkjb",
  name: "Test Org",
  ownerEmail: "test@test.com",
  url: "https://test.com",
  dateCreated: new Date(),
  invites: [],
  members: [
    {
      id: "base_user_123",
      role: "readonly",
      dateCreated: new Date(),
      limitAccessByEnvironment: false,
      environments: [],
      projectRoles: [],
      teams: [],
    },
  ],
  settings: {
    environments: [
      { id: "development" },
      { id: "staging" },
      { id: "production" },
    ],
  },
};

class TestPermissions extends Permissions {
  public constructor() {
    super(
      {
        global: {
          permissions: roleToPermissionMap("noaccess", testOrg),
          limitAccessByEnvironment: false,
          environments: [],
        },
        projects: {},
      },
      false
    );

    this.checkGlobalPermission = jest.fn(() => true);
    this.checkProjectFilterPermission = jest.fn(() => true);
  }
}

// GLOBAL_PERMISSIONS
describe("canCreatePresentation", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canCreatePresentation();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createPresentations");
  });
});

// PROJECT_SCOPED_PERMISSIONS
describe("canRunMetricQueries", () => {
  it("Calls checkProejctFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunMetricQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

//ENV_SCOPED_PERMISSIONS
