import {
  ExperimentInterfaceStringDates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ExperimentLaunchChecklistInterface } from "shared/types/experimentLaunchChecklist";
import {
  CheckListItem,
  getChecklistItems,
} from "@/components/PreLaunchChecklist/PreLaunchChecklistItems";
import {
  getChecklistTier,
  isPendingApprovalItem,
  nextManualChecklist,
  summarizeChecklist,
} from "@/components/PreLaunchChecklist/checklistSummary";
import { deepFreeze } from "./test-helpers";

const row = (
  key: string,
  over: Partial<CheckListItem> = {},
): CheckListItem => ({
  key,
  display: key,
  status: "incomplete",
  type: "auto",
  required: true,
  ...over,
});

describe("summarizeChecklist", () => {
  const items = [
    row("conflict", { hardBlock: true }),
    row("pendingApproval:f1", { hardBlock: true }),
    row("goalMetric"),
    row("visualEditorChanges", { required: false }),
    row("targeting", { status: "complete" }),
    row("sdkConnection", { status: "complete", warning: "Not verified" }),
  ];
  const keys = (list: CheckListItem[]) => list.map((i) => i.key);

  it.each([
    {
      name: "everything",
      waive: undefined,
      blocking: ["conflict", "pendingApproval:f1"],
      remaining: 4,
    },
    {
      name: "with approvals waived",
      waive: isPendingApprovalItem,
      blocking: ["conflict"],
      remaining: 3,
    },
  ])("sorts $name into tiers", ({ waive, blocking, remaining }) => {
    const summary = summarizeChecklist(items, waive);
    expect(keys(summary.incomplete.blocking)).toEqual(blocking);
    expect(keys(summary.incomplete.recommended)).toEqual(["goalMetric"]);
    expect(keys(summary.incomplete.optional)).toEqual(["visualEditorChanges"]);
    expect(keys(summary.flagged)).toEqual(["sdkConnection"]);
    expect(keys(summary.complete)).toEqual(["targeting"]);
    // Optional items count; a done row with a warning doesn't.
    expect(summary.remaining).toBe(remaining);
    expect(summary.blocking).toBe(blocking.length);
  });
});

describe("nextManualChecklist", () => {
  it.each([
    {
      name: "adds a new key",
      existing: [{ key: "a", status: "complete" as const }],
      key: "b",
      checked: true,
      expected: [
        { key: "a", status: "complete" },
        { key: "b", status: "complete" },
      ],
    },
    {
      name: "replaces a key in place",
      existing: [
        { key: "a", status: "complete" as const },
        { key: "b", status: "complete" as const },
      ],
      key: "a",
      checked: false,
      expected: [
        { key: "a", status: "incomplete" },
        { key: "b", status: "complete" },
      ],
    },
    {
      name: "starts a missing list",
      existing: undefined,
      key: "a",
      checked: true,
      expected: [{ key: "a", status: "complete" }],
    },
  ])("$name", ({ existing, key, checked, expected }) => {
    if (existing) deepFreeze(existing);
    expect(nextManualChecklist(existing, key, checked)).toEqual(expected);
  });
});

const experiment = (
  over: Partial<ExperimentInterfaceStringDates> = {},
): ExperimentInterfaceStringDates =>
  ({
    id: "exp_1",
    type: "standard",
    status: "draft",
    datasource: "ds_1",
    exposureQueryId: "user_id",
    goalMetrics: ["met_1"],
    variations: [
      { id: "v0", key: "0", name: "Control", screenshots: [] },
      { id: "v1", key: "1", name: "Treatment", screenshots: [] },
    ],
    phases: [{ variations: [] }],
    linkedFeatures: [],
    tags: [],
    ...over,
  }) as unknown as ExperimentInterfaceStringDates;

const flag = (
  id: string,
  over: Partial<LinkedFeatureInfo> = {},
): LinkedFeatureInfo =>
  ({
    feature: { id, valueType: "boolean" },
    state: "live",
    values: [
      { variationId: "v0", value: "false" },
      { variationId: "v1", value: "true" },
    ],
    draftRevisionVersion: 3,
    ...over,
  }) as unknown as LinkedFeatureInfo;

const connection = (connected: boolean) =>
  ({
    id: "sdk_1",
    projects: [],
    connected,
  }) as unknown as SDKConnectionInterface;

const find = (items: CheckListItem[], key: string) =>
  items.find((i) => i.key === key);

