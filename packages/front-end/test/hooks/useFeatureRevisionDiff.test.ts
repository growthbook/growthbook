import * as React from "react";
import { render, renderHook } from "@testing-library/react";
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

  // Regression: missing keys in `environmentsEnabled` on the older revision
  // used to flip to `enabled: true` via an "infer the opposite" fallback,
  // producing phantom `enabled → disabled` toggle diffs.
  it("does not emit phantom env-toggle diffs when older revision lacks keys", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [],
      environmentsEnabled: { production: false },
    };
    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [],
      environmentsEnabled: {
        production: false,
        staging: false,
        dev: false,
      },
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    const toggleDiffs = result.current.filter((d) =>
      d.title.startsWith("Environment Toggle"),
    );
    expect(toggleDiffs).toHaveLength(0);
  });

  // Regression: scope changes used to render as raw `allEnvironments` /
  // JSON env-arrays via the generic fallback. The combined row uses the
  // same badge style as rule headings and only shows active envs.
  it("renders a combined Environments row with badges, not raw allEnvironments/environments", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "r1",
          description: "",
          type: "force",
          value: "true",
          allEnvironments: true,
        },
      ],
    };
    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [
        {
          id: "r1",
          description: "",
          type: "force",
          value: "true",
          allEnvironments: false,
          environments: ["production", "dev"],
        },
      ],
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );
    const rulesDiff = result.current.find((d) => d.title === "Rules");
    expect(rulesDiff).toBeDefined();
    const { container } = render(rulesDiff!.customRender as React.ReactElement);
    const html = container.innerHTML;

    expect(html).toContain("Environments");
    expect(html).toContain("All environments");
    expect(html).toContain("production");
    expect(html).toContain("dev");
    expect(html).not.toContain("allEnvironments");
    expect(html).not.toContain('["production","dev"]');
  });

  it("emits an env-toggle diff only for envs that actually changed", () => {
    const current: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [],
      environmentsEnabled: { production: false, staging: false },
    };
    const draft: FeatureRevisionDiffInput = {
      defaultValue: "false",
      rules: [],
      environmentsEnabled: { production: true, staging: false, dev: false },
    };

    const { result } = renderHook(() =>
      useFeatureRevisionDiff({ current, draft }),
    );

    const toggleDiffs = result.current.filter((d) =>
      d.title.startsWith("Environment Toggle"),
    );
    expect(toggleDiffs).toHaveLength(1);
    expect(toggleDiffs[0].title).toBe("Environment Toggle - production");
    expect(toggleDiffs[0].a).toBe("false");
    expect(toggleDiffs[0].b).toBe("true");
  });
});
