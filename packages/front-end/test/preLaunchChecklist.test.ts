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
  isBypassableStartItem,
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
    row("staleVariationValues:f1", { hardBlock: true }),
    row("goalMetric"),
    row("visualEditorChanges", { required: false }),
    row("targeting", { status: "complete" }),
    row("sdkConnection", { status: "complete", warning: "Not verified" }),
  ];
  const keys = (list: CheckListItem[]) => list.map((i) => i.key);

  it("sorts items into tiers", () => {
    const summary = summarizeChecklist(items);
    expect(keys(summary.incomplete.blocking)).toEqual([
      "conflict",
      "pendingApproval:f1",
      "staleVariationValues:f1",
    ]);
    expect(keys(summary.incomplete.recommended)).toEqual(["goalMetric"]);
    expect(keys(summary.incomplete.optional)).toEqual(["visualEditorChanges"]);
    expect(keys(summary.flagged)).toEqual(["sdkConnection"]);
    expect(keys(summary.complete)).toEqual(["targeting"]);
    // Optional items count; a done row with a warning doesn't.
    expect(summary.remaining).toBe(5);
    expect(summary.blocking).toBe(3);
  });

  // A conflict is never the admin's to override.
  it("lets an admin's start bypass waive only approval and stale values", () => {
    expect(keys(items.filter(isBypassableStartItem))).toEqual([
      "pendingApproval:f1",
      "staleVariationValues:f1",
    ]);
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

  it.each([
    { name: "blocks without a phase", over: { phases: [] }, hardBlock: true },
    { name: "is done with one", over: {}, hardBlock: false },
  ])("targeting $name", ({ over, hardBlock }) => {
    const targeting = find(
      getChecklistItems({
        experiment: experiment(over),
        linkedFeatures: [],
        visualChangesets: [],
        connections: [],
      }),
      "targeting",
    );
    expect(targeting?.status).toBe(hardBlock ? "incomplete" : "complete");
    expect(!!targeting?.hardBlock).toBe(hardBlock);
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

  // The experiment's own flag; its values are fixed in the review.
  const managed = (over: Partial<LinkedFeatureInfo> = {}) =>
    flag("f1", {
      feature: {
        id: "f1",
        valueType: "boolean",
        managedBy: { type: "experiment", experimentId: "exp_1" },
      },
      state: "draft",
      ...over,
    } as Partial<LinkedFeatureInfo>);
  const draft = (over: Record<string, unknown>) =>
    ({
      values: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
      valueType: "boolean",
      hasMergeConflict: false,
      rebaseRequired: false,
      ...over,
    }) as unknown as LinkedFeatureInfo["pendingDraft"];
  const openReview = () => undefined;
  const editValues = () => undefined;
  const itemsFor = (info: LinkedFeatureInfo) =>
    getChecklistItems({
      experiment: experiment({ linkedFeatures: ["f1"] }),
      linkedFeatures: [info],
      visualChangesets: [],
      connections: [],
      openManagedApproval: openReview,
      editVariationValues: editValues,
    });

  it.each([
    {
      name: "a stale managed draft",
      info: managed({ pendingDraft: draft({ rebaseRequired: true }) }),
      stale: true,
    },
    {
      name: "a managed draft that's current",
      info: managed({ pendingDraft: draft({}) }),
      stale: false,
    },
    {
      name: "a stale managed draft that also conflicts",
      info: managed({
        pendingDraft: draft({ rebaseRequired: true, hasMergeConflict: true }),
      }),
      stale: false,
    },
    {
      name: "a stale linked Feature Flag draft",
      info: flag("f1", {
        state: "draft",
        pendingDraft: draft({ rebaseRequired: true }),
      }),
      stale: false,
    },
  ])("stale-values row for $name", ({ info, stale }) => {
    const item = find(itemsFor(info), "staleVariationValues:f1");
    expect(item ? getChecklistTier(item) : null).toBe(
      stale ? "blocking" : null,
    );
    if (stale) {
      expect(item?.action).toEqual({ onClick: openReview });
      expect(item?.featureId).toBe("f1");
    }
  });

  it("sends a managed merge conflict to the review", () => {
    const conflict = find(
      itemsFor(managed({ hasMergeConflict: true })),
      "mergeConflict:f1",
    );
    expect(conflict?.action).toEqual({ onClick: openReview });
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
