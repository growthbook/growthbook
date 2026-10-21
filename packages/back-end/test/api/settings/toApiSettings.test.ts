import {
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "shared/types/organization";
import { toApiSettings } from "back-end/src/api/settings/getSettings";

function org(settings: OrganizationSettings) {
  return { id: "org_1", settings } as unknown as OrganizationInterface;
}

describe("toApiSettings", () => {
  it("returns stored values, not derived ones, for unset echoable fields", () => {
    const api = toApiSettings(org({}));
    expect(api.regressionAdjustmentDays).toBe(
      DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
    );
    expect(api.postStratificationEnabled).toBe(
      DEFAULT_POST_STRATIFICATION_ENABLED,
    );
    expect(api.preferredEnvironment).toBeNull();
    expect(api.experimentMaxLengthDays).toBeNull();
  });

  it("fills in a legacy default role so PUT accepts it", () => {
    const api = toApiSettings(
      org({ defaultRole: { role: "collaborator" } } as OrganizationSettings),
    );
    expect(api.defaultRole).toMatchObject({
      role: "collaborator",
      limitAccessByEnvironment: false,
      environments: [],
    });
  });

  it("serializes the north star start date", () => {
    const api = toApiSettings(
      org({
        northStar: {
          title: "Revenue",
          metricIds: ["met_1"],
          startDate: new Date("2026-01-02T03:04:05.000Z"),
        },
      } as OrganizationSettings),
    );
    expect(api.northStar).toMatchObject({
      startDate: "2026-01-02T03:04:05.000Z",
    });
  });

  it("reads schedule hours stored as strings, and drops cleared ones", () => {
    const hours = (value: unknown) =>
      toApiSettings(
        org({
          updateSchedule: { type: "stale", hours: value },
        } as unknown as OrganizationSettings),
      ).updateSchedule;
    expect(hours("6")).toEqual({ type: "stale", hours: 6 });
    expect(hours("")).toEqual({ type: "stale" });
  });

  it("returns a loosely stored p-value correction as null", () => {
    const api = toApiSettings(
      org({ pValueCorrection: "" } as unknown as OrganizationSettings),
    );
    expect(api.pValueCorrection).toBeNull();
  });

  it("leaves out deprecated settings", () => {
    const api = toApiSettings(
      org({ sdkInstructionsViewed: true } as OrganizationSettings),
    );
    expect(api).not.toHaveProperty("sdkInstructionsViewed");
  });
});
