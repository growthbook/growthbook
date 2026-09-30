import {
  getValuesStatus,
  ReviewEvent,
  ValuesStatus,
} from "@/components/Experiment/TabbedPage/valuesStatus";

type Input = Parameters<typeof getValuesStatus>[0];
type Managed = NonNullable<Input["managed"]>;

const requester: ReviewEvent = {
  user: { type: "dashboard", id: "u_gabe", name: "Gabe", email: "g@x.io" },
  ago: "2 hours ago",
};
const reviewer: ReviewEvent = {
  user: { type: "dashboard", id: "u_luke", name: "Luke", email: "l@x.io" },
  ago: "5 minutes ago",
};
const satisfied = {
  satisfied: true,
  footprint: {} as never,
  unmetTeams: [],
  insufficientApprovers: [],
  hasCoveringApproval: true,
};

const managed = (
  draft: Partial<Managed["draft"]> = {},
  over: Partial<Managed> = {},
): Managed => ({
  draft: {
    status: "draft",
    pendingApproval: true,
    hasMergeConflict: false,
    rebaseRequired: false,
    staleApproval: false,
    ...draft,
  },
  canRequestReview: false,
  canPublish: false,
  canReview: false,
  viewerRequested: false,
  requested: null,
  verdict: null,
  ...over,
});

const prelaunch: Omit<Input, "managed"> = {
  experimentStatus: "draft",
  viewingLive: false,
  hasUnpublished: true,
};
const running: Omit<Input, "managed"> = {
  experimentStatus: "running",
  viewingLive: false,
  hasUnpublished: true,
};

describe("getValuesStatus", () => {
  it.each<{
    name: string;
    input: Input;
    expected: Partial<ValuesStatus> & { strong?: string };
  }>([
    {
      name: "a running experiment viewed live",
      input: { ...running, viewingLive: true, managed: managed() },
      expected: { tone: "live", link: "switch-to-unpublished", cta: null },
    },
    {
      // Their reviews live on each flag's page.
      name: "unpublished drafts on ordinary flags",
      input: { ...running, managed: null },
      expected: { tone: "draft", strong: "unpublished changes", cta: null },
    },
    {
      name: "a merge conflict",
      input: { ...prelaunch, managed: managed({ hasMergeConflict: true }) },
      expected: {
        tone: "error",
        cta: { label: "Review changes", action: "open" },
      },
    },
    {
      name: "values not yet sent, for their author",
      input: { ...prelaunch, managed: managed({}, { canRequestReview: true }) },
      expected: {
        tone: "draft",
        strong: "need approval",
        cta: { label: "Request review", action: "request" },
      },
    },
    {
      name: "values not yet sent, for anyone else",
      input: { ...prelaunch, managed: managed() },
      expected: { strong: "need approval", cta: null },
    },
    {
      name: "a request, for a reviewer",
      input: {
        ...prelaunch,
        managed: managed(
          { status: "pending-review" },
          { canReview: true, requested: requester },
        ),
      },
      expected: {
        strong: "awaiting review",
        byline: { verb: "Requested by", event: requester },
        cta: { label: "Review and approve", action: "open" },
      },
    },
    {
      name: "the viewer's own request",
      input: {
        ...prelaunch,
        managed: managed(
          { status: "pending-review" },
          { canReview: true, viewerRequested: true },
        ),
      },
      expected: { cta: { label: "View review", action: "open" } },
    },
    {
      name: "changes requested, for the author",
      input: {
        ...prelaunch,
        managed: managed(
          { status: "changes-requested" },
          { canRequestReview: true, verdict: reviewer },
        ),
      },
      expected: {
        strong: "Changes requested",
        link: "view-feedback",
        cta: { label: "Request review", action: "request" },
      },
    },
    {
      name: "approved before the start",
      input: {
        ...prelaunch,
        managed: managed(
          { status: "approved", approval: satisfied },
          { verdict: reviewer },
        ),
      },
      expected: {
        tone: "approved",
        byline: { verb: "Approved by", event: reviewer },
        cta: { label: "View review", action: "open" },
      },
    },
    {
      name: "approved while running, for a publisher",
      input: {
        ...running,
        managed: managed(
          { status: "approved", approval: satisfied },
          { canPublish: true },
        ),
      },
      expected: {
        tone: "approved",
        cta: { label: "Publish changes", action: "publish" },
      },
    },
    {
      name: "approved but short of the gate",
      input: {
        ...running,
        managed: managed({
          status: "approved",
          approval: { ...satisfied, satisfied: false },
        }),
      },
      expected: { tone: "draft", strong: "More approvals needed" },
    },
    {
      name: "no review required while running",
      input: {
        ...running,
        managed: managed({ pendingApproval: false }, { canPublish: true }),
      },
      expected: {
        tone: "draft",
        cta: { label: "Publish changes", action: "publish" },
      },
    },
  ])("says $name", ({ input, expected: { strong, ...expected } }) => {
    const status = getValuesStatus(input);
    expect(status).toMatchObject(expected);
    if (strong) expect(status?.message.strong).toBe(strong);
  });

  it.each<{ name: string; input: Input }>([
    {
      name: "a running experiment with nothing unpublished",
      input: { ...running, hasUnpublished: false, managed: null },
    },
    {
      // Its values simply go live with the start.
      name: "a draft experiment with no review required",
      input: { ...prelaunch, managed: managed({ pendingApproval: false }) },
    },
  ])("says nothing for $name", ({ input }) => {
    expect(getValuesStatus(input)).toBeNull();
  });
});
