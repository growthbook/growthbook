import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import ReviewAndPublish from "@/components/Reviews/Feature/ReviewAndPublish";

// Control the merge outcome and review gating directly so we can drive each mode
// without building full revision fixtures. The lifecycle/CTA decision logic
// itself is covered exhaustively by reviewAndPublishState.test.ts; these tests
// assert the component renders the right mode/CTA over that logic.
const mergeResultMock = vi.hoisted(() => ({
  current: { success: true, result: {}, conflicts: [] as unknown[] },
}));
const requireReviewsMock = vi.hoisted(() => ({ current: false }));

vi.mock("shared/util", async (importActual) => {
  const actual = await importActual<typeof import("shared/util")>();
  return {
    ...actual,
    autoMerge: () => mergeResultMock.current,
    liveRevisionFromFeature: (r: unknown) => r,
    fillRevisionFromFeature: (r: unknown) => r,
    filterEnvironmentsByFeature: (envs: unknown) => envs,
    mergeResultHasChanges: () => true,
    getLiveChangesSinceBase: () => [],
    checkIfRevisionNeedsReview: () => requireReviewsMock.current,
  };
});

vi.mock("@/hooks/useOrgSettings", () => ({
  default: () => ({}),
  useAISettings: () => ({
    aiEnabled: false,
    aiAgentEnabled: false,
  }),
}));

vi.mock("@/services/features", () => ({
  useEnvironments: () => [{ id: "prod" }],
  useFeatureExperimentChecklists: () => ({
    experiments: [],
    immediateStartExperiments: [],
    scheduledExperiments: [],
  }),
  getAffectedRevisionEnvs: () => [],
}));

vi.mock("@/services/experiments", () => ({
  getFutureScheduledStartDate: () => null,
}));

vi.mock("@/services/auth", () => ({
  useAuth: () => ({ apiCall: vi.fn() }),
}));

vi.mock("@/services/UserContext", () => ({
  getCurrentUser: () => ({ id: "user-1" }),
  useUser: () => ({
    organization: { settings: {} },
    users: new Map(),
    hasCommercialFeature: () => true,
  }),
}));

vi.mock("@/hooks/usePermissionsUtils", () => ({
  default: () => ({
    canBypassApprovalChecks: () => false,
    canReviewFeatureDrafts: () => false,
    canPublishFeature: () => true,
    canManageFeatureDrafts: () => true,
  }),
}));

vi.mock("@/hooks/useHoldouts", () => ({
  useHoldouts: () => ({ holdoutsMap: new Map() }),
  holdoutOccupiesRuleSlot: () => false,
}));

vi.mock("@/hooks/useFeatureRevisionDiff", () => ({
  useFeatureRevisionDiff: () => [{ title: "Default Value", a: "x", b: "y" }],
  featureToFeatureRevisionDiffInput: () => ({}),
  revisionToFeatureRevisionDiffInput: () => ({}),
  mergeResultToDiffInput: () => ({}),
  normalizeRevisionMetadata: (m: unknown) => m,
}));

vi.mock("@/hooks/useApi", () => ({
  default: () => ({ data: undefined, error: undefined, mutate: vi.fn() }),
}));

vi.mock("@/ui/DropdownMenu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const feature: any = { id: "feat_1", version: 2, environmentSettings: {} };

function makeRevisions(draftStatus: string) {
  return [
    {
      version: 2,
      status: "published",
      baseVersion: 1,
      rules: [],
      createdBy: { type: "dashboard", id: "user-9" },
      dateUpdated: new Date(),
    },
    {
      version: 3,
      status: draftStatus,
      baseVersion: 2,
      rules: [],
      createdBy: { type: "dashboard", id: "user-9" },
      dateUpdated: new Date(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as any;
}

describe("ReviewAndPublish", () => {
  beforeEach(() => {
    mergeResultMock.current = { success: true, result: {}, conflicts: [] };
    requireReviewsMock.current = false;
  });

  it("renders a Publish CTA for a direct-publish draft (approvals off)", () => {
    requireReviewsMock.current = false;
    render(
      <ReviewAndPublish
        feature={feature}
        version={3}
        setVersion={vi.fn()}
        revisions={makeRevisions("draft")}
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Publish$/ }),
    ).toBeInTheDocument();
  });

  it("hides comment composers without canReviewFeatureDrafts", () => {
    render(
      <ReviewAndPublish
        feature={feature}
        version={3}
        setVersion={vi.fn()}
        revisions={makeRevisions("draft")}
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    expect(screen.queryByText("Add a comment")).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("Leave a comment…"),
    ).not.toBeInTheDocument();
  });

  it("renders a Request Review CTA when approvals are required", () => {
    requireReviewsMock.current = true;
    render(
      <ReviewAndPublish
        feature={feature}
        version={3}
        setVersion={vi.fn()}
        revisions={makeRevisions("draft")}
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Request Review/i }),
    ).toBeInTheDocument();
  });

  it("renders a Publish CTA for an approved draft", () => {
    requireReviewsMock.current = true;
    render(
      <ReviewAndPublish
        feature={feature}
        version={3}
        setVersion={vi.fn()}
        revisions={makeRevisions("approved")}
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^Publish$/ }),
    ).toBeInTheDocument();
  });

  it("renders a read-only review when the selected version is not a draft", () => {
    render(
      <ReviewAndPublish
        feature={feature}
        version={2}
        setVersion={vi.fn()}
        revisions={
          [
            {
              version: 2,
              status: "published",
              baseVersion: 1,
              rules: [],
              createdBy: { type: "dashboard", id: "user-9" },
              dateUpdated: new Date(),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any
        }
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    // No review/approval/publish actions in read-only mode.
    expect(
      screen.queryByRole("button", { name: /^Publish$/ }),
    ).not.toBeInTheDocument();
  });

  it("offers a Revert action for a previously-published (non-live) revision", () => {
    render(
      <ReviewAndPublish
        feature={feature}
        version={1}
        setVersion={vi.fn()}
        revisions={
          [
            {
              version: 1,
              status: "published",
              baseVersion: 0,
              rules: [],
              datePublished: new Date(),
              createdBy: { type: "dashboard", id: "user-9" },
              dateUpdated: new Date(),
            },
            {
              version: 2,
              status: "published",
              baseVersion: 1,
              rules: [],
              datePublished: new Date(),
              createdBy: { type: "dashboard", id: "user-9" },
              dateUpdated: new Date(),
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ] as any
        }
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Revert to this revision/i }),
    ).toBeInTheDocument();
  });

  it("surfaces a conflict notice and opens the resolver on demand", () => {
    mergeResultMock.current = {
      success: false,
      result: {},
      conflicts: [
        {
          name: "Default Value",
          key: "defaultValue",
          base: "a",
          live: "b",
          revision: "c",
        },
      ],
    };
    render(
      <ReviewAndPublish
        feature={feature}
        version={3}
        setVersion={vi.fn()}
        revisions={makeRevisions("draft")}
        revisionList={[]}
        mutate={vi.fn()}
      />,
    );
    // The page surfaces a conflict notice rather than auto-opening the modal.
    expect(screen.getByText(/Conflicts with live/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fix conflicts" }));

    // The conflict resolver modal opens with the per-conflict choices.
    expect(
      screen.getByRole("button", { name: /Use My Change/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Use External Change/i }),
    ).toBeInTheDocument();
  });
});
