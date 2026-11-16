import { Permissions } from "../../src/permissions";

const withGlobal = (permissions: Record<string, boolean>) =>
  new Permissions({
    global: { permissions, limitAccessByEnvironment: false, environments: [] },
    projects: {},
  });

// A custom role built from SDK Connections Full Access alone must be able to
// open the create flow; Environments Full Access alone must not.
describe("canViewCreateSDKConnectionModal", () => {
  it("follows manageSDKConnections, not manageEnvironments", () => {
    expect(
      withGlobal({
        readData: true,
        manageSDKConnections: true,
      }).canViewCreateSDKConnectionModal(),
    ).toBe(true);
    expect(
      withGlobal({
        readData: true,
        manageEnvironments: true,
      }).canViewCreateSDKConnectionModal(),
    ).toBe(false);
  });
});
