import { ExperimentationHealthSettingsInterface } from "shared/validators";
import { getQualityScopeFilter } from "back-end/src/enterprise/services/experimentQualityScore";

const record = (
  project: string,
  enabled?: boolean,
): ExperimentationHealthSettingsInterface => ({
  id: `ehs_${project || "org"}`,
  organization: "org_1",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  project,
  quality: enabled === undefined ? {} : { enabled },
});

describe("getQualityScopeFilter", () => {
  it("is null when scoring is on nowhere", () => {
    expect(getQualityScopeFilter([])).toBeNull();
    expect(getQualityScopeFilter([record("", false)])).toBeNull();
  });

  it("covers every Project the organization default reaches", () => {
    expect(getQualityScopeFilter([record("", true)])).toEqual({});
    expect(
      getQualityScopeFilter([
        record("", true),
        record("prj_a", false),
        record("prj_b"),
      ]),
    ).toEqual({ project: { $nin: ["prj_a"] } });
  });

  it("covers only Projects that turn it on themselves", () => {
    expect(
      getQualityScopeFilter([record("prj_a", true), record("prj_b", false)]),
    ).toEqual({ project: { $in: ["prj_a"] } });
  });
});