describe("getChecklistItems", () => {
  it("keys every row uniquely", () => {
    const blocked = { state: "draft" as const, hasMergeConflict: true };
    const items = getChecklistItems({
      experiment: experiment({ linkedFeatures: ["f1", "f2"] }),
      linkedFeatures: [
        flag("f1", { ...blocked, pendingApproval: true }),
        flag("f2", { ...blocked, pendingApproval: true }),
      ],
      visualChangesets: [],
      connections: [],
      checklist: {
        tasks: [
          { task: "Sign off", completionType: "manual" },
          { task: "Sign off", completionType: "manual" },
          { task: "datasource", completionType: "manual" },
        ],
      } as ExperimentLaunchChecklistInterface,
    });
    const keys = items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    // Identity is its own thing; the stored key is still the task text.
    expect(items.filter((i) => i.manualKey === "Sign off")).toHaveLength(2);
  });

  const conflicted = flag("f1", { state: "draft", hasMergeConflict: true });
  const onClick = () => undefined;
  it.each([
    {
      name: "no page to fix things on",
      callbacks: {},
      over: {},
      clicks: false,
    },
    {
      name: "an approved scheduled start",
      callbacks: { editTargeting: onClick, openAnalysisSettings: onClick },
      over: {
        nextScheduledStatusUpdate: { type: "start", date: "2026-10-01" },
      },
      clicks: false,
    },
    {
      name: "the experiment page",
      callbacks: { editTargeting: onClick, openAnalysisSettings: onClick },
      over: {},
      clicks: true,
    },
  ] as const)("with $name, keeps links", ({ callbacks, over, clicks }) => {
    const items = getChecklistItems({
      experiment: experiment({
        ...over,
        datasource: "",
        phases: [],
        linkedFeatures: ["f1"],
      } as Partial<ExperimentInterfaceStringDates>),
      linkedFeatures: [conflicted],
      visualChangesets: [],
      connections: [],
      ...callbacks,
    });
    const actions = items.map((i) => i.action).filter((a) => !!a);
    expect(actions.some((a) => "onClick" in a)).toBe(clicks);
    expect(find(items, "mergeConflict:f1")?.action).toEqual({
      href: "/features/f1?v=3",
      external: true,
    });
  });

  it.each([
    {
      name: "none, with the create form",
      connections: [],
      create: onClick,
      status: "incomplete",
      action: { onClick },
      warned: false,
    },
    {
      name: "none, without it",
      connections: [],
      create: null,
      status: "incomplete",
      action: { href: "/sdks" },
      warned: false,
    },
    {
      name: "an unverified one",
      connections: [connection(false)],
      create: onClick,
      status: "complete",
      action: { href: "/sdks" },
      warned: true,
    },
  ])(
    "SDK Connection row with $name",
    ({ connections, create, status, action, warned }) => {
      const sdk = find(
        getChecklistItems({
          experiment: experiment(),
          linkedFeatures: [],
          visualChangesets: [],
          connections,
          createSdkConnection: create,
        }),
        "sdkConnection",
      );
      expect(sdk?.status).toBe(status);
      expect(sdk?.action).toEqual(action);
      expect(!!sdk?.warning).toBe(warned);
    },
  );

  // A Bandit's change must be live; on the flag's own Review & Publish page,
  // publishing that draft is what takes it live.
  it.each([
    { name: "the experiment page", publishing: undefined, tier: "blocking" },
    { name: "publishing that flag", publishing: "f1", tier: null },
    { name: "publishing another flag", publishing: "f2", tier: "recommended" },
  ])("Bandit live-change row on $name", ({ publishing, tier }) => {
    const linked = find(
      getChecklistItems({
        experiment: experiment({
          type: "multi-armed-bandit",
          linkedFeatures: ["f1"],
        }),
        linkedFeatures: [flag("f1", { state: "draft" })],
        visualChangesets: [],
        connections: [],
        publishingFeatureId: publishing,
      }),
      "linkedChanges",
    );
    expect(linked).toBeDefined();
    expect(
      linked && linked.status === "incomplete"
        ? getChecklistTier(linked)
        : null,
    ).toBe(tier);
  });

  it("makes an empty Visual Editor changeset optional", () => {
    const visual = find(
      getChecklistItems({
        experiment: experiment({ hasVisualChangesets: true }),
        linkedFeatures: [],
        visualChangesets: [
          { id: "vc_1", visualChanges: [] },
        ] as unknown as VisualChangesetInterface[],
        connections: [],
      }),
      "visualEditorChanges",
    );
    expect(visual?.status).toBe("incomplete");
    expect(visual && getChecklistTier(visual)).toBe("optional");
  });
});
