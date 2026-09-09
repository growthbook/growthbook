import {
  OrganizationInterface,
  UserPermission,
} from "shared/types/organization";
import {
  GLOBAL_PERMISSIONS,
  PROJECT_SCOPED_PERMISSIONS,
  Permissions,
  getRolePermissions,
} from "../../src/permissions";

const reader: UserPermission = {
  permissions: { readData: true },
  environments: [],
  limitAccessByEnvironment: false,
};
const editor: UserPermission = {
  ...reader,
  permissions: { readData: true, createMetricGroups: true },
};

describe("metric group permissions", () => {
  const a = { projects: ["a"] };
  const ab = { projects: ["a", "b"] };
  const global = { projects: [] };
  const aEditor = new Permissions({ global: reader, projects: { a: editor } });

  it("classifies the permission as project-scoped", () => {
    expect(PROJECT_SCOPED_PERMISSIONS).toContain("createMetricGroups");
    expect(GLOBAL_PERMISSIONS).not.toContain("createMetricGroups");
  });

  it("permits project-only editors to manage their groups", () => {
    expect(aEditor.canCreateMetricGroup(a)).toBe(true);
    expect(aEditor.canUpdateMetricGroup(a)).toBe(true);
    expect(aEditor.canDeleteMetricGroup(a)).toBe(true);
  });

  it("resolves group authority from a project-scoped analyst role", () => {
    const org: OrganizationInterface = {
      id: "org_test",
      name: "Test",
      ownerEmail: "test@example.com",
      url: "",
      dateCreated: new Date(),
      invites: [],
      members: [],
    };
    const permissions = new Permissions(
      getRolePermissions(
        {
          role: "readonly",
          projectRoles: [
            {
              project: "a",
              role: "analyst",
              environments: [],
              limitAccessByEnvironment: false,
            },
          ],
        },
        org,
        [],
      ),
    );
    expect(permissions.canCreateMetricGroup(a)).toBe(true);
    expect(permissions.canUpdateMetricGroup(a)).toBe(true);
    expect(permissions.canDeleteMetricGroup(a)).toBe(true);
    expect(permissions.canCreateMetricGroup(global)).toBe(false);
    expect(permissions.canUpdateMetricGroup(ab)).toBe(false);
  });

  it.each([ab, global, { projects: ["b"] }])(
    "requires authority over every Project: %j",
    (group) => {
      expect(aEditor.canCreateMetricGroup(group)).toBe(false);
      expect(aEditor.canUpdateMetricGroup(group)).toBe(false);
      expect(aEditor.canDeleteMetricGroup(group)).toBe(false);
    },
  );

  it("checks both old and new Projects on an update", () => {
    expect(aEditor.canUpdateMetricGroup(a, {})).toBe(true);
    expect(aEditor.canUpdateMetricGroup(a, ab)).toBe(false);
    expect(aEditor.canUpdateMetricGroup(ab, a)).toBe(false);
    expect(aEditor.canUpdateMetricGroup(a, global)).toBe(false);
    expect(aEditor.canUpdateMetricGroup(global, a)).toBe(false);
  });

  it("allows shared groups only when all their Projects are writable", () => {
    const both = new Permissions({
      global: reader,
      projects: { a: editor, b: editor },
    });
    expect(both.canCreateMetricGroup(ab)).toBe(true);
    expect(both.canUpdateMetricGroup(ab, a)).toBe(true);
    expect(both.canDeleteMetricGroup(ab)).toBe(true);
    expect(both.canCreateMetricGroup(global)).toBe(false);
  });

  it("preserves global grants but respects project overrides", () => {
    const admin = new Permissions({ global: editor, projects: {} });
    expect(admin.canCreateMetricGroup(global)).toBe(true);
    expect(admin.canUpdateMetricGroup(ab, global)).toBe(true);
    expect(admin.canDeleteMetricGroup(ab)).toBe(true);
    const restricted = new Permissions({
      global: editor,
      projects: { b: reader },
    });
    expect(restricted.canUpdateMetricGroup(ab)).toBe(false);
  });

  it("does not substitute permission to edit metrics for group authority", () => {
    const metricsOnly = new Permissions({
      global: {
        ...reader,
        permissions: {
          readData: true,
          createMetrics: true,
          manageFactMetrics: true,
        },
      },
      projects: {},
    });
    expect(metricsOnly.canCreateMetricGroup(a)).toBe(false);
    expect(metricsOnly.canUpdateMetricGroup(a)).toBe(false);
    expect(metricsOnly.canDeleteMetricGroup(a)).toBe(false);
  });

  it("keeps reads available through any shared Project", () => {
    const restrictedReader = new Permissions({
      global: { ...reader, permissions: {} },
      projects: { a: reader },
    });
    expect(restrictedReader.canReadMultiProjectResource(ab.projects)).toBe(
      true,
    );
    expect(restrictedReader.canReadMultiProjectResource([])).toBe(true);
    expect(restrictedReader.canReadMultiProjectResource(["b"])).toBe(false);
  });
});
