import {
  getExperimentSourceSnapshotRef,
  isExperimentIncrementalEnabled,
  isNewerOverallResultsDataAvailable,
} from "shared/enterprise";
import type { DataSourcePipelineSettings } from "shared/types/datasource";

const makeSettings = (
  overrides: Partial<DataSourcePipelineSettings> = {},
): DataSourcePipelineSettings => ({
  allowWriting: true,
  mode: "incremental",
  ...overrides,
});

describe("isExperimentIncrementalEnabled", () => {
  describe("guards", () => {
    it("returns false when settings is undefined", () => {
      expect(isExperimentIncrementalEnabled(undefined, "exp_1")).toBe(false);
    });

    it("returns false when allowWriting is false, even with opt-in", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            allowWriting: false,
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("returns false when allowWriting is false in incremental mode", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ allowWriting: false }),
          "exp_1",
        ),
      ).toBe(false);
    });
  });

  describe("mode: 'incremental'", () => {
    it("returns true by default (no scoping lists)", () => {
      expect(isExperimentIncrementalEnabled(makeSettings(), "exp_1")).toBe(
        true,
      );
    });

    it("returns false when experiment is in excludedExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ excludedExperimentIds: ["exp_1"] }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("returns true when includedExperimentIds includes the experiment", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ includedExperimentIds: ["exp_1"] }),
          "exp_1",
        ),
      ).toBe(true);
    });

    it("returns false when includedExperimentIds is set but does not include the experiment", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ includedExperimentIds: ["exp_other"] }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("ignores incrementalOptInExperimentIds (excluded wins)", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            excludedExperimentIds: ["exp_1"],
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("ignores incrementalOptInExperimentIds when not in includes", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            includedExperimentIds: ["exp_other"],
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
        ),
      ).toBe(false);
    });
  });

  describe("mode: 'ephemeral'", () => {
    it("returns true when experiment is in incrementalOptInExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_1"],
          }),
          "exp_1",
        ),
      ).toBe(true);
    });

    it("returns false when experiment is not in incrementalOptInExperimentIds", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            incrementalOptInExperimentIds: ["exp_other"],
          }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("returns false when no opt-in list is set", () => {
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({ mode: "ephemeral" }),
          "exp_1",
        ),
      ).toBe(false);
    });

    it("ignores includedExperimentIds and excludedExperimentIds", () => {
      // Only incrementalOptInExperimentIds matters in ephemeral mode.
      expect(
        isExperimentIncrementalEnabled(
          makeSettings({
            mode: "ephemeral",
            includedExperimentIds: ["exp_1"],
            excludedExperimentIds: ["exp_1"],
          }),
          "exp_1",
        ),
      ).toBe(false);
    });
  });
});

describe("getExperimentSourceSnapshotRef", () => {
  const mainDate = new Date("2024-06-01T12:00:00Z");

  it("returns undefined when no basis was persisted", () => {
    expect(getExperimentSourceSnapshotRef({})).toBeUndefined();
  });

  it("returns undefined when only the id is present", () => {
    expect(
      getExperimentSourceSnapshotRef({ sourceSnapshotId: "main" }),
    ).toBeUndefined();
  });

  it("returns undefined when only the date is present", () => {
    expect(
      getExperimentSourceSnapshotRef({ sourceSnapshotDateCreated: mainDate }),
    ).toBeUndefined();
  });

  it("returns the persisted ref when both id and date are present", () => {
    expect(
      getExperimentSourceSnapshotRef({
        sourceSnapshotId: "main",
        sourceSnapshotDateCreated: mainDate,
      }),
    ).toEqual({ id: "main", dateCreated: mainDate });
  });
});

describe("isNewerOverallResultsDataAvailable", () => {
  const source = {
    id: "main_old",
    dateCreated: new Date("2024-06-01T12:00:00Z"),
  };

  it("returns false when there is no source snapshot", () => {
    expect(
      isNewerOverallResultsDataAvailable(undefined, {
        dateCreated: new Date("2024-06-02T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("returns false when there is no latest main snapshot", () => {
    expect(isNewerOverallResultsDataAvailable(source, undefined)).toBe(false);
  });

  it("returns false when the latest main snapshot is the same age", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: source.dateCreated,
      }),
    ).toBe(false);
  });

  it("returns false when the latest main snapshot is older", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: new Date("2024-05-01T12:00:00Z"),
      }),
    ).toBe(false);
  });

  it("returns true when a newer main snapshot exists", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: new Date("2024-06-02T12:00:00Z"),
      }),
    ).toBe(true);
  });

  it("handles string dates from the API", () => {
    expect(
      isNewerOverallResultsDataAvailable(source, {
        dateCreated: "2024-06-02T12:00:00Z" as unknown as Date,
      }),
    ).toBe(true);
  });
});
