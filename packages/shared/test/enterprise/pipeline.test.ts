import { isExperimentIncrementalEnabled } from "shared/enterprise";
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
