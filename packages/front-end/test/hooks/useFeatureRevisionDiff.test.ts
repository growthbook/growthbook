import { renderHook } from "@testing-library/react";
import {
  FeatureRevisionDiffInput,
  useFeatureRevisionDiff,
} from "@/hooks/useFeatureRevisionDiff";

describe("useFeatureRevisionDiff", () => {
  it("produces a single rule-centric diff (not bucketed by env) when one rule is modified", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "rule1",
          description: "test",
          type: "force",
          value: "true",
          allEnvironments: false,
          environments: ["production"],
        },
        {
          id: "rule2",
          description: "test",
          type: "force",
          value: "false",
          allEnvironments: false,
          environments: ["staging"],
        },
      ],
    };

    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "rule1",
          description: "test",
          type: "force",
          value: "changed",
          allEnvironments: false,
          environments: ["production"],
        },
        {
          id: "rule2",
          description: "test",
          type: "force",
          value: "false",
          allEnvironments: false,
          environments: ["staging"],
        },
      ],
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    // One flat "Rules" section, no per-env splitting, no env suffix.
    expect(result.current).toHaveLength(1);
    expect(result.current[0].title).toBe("Rules");
    // Badges should be env-agnostic ("Edit rule", not "Edit rule in production").
    const editBadge = result.current[0].badges?.find((b) =>
      b.label.startsWith("Edit rule"),
    );
    expect(editBadge?.label).toBe("Edit rule");
  });

  it("emits a Rules diff for allEnvironments rule changes (pre-fix gap)", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "rule1",
          description: "test",
          type: "force",
          value: "true",
          allEnvironments: true,
        },
      ],
      environmentsEnabled: { production: true, staging: true },
    };

    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "rule1",
          description: "test",
          type: "force",
          value: "updated",
          allEnvironments: true,
        },
      ],
      environmentsEnabled: { production: true, staging: true },
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].title).toBe("Rules");
  });

  it("emits a Rules diff for pending (environments:[]) rule changes (pre-fix gap)", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [],
    };

    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "pendingRule",
          description: "staged but not yet targeted",
          type: "force",
          value: "true",
          allEnvironments: false,
          environments: [],
        },
      ],
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].title).toBe("Rules");
    const addBadge = result.current[0].badges?.find(
      (b) => b.action === "add rule",
    );
    expect(addBadge?.label).toBe("Add rule");
  });
});
