import type { OrganizationSettings } from "shared/types/organization";
import type { AutoExperimentsMode } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import { getAutoExperimentSettingsUpdate } from "back-end/src/services/autoExperiments";

let mockMode: AutoExperimentsMode = "allowed";
jest.mock("back-end/src/util/secrets", () => ({
  get AUTO_EXPERIMENTS_MODE() {
    return mockMode;
  },
}));

const allOff = {
  visualEditor: false,
  urlRedirects: false,
  customJs: false,
  crossOriginRedirects: false,
};

const ctx = (
  autoExperiments?: OrganizationSettings["autoExperiments"],
  { canManage = true, isApiRequest = false } = {},
) =>
  ({
    org: { settings: { autoExperiments } },
    isApiRequest,
    permissions: {
      canManageOrgSettings: () => canManage,
      throwPermissionError: () => {
        throw new Error("permission denied");
      },
    },
    throwBadRequestError: (message: string) => {
      throw new Error(message);
    },
  }) as unknown as ReqContext;

describe("getAutoExperimentSettingsUpdate", () => {
  beforeEach(() => {
    mockMode = "allowed";
  });

  it("merges a partial update over what is stored", () => {
    expect(
      getAutoExperimentSettingsUpdate(ctx({ ...allOff, urlRedirects: true }), {
        visualEditor: true,
      }),
    ).toEqual({ ...allOff, urlRedirects: true, visualEditor: true });
  });

  it("keeps unset features unset for an organization with none stored", () => {
    expect(
      getAutoExperimentSettingsUpdate(ctx(), { urlRedirects: false }),
    ).toEqual({ urlRedirects: false, crossOriginRedirects: false });
  });

  it("turns a feature off along with its parent", () => {
    expect(
      getAutoExperimentSettingsUpdate(
        ctx({ ...allOff, visualEditor: true, customJs: true }),
        { visualEditor: false },
      ),
    ).toEqual(allOff);
    expect(
      getAutoExperimentSettingsUpdate(ctx(allOff), { customJs: true }),
    ).toEqual(allOff);
  });

  it("refuses a caller who can't manage organization settings, and API keys", () => {
    expect(() =>
      getAutoExperimentSettingsUpdate(ctx(allOff, { canManage: false }), {
        visualEditor: true,
      }),
    ).toThrow("permission denied");
    expect(() =>
      getAutoExperimentSettingsUpdate(ctx(allOff, { isApiRequest: true }), {
        visualEditor: false,
      }),
    ).toThrow("permission denied");
  });

  it("refuses unknown features and non-boolean values", () => {
    expect(() =>
      getAutoExperimentSettingsUpdate(ctx(allOff), { everything: true }),
    ).toThrow();
    expect(() =>
      getAutoExperimentSettingsUpdate(ctx(allOff), { visualEditor: "yes" }),
    ).toThrow();
  });

  describe.each(["existing-only", "disabled"] as const)(
    "when the instance mode is %s",
    (mode) => {
      beforeEach(() => {
        mockMode = mode;
      });

      it("refuses turning on a feature that is off", () => {
        expect(() =>
          getAutoExperimentSettingsUpdate(ctx(allOff), { visualEditor: true }),
        ).toThrow(/ALLOW_AUTO_EXPERIMENTS/);
      });

      it("allows turning features off, and resending what is already on", () => {
        const stored = { ...allOff, visualEditor: true, customJs: true };
        expect(
          getAutoExperimentSettingsUpdate(ctx(stored), {
            visualEditor: true,
            customJs: false,
          }),
        ).toEqual({ ...allOff, visualEditor: true });
      });

      it("allows an organization with none stored to keep what it has", () => {
        expect(
          getAutoExperimentSettingsUpdate(ctx(), { visualEditor: true }),
        ).toEqual({ visualEditor: true });
      });
    },
  );
});
