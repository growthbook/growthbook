import {
  getValuesBanner,
  ReviewEvent,
  ValuesBanner,
} from "@/components/Experiment/TabbedPage/valuesBanner";

type Input = Parameters<typeof getValuesBanner>[0];

const requester: ReviewEvent = {
  user: { type: "dashboard", id: "u_gabe", name: "Gabe", email: "g@x.io" },
  ago: "2 hours ago",
};
const reviewer: ReviewEvent = {
  user: { type: "dashboard", id: "u_luke", name: "Luke", email: "l@x.io" },
  ago: "5 minutes ago",
};

const base: Input = {
  experimentStatus: "draft",
  draft: {
    status: "pending-review",
    pendingApproval: true,
    hasMergeConflict: false,
    rebaseRequired: false,
    staleApproval: false,
  },
  changeCount: 3,
  canReview: false,
  viewerRequested: false,
  requested: requester,
  verdict: null,
};

const draftWith = (over: Partial<Input["draft"]>): Pick<Input, "draft"> => ({
  draft: { ...base.draft, ...over },
});

describe("getValuesBanner", () => {
  it.each<{
    name: string;
    input: Partial<Input>;
    expected: Partial<ValuesBanner>;
  }>([
    {
      // Nothing can publish, so no review state matters.
      name: "a merge conflict",
      input: { ...draftWith({ hasMergeConflict: true, rebaseRequired: true }) },
      expected: { status: "error", cta: "Review changes" },
    },
    {
      name: "values approved before live moved",
      input: draftWith({ rebaseRequired: true, staleApproval: true }),
      expected: {
        status: "warning",
        title: "The Feature Flag changed after these values were approved",
      },
    },
    {
      name: "the viewer's own request",
      input: { viewerRequested: true, canReview: true },
      expected: {
        status: "info",
        title: "Your change request is awaiting review",
        detail: "Sent 2 hours ago",
        cta: "View request",
      },
    },
    {
      name: "someone else's request, for a reviewer",
      input: { canReview: true },
      expected: {
        status: "warning",
        title: "3 changes awaiting review",
        detail: requester,
        cta: "Review changes",
      },
    },
    {
      name: "someone else's request, for anyone else",
      input: { changeCount: 1 },
      expected: {
        status: "info",
        title: "1 change awaiting review",
        cta: "View request",
      },
    },
    {
      name: "a request with nothing counted",
      input: { changeCount: 0 },
      expected: { title: "Changes awaiting review" },
    },
    {
      name: "changes requested",
      input: {
        ...draftWith({ status: "changes-requested" }),
        verdict: reviewer,
      },
      expected: {
        status: "warning",
        title: "Changes requested",
        detail: reviewer,
      },
    },
    {
      name: "approved, before the start",
      input: {
        ...draftWith({
          status: "approved",
          approval: {
            satisfied: true,
            footprint: {} as never,
            unmetTeams: [],
            insufficientApprovers: [],
            hasCoveringApproval: true,
          },
        }),
        verdict: reviewer,
      },
      expected: {
        status: "success",
        title: "Changes approved and ready to start",
        detail: reviewer,
        cta: "View request",
      },
    },
    {
      name: "approved, while running",
      input: {
        experimentStatus: "running",
        ...draftWith({ status: "approved" }),
      },
      expected: {
        status: "success",
        title: "Changes approved and ready to publish",
      },
    },
    {
      // Approved can still be short of a team or an environment.
      name: "approved but short of the gate",
      input: draftWith({
        status: "approved",
        approval: {
          satisfied: false,
          footprint: {} as never,
          unmetTeams: [[{ id: "t_1", name: "Design" }]],
          insufficientApprovers: [],
          hasCoveringApproval: false,
        },
      }),
      expected: {
        status: "warning",
        title: "Changes approved, more approvals needed",
      },
    },
  ])("banners $name", ({ input, expected }) => {
    expect(getValuesBanner({ ...base, ...input })).toMatchObject(expected);
  });

  // Before it's sent, or with no review required, Setup's own banner is the
  // next step instead.
  it.each<{ name: string; input: Partial<Input> }>([
    { name: "values not yet sent", input: draftWith({ status: "draft" }) },
    {
      name: "no review required before the start",
      input: draftWith({ pendingApproval: false, status: "draft" }),
    },
    {
      name: "no review required while running",
      input: {
        experimentStatus: "running",
        ...draftWith({ pendingApproval: false, status: "draft" }),
      },
    },
  ])("shows nothing for $name", ({ input }) => {
    expect(getValuesBanner({ ...base, ...input })).toBeNull();
  });
});
