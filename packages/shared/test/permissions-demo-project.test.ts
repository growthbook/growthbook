import { OrganizationInterface } from "shared/types/organization";
import { Permissions, roleToPermissionMap } from "../permissions";

// Regression test for the "Sample Data" (demo) project locking out create CTAs.
//
// In the front-end (services/UserContext.tsx) we inject a read-only-ish role
// for the demo project and then wrap the create/view permission methods to
// return false for that project (so its CTAs stay disabled). When the demo
// project is the ONLY project in the org, the "All Projects" create CTAs must
// still be enabled for a user who can create at the org level (e.g. an admin) —
// a non-creatable project must not gate the button.
describe("demo (sample data) project does not lock out create CTAs", () => {
  const testOrg: OrganizationInterface = {
    id: "org_demo_only",
    name: "Test Org",
    ownerEmail: "test@test.com",
    url: "https://test.com",
    dateCreated: new Date(),
    invites: [],
    members: [],
    settings: {
      environments: [{ id: "production", description: "" }],
    },
  };

  // Same shape as getDemoDatasourceProjectIdForOrganization(org.id).
  const demoProjectId = "prj_org_demo_only_demo-datasource-project";
  const allProjects = [{ id: demoProjectId }];

  // Build a global admin's Permissions instance exactly as UserContext does for
  // an org whose only project is the demo project.
  function getAdminPermissionsForDemoOnlyOrg(): Permissions {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        // Mirrors the injected demo-project role in UserContext.tsx.
        [demoProjectId]: {
          permissions: {
            ...roleToPermissionMap("readonly", testOrg),
            runQueries: true,
            manageFeatures: true,
            manageFeatureDrafts: true,
            canReview: true,
            createAnalyses: true,
            manageFactMetrics: true,
            publishFeatures: true,
            runExperiments: true,
          },
          limitAccessByEnvironment: false,
          environments: [],
        },
      },
    });

    // Mirror the create/delete CTA wrapping from UserContext.tsx.
    const targetsDemoProject = (project?: string) => project === demoProjectId;
    const projectsTargetDemoOnly = (projects?: string[]) =>
      !!projects?.length && projects.every((p) => p === demoProjectId);

    const wrapByProject =
      <T extends { project?: string }, R extends boolean>(
        original: (arg: T) => R,
      ) =>
      (arg: T) =>
        (targetsDemoProject(arg.project) ? false : original(arg)) as R;
    const wrapByProjects =
      <T extends { projects?: string[] }, R extends boolean>(
        original: (arg: T) => R,
      ) =>
      (arg: T) =>
        (projectsTargetDemoOnly(arg.projects) ? false : original(arg)) as R;
    const wrapByProjectString =
      (
        original: (project?: string, allProjects?: { id: string }[]) => boolean,
      ) =>
      (project?: string, allProjects?: { id: string }[]) =>
        targetsDemoProject(project) ? false : original(project, allProjects);

    permissions.canCreateFeature = wrapByProject(permissions.canCreateFeature);
    permissions.canViewFeatureModal = wrapByProjectString(
      permissions.canViewFeatureModal,
    );
    permissions.canCreateExperiment = wrapByProject(
      permissions.canCreateExperiment,
    );
    permissions.canViewExperimentModal = wrapByProjectString(
      permissions.canViewExperimentModal,
    );
    permissions.canCreateExperimentTemplate = wrapByProject(
      permissions.canCreateExperimentTemplate,
    );
    permissions.canViewExperimentTemplateModal = wrapByProjectString(
      permissions.canViewExperimentTemplateModal,
    );
    permissions.canCreateHoldout = wrapByProjects(permissions.canCreateHoldout);
    permissions.canViewHoldoutModal = wrapByProjectString(
      permissions.canViewHoldoutModal,
    );
    permissions.canCreateFactMetric = wrapByProjects(
      permissions.canCreateFactMetric,
    );

    return permissions;
  }

  it("Add Experiment stays enabled (worked even before the fix)", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewExperimentModal("", allProjects)).toBe(true);
  });

  it("Add Holdout stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewHoldoutModal("", allProjects)).toBe(true);
  });

  it("Add Fact Table stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewCreateFactTableModal("", allProjects)).toBe(true);
  });

  it("Add Template stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewExperimentTemplateModal("", allProjects)).toBe(true);
  });

  it("Add Feature stays enabled (canViewFeatureModal + global-first create check)", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    // canViewFeatureModal is the first half of the features button gate.
    expect(p.canViewFeatureModal("", allProjects)).toBe(true);
    // The second half mirrors features/index.tsx canCreateFeatures "All
    // Projects" global-first check.
    expect(
      p.canCreateFeature({ project: "" }) &&
        p.canManageFeatureDrafts({ project: "" }),
    ).toBe(true);
  });

  it("Add Attribute stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewAttributeModal("", allProjects)).toBe(true);
  });

  it("Add Idea stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewIdeaModal("", allProjects)).toBe(true);
  });

  it("Add Data Source stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewCreateDataSourceModal("", allProjects)).toBe(true);
  });

  it("Add Saved Group stays enabled", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    expect(p.canViewSavedGroupModal("", allProjects)).toBe(true);
  });
});
