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
    this.checkProjectFilterUpdatePermission = jest.fn(() => true);
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

describe("canUpdatePresentation", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canUpdatePresentation();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createPresentations");
  });
});

describe("canDeletePresentation", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canDeletePresentation();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createPresentations");
  });
});

describe("canCreateDimension", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canCreateDimension();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createDimensions");
  });
});

describe("canUpdateDimension", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canUpdateDimension();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createDimensions");
  });
});

describe("canDeleteDimension", () => {
  it("Calls checkGlobalPermission with the correct parameters", () => {
    const p = new TestPermissions();
    p.canDeleteDimension();
    expect(p.checkGlobalPermission).toHaveBeenCalledWith("createDimensions");
  });
});

// PROJECT_SCOPED_PERMISSIONS
describe("canCreateVisualChange", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canCreateVisualChange({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageVisualChanges"
    );
  });
});

describe("canUpdateVisualChange", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateVisualChange({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageVisualChanges"
    );
  });
});

describe("canViewAttributeModal", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canViewAttributeModal("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageTargetingAttributes"
    );
  });
});

describe("canCreateAttribute", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateAttribute({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "manageTargetingAttributes"
    );
  });
});

describe("canUpdateAttribute", () => {
  it("Calls checkProjectFilterUpdatePermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateAttribute({ projects: ["a", "b"] }, { projects: ["a"] }));
    expect(p.checkProjectFilterUpdatePermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      { projects: ["a"] },
      "manageTargetingAttributes"
    );
  });
});

describe("canDeleteAttribute", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteAttribute({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "manageTargetingAttributes"
    );
  });
});

describe("canViewIdeaModal", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canViewIdeaModal("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createIdeas"
    );
  });
});

describe("canCreateIdea", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateIdea({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createIdeas"
    );
  });
});

describe("canUpdateIdea", () => {
  it("Calls checkProjectFilterUpdatePermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateIdea({ project: "a" }, { project: "b" }));
    expect(p.checkProjectFilterUpdatePermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      { projects: ["b"] },
      "createIdeas"
    );
  });
});

describe("canDeleteIdea", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteIdea({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createIdeas"
    );
  });
});

describe("canViewCreateFactTableModal", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canViewCreateFactTableModal("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageFactTables"
    );
  });
});

describe("canViewEditFactTableModal", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canViewEditFactTableModal({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterUpdatePermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      {},
      "manageFactTables"
    );
  });
});

describe("canCreateFactTable", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateFactTable({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageFactTables"
    );
  });
});

describe("canUpdateFactTable", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateFactTable({ projects: ["a", "b"] }, { projects: ["a"] }));
    expect(p.checkProjectFilterUpdatePermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      { projects: ["a"] },
      "manageFactTables"
    );
  });
});

describe("canDeleteFactTable", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteFactTable({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageFactTables"
    );
  });
});

describe("canCreateMetric", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateMetric({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createMetrics"
    );
  });
});

describe("canUpdateMetric", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateMetric({ projects: ["a"] }, { projects: ["a", "b"] }));
    expect(p.checkProjectFilterUpdatePermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      { projects: ["a", "b"] },
      "createMetrics"
    );
  });
});

describe("canDeleteMetric", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteMetric({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createMetrics"
    );
  });
});

describe("canManageFeatureDrafts", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canManageFeatureDrafts({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageFeatureDrafts"
    );
  });
});

describe("canReviewFeatureDrafts", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canReviewFeatureDrafts({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "canReview"
    );
  });
});

describe("canBypassApprovalChecks", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canBypassApprovalChecks({ project: "a" }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "bypassApprovalChecks"
    );
  });
});

describe("canAddComment", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canAddComment(["a"]));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "addComments"
    );
  });
});

describe("canCreateProjects", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateProjects());
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: [] },
      "manageProjects"
    );
  });
});

describe("canUpdateSomeProjects", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateSomeProjects());
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: [] },
      "manageProjects"
    );
  });
});

describe("canUpdateProject", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateProject("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageProjects"
    );
  });
});

describe("canDeleteProject", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteProject("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "manageProjects"
    );
  });
});

describe("canViewCreateDataSourceModal", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canViewCreateDataSourceModal("a"));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createDatasources"
    );
  });
});

describe("canCreateDataSource", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canCreateDataSource({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createDatasources"
    );
  });
});

describe("canUpdateDataSourceParams", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateDataSourceParams({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createDatasources"
    );
  });
});

describe("canUpdateDataSourceSettings", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canUpdateDataSourceSettings({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "editDatasourceSettings"
    );
  });
});

describe("canDeleteDataSource", () => {
  it("Calls checkProjectFilterPermission with the correct paramters", () => {
    const p = new TestPermissions();
    expect(p.canDeleteDataSource({ projects: ["a"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a"] },
      "createDatasources"
    );
  });
});

describe("canRunExperimentQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunExperimentQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunPastExperimentQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunPastExperimentQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunFactQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunFactQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunTestQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunTestQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunSchemaQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunSchemaQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunHealthQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunHealthQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

describe("canRunMetricQueries", () => {
  it("Calls checkProjectFilterPermission with the correct parameters", () => {
    const p = new TestPermissions();
    expect(p.canRunMetricQueries({ projects: ["a", "b"] }));
    expect(p.checkProjectFilterPermission).toHaveBeenCalledWith(
      { projects: ["a", "b"] },
      "runQueries"
    );
  });
});

//ENV_SCOPED_PERMISSIONS
