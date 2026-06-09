import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import type { PublishGovernanceResult } from "shared/util";
import DivergenceNotice from "@/components/Features/DivergenceNotice";

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

  it("renders nothing for a hard conflict (owned by the conflict resolver)", () => {
    const { container } = render(
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
      />,
    );
    expect(container).toBeEmptyDOMElement();
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
    expect(
      screen.getByText(/live version has changed since this draft/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Rules")).toBeInTheDocument();
    expect(screen.getByText("Env Enabled - prod")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /update from live/i }),
    ).toBeInTheDocument();
  });

  it("shows the block reason when rebase is required (setting on)", () => {
    render(
      <DivergenceNotice
        governance={gov({
          diverged: true,
          divergence: "diverged",
          recommendRebase: true,
          rebaseRequired: true,
          canPublish: false,
          blockReason: "This draft is based on an older version.",
          liveChanges: [{ key: "rules", name: "Rules" }],
        })}
        liveVersion={8}
        baseVersion={5}
        onUpdateFromLive={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/this draft is based on an older version/i),
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
      screen.queryByRole("button", { name: /update from live/i }),
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
    fireEvent.click(screen.getByRole("button", { name: /update from live/i }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });
});
