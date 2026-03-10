import { renderHook } from "@testing-library/react";
import {
  FeatureRevisionDiffInput,
  useFeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";

describe("useFeatureRevisionDiff", () => {
  it("should not show diff for unmodified environments when only one environment is changed", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: {
        production: [
          { id: "rule1", description: "test", type: "force", value: "true" },
        ],
        staging: [
          { id: "rule2", description: "test", type: "force", value: "false" },
        ],
      },
    };

    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: {
        production: [
          { id: "rule1", description: "test", type: "force", value: "changed" },
        ],
      },
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    // Should only show diff for production, not staging
    expect(result.current).toHaveLength(1);
    expect(result.current[0].title).toBe("Rules - production");

    // Verify staging is NOT in the diffs (the bug would have shown staging going from rules to [])
    const stagingDiff = result.current.find((d) => d.title.includes("staging"));
    expect(stagingDiff).toBeUndefined();
  });
});
