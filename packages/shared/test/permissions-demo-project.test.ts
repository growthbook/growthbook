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
            runSqlExplorerQueries: true,
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

    permissions.canCreateSqlExplorerQueries = wrapByProjects(
      permissions.canCreateSqlExplorerQueries,
    );
    permissions.canDeleteSqlExplorerQueries = wrapByProjects(
      permissions.canDeleteSqlExplorerQueries,
    );
    const canUpdateSqlExplorerQueries =
      permissions.canUpdateSqlExplorerQueries.bind(permissions);
    permissions.canUpdateSqlExplorerQueries = (existing, updates) =>
      projectsTargetDemoOnly(existing.projects)
        ? false
        : canUpdateSqlExplorerQueries(existing, updates);

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

  it("allows ad-hoc SQL Explorer runs on sample data but blocks saving", () => {
    const p = getAdminPermissionsForDemoOnlyOrg();
    const sampleDatasource = { projects: [demoProjectId] };

    expect(p.canRunSqlExplorerQueries(sampleDatasource)).toBe(true);
    expect(p.canCreateSqlExplorerQueries(sampleDatasource)).toBe(false);
    expect(p.canUpdateSqlExplorerQueries(sampleDatasource, {})).toBe(false);
    expect(p.canDeleteSqlExplorerQueries(sampleDatasource)).toBe(false);
  });
});

describe("demo project tag does not permanently lock non-demo resources", () => {
  const testOrg: OrganizationInterface = {
    id: "org_contaminated",
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

  const demoProjectId = "prj_org_contaminated_demo-datasource-project";
  const realProjectId = "prj_real";

  function getAdminPermissionsWithDemoOverride(): Permissions {
    const permissions = new Permissions({
      global: {
        permissions: roleToPermissionMap("admin", testOrg),
        limitAccessByEnvironment: false,
        environments: [],
      },
      projects: {
        [demoProjectId]: {
          permissions: {
            ...roleToPermissionMap("readonly", testOrg),
            runQueries: true,
            runSqlExplorerQueries: true,
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

    const withoutDemoProject = (projects?: string[]) =>
      (projects || []).filter((p) => p !== demoProjectId);

    const wrapIgnoreDemoUpdateBlocker =
      <
        TExisting extends { projects?: string[] },
        TUpdates extends { projects?: string[] },
      >(
        original: (existing: TExisting, updates: TUpdates) => boolean,
      ) =>
      (existing: TExisting, updates: TUpdates) => {
        if (original(existing, updates)) return true;
        if (!existing.projects?.includes(demoProjectId)) return false;
        return original(
          { ...existing, projects: withoutDemoProject(existing.projects) },
          updates && "projects" in updates && updates.projects
            ? {
                ...updates,
                projects: withoutDemoProject(updates.projects),
              }
            : updates,
        );
      };

    const wrapIgnoreDemoPermissionBlocker =
      <T extends { projects?: string[] }>(original: (arg: T) => boolean) =>
      (arg: T) => {
        if (original(arg)) return true;
        if (!arg.projects?.includes(demoProjectId)) return false;
        return original({
          ...arg,
          projects: withoutDemoProject(arg.projects),
        });
      };

    const wrapIgnoreDemoDeleteBlocker =
      <T extends { projects?: string[] }>(original: (arg: T) => boolean) =>
      (arg: T) => {
        if (original(arg)) return true;
        const projects = arg.projects || [];
        if (!projects.includes(demoProjectId) || projects.length < 2) {
          return false;
        }
        return original({
          ...arg,
          projects: withoutDemoProject(projects),
        });
      };

    permissions.canUpdateDataSourceSettings = wrapIgnoreDemoPermissionBlocker(
      permissions.canUpdateDataSourceSettings,
    );
    permissions.canDeleteDataSource = wrapIgnoreDemoDeleteBlocker(
      permissions.canDeleteDataSource,
    );
    permissions.canUpdateMetric = wrapIgnoreDemoUpdateBlocker(
      permissions.canUpdateMetric,
    );
    permissions.canDeleteMetric = wrapIgnoreDemoDeleteBlocker(
      permissions.canDeleteMetric,
    );

    return permissions;
  }

  it("allows updating a resource tagged with Sample Data so the tag can be removed", () => {
    const p = getAdminPermissionsWithDemoOverride();
    const exclusive = { projects: [demoProjectId] };
    const mixed = { projects: [realProjectId, demoProjectId] };

    expect(p.canUpdateDataSourceSettings(exclusive)).toBe(true);
    expect(p.canUpdateDataSourceSettings(mixed)).toBe(true);
    expect(p.canUpdateMetric(exclusive, {})).toBe(true);
    expect(p.canUpdateMetric(mixed, { projects: [realProjectId] })).toBe(true);
  });

  it("keeps exclusive Sample Data resources non-deletable via normal delete UI", () => {
    const p = getAdminPermissionsWithDemoOverride();
    expect(p.canDeleteDataSource({ projects: [demoProjectId] })).toBe(false);
    expect(p.canDeleteMetric({ projects: [demoProjectId] })).toBe(false);
  });

  it("allows deleting mixed-project contaminated resources", () => {
    const p = getAdminPermissionsWithDemoOverride();
    const mixed = { projects: [realProjectId, demoProjectId] };
    expect(p.canDeleteDataSource(mixed)).toBe(true);
    expect(p.canDeleteMetric(mixed)).toBe(true);
  });
});
