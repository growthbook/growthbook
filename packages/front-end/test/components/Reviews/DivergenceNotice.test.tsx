import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { PublishGovernanceResult } from "shared/util";
import DivergenceNotice from "@/components/Reviews/DivergenceNotice";

function gov(
  overrides: Partial<PublishGovernanceResult> = {},
): PublishGovernanceResult {
  return {
    diverged: false,
    divergence: "current",
    liveChanges: [],
    staleApproval: false,
    recommendRebase: false,
    rebaseRequired: false,
    canPublish: true,
    blockReason: null,
    ...overrides,
  };
}

describe("DivergenceNotice", () => {
  it("renders nothing for an up-to-date draft", () => {
    const { container } = render(
      <DivergenceNotice governance={gov()} liveVersion={5} baseVersion={5} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a Fix conflicts CTA for the conflict state", () => {
    const onResolve = vi.fn();
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "conflict",
          recommendRebase: true,
          rebaseRequired: true,
          canPublish: false,
          blockReason: "Resolve conflicts ...",
        })}
        liveVersion={8}
        baseVersion={5}
        onResolveConflicts={onResolve}
      />,
    );
    expect(screen.getByText(/conflicts with live/i)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /fix conflicts/i });
    fireEvent.click(btn);
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it("hides the Fix conflicts CTA when the user cannot rebase", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "conflict",
          recommendRebase: true,
          rebaseRequired: true,
          canPublish: false,
          blockReason: "Resolve conflicts ...",
        })}
        liveVersion={8}
        baseVersion={5}
        onResolveConflicts={vi.fn()}
        canRebase={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /fix conflicts/i }),
    ).not.toBeInTheDocument();
  });

  it("encourages update when diverged but not required (setting off)", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          recommendRebase: true,
          liveChanges: [
            { key: "rules", name: "Rules" },
            { key: "environmentsEnabled.prod", name: "Env Enabled - prod" },
          ],
        })}
        liveVersion={8}
        baseVersion={5}
        onUpdateFromLive={vi.fn()}
      />,
    );
    expect(screen.getByText(/out-of-date with live/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /rebase with live/i }),
    ).toBeInTheDocument();
  });

  it("surfaces a stale approval", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          staleApproval: true,
          recommendRebase: true,
        })}
        liveVersion={9}
        baseVersion={5}
        onUpdateFromLive={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/this approval is out of date/i),
    ).toBeInTheDocument();
  });

  it("quantifies a stale approval when timing data is available", () => {
    const twelveDaysAgo = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          staleApproval: true,
          recommendRebase: true,
        })}
        liveVersion={9}
        baseVersion={5}
        onUpdateFromLive={vi.fn()}
        approvedAt={twelveDaysAgo.toISOString()}
        revisionsSinceApproval={2}
      />,
    );
    expect(
      screen.getByText(/approved 12 days ago.*advanced 2 revisions since/i),
    ).toBeInTheDocument();
  });

  it("uses singular phrasing for a single revision since approval", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          staleApproval: true,
          recommendRebase: true,
        })}
        liveVersion={9}
        baseVersion={5}
        approvedAt={new Date().toISOString()}
        revisionsSinceApproval={1}
      />,
    );
    expect(screen.getByText(/advanced 1 revision since/i)).toBeInTheDocument();
  });

  it("falls back to unquantified copy for legacy approvals", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          staleApproval: true,
          recommendRebase: true,
        })}
        liveVersion={9}
        baseVersion={5}
      />,
    );
    expect(
      screen.getByText(
        /changes were published to the live version \(v9\) after this draft was approved/i,
      ),
    ).toBeInTheDocument();
  });

  it("hides the update action when the user cannot rebase", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          recommendRebase: true,
        })}
        liveVersion={8}
        baseVersion={5}
        onUpdateFromLive={vi.fn()}
        canRebase={false}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /rebase with live/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes onUpdateFromLive when the action is clicked", () => {
    const onUpdate = vi.fn();
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          recommendRebase: true,
        })}
        liveVersion={8}
        baseVersion={5}
        onUpdateFromLive={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /rebase with live/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
