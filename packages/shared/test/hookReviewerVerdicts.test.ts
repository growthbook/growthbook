import { toHookReviewerVerdicts } from "shared/enterprise";

const at = (iso: string) => new Date(iso);
const enrich = (userId: string) => ({
  user: { id: userId },
  teams: [{ id: "team_a", name: "Payments" }],
});
const map = (
  reviews: {
    userId: string;
    decision: string;
    stale?: boolean;
    dateCreated: Date;
  }[],
) => toHookReviewerVerdicts(reviews, enrich);

describe("reviewer verdicts exposed to hooks", () => {
  it("collapses decision + stale into the feature status", () => {
    const out = map([
      { userId: "u_a", decision: "approve", dateCreated: at("2026-01-01") },
      {
        userId: "u_b",
        decision: "request-changes",
        dateCreated: at("2026-01-01"),
      },
      {
        userId: "u_c",
        decision: "approve",
        stale: true,
        dateCreated: at("2026-01-01"),
      },
      {
        userId: "u_d",
        decision: "request-changes",
        stale: true,
        dateCreated: at("2026-01-01"),
      },
    ]);

    expect(out.map((r) => [r.userId, r.status])).toEqual([
      ["u_a", "approved"],
      ["u_b", "changes-requested"],
      ["u_c", "approved-stale"],
      ["u_d", "changes-requested-stale"],
    ]);
  });

  // Comments are not verdicts; a policy counting approvals must not see them.
  it("drops comments", () => {
    expect(
      map([
        { userId: "u_a", decision: "comment", dateCreated: at("2026-01-01") },
      ]),
    ).toEqual([]);
  });

  it("keeps one entry per reviewer, the latest verdict", () => {
    const out = map([
      {
        userId: "u_a",
        decision: "request-changes",
        dateCreated: at("2026-01-01"),
      },
      { userId: "u_a", decision: "approve", dateCreated: at("2026-01-02") },
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].status).toBe("approved");
    expect(out[0].timestamp).toEqual(at("2026-01-02"));
  });

  it("does not let an older verdict overwrite a newer one", () => {
    const out = map([
      { userId: "u_a", decision: "approve", dateCreated: at("2026-01-02") },
      {
        userId: "u_a",
        decision: "request-changes",
        dateCreated: at("2026-01-01"),
      },
    ]);

    expect(out[0].status).toBe("approved");
  });

  it("carries the enriched user and teams through", () => {
    const out = map([
      { userId: "u_a", decision: "approve", dateCreated: at("2026-01-01") },
    ]);

    expect(out[0].user).toEqual({ id: "u_a" });
    expect(out[0].teams).toEqual([{ id: "team_a", name: "Payments" }]);
  });
});
