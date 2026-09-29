import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getExperimentReviewTitle,
  getStartActions,
  getStartSchedule,
  ServerChecklistItem,
  StartActions,
  StartChecklist,
  withServerChecklist,
} from "@/components/Experiment/TabbedPage/startActions";

// Local-time dates, so the formatted label doesn't depend on the runner's zone.
const now = new Date(2026, 8, 28, 12, 0);
const future = new Date(2026, 9, 3, 9, 0);
const past = new Date(2026, 8, 1, 9, 0);

const done = { loading: false, remaining: 0, blocking: 0, approval: 0 };
const soft = { loading: false, remaining: 1, blocking: 0, approval: 0 };
const approval = { loading: false, remaining: 2, blocking: 1, approval: 1 };
const conflict = { loading: false, remaining: 1, blocking: 1, approval: 0 };
const startNow = "Bypass remaining To Do items and start now";
const scheduleStart = "Bypass remaining To Do items and schedule start";
const reviewAndTodo =
  "Bypass approvals and remaining To Do items and start now";
const futureLabel = "Start Oct 3, 2026 at 9:00 AM";

describe("getStartSchedule", () => {
  it.each([
    { name: "no schedule", at: null, expected: "none" },
    { name: "a later date", at: future, expected: "future" },
    { name: "an earlier date", at: past, expected: "past" },
    { name: "right now", at: now, expected: "past" },
  ])("reads $name as $expected", ({ at, expected }) => {
    expect(getStartSchedule(at, now)).toBe(expected);
  });
});

describe("getStartActions", () => {
  it.each([
    {
      name: "starts at once when everything is done",
      checklist: done,
      expected: { bypassLabel: null, disabled: false },
    },
    {
      name: "never treats a loading checklist as done",
      checklist: { ...done, loading: true },
      bypassed: true,
      expected: { bypassLabel: null, hardBlocked: true, disabled: true },
    },
    {
      name: "offers the bypass for a soft item",
      checklist: soft,
      expected: { bypassLabel: startNow, disabled: true },
    },
    {
      name: "starts once the soft item is bypassed",
      checklist: soft,
      bypassed: true,
      expected: { bypassLabel: startNow, disabled: false },
    },
    {
      name: "offers no bypass past a hard blocker, even to an admin",
      checklist: conflict,
      canBypassApproval: true,
      bypassed: true,
      expected: { bypassLabel: null, hardBlocked: true, disabled: true },
    },
    {
      name: "blocks on a missing upgrade",
      checklist: soft,
      needsUpgrade: true,
      bypassed: true,
      expected: { bypassLabel: null, hardBlocked: true, disabled: true },
    },
    {
      name: "blocks on approval without bypass permission",
      checklist: approval,
      bypassed: true,
      expected: { bypassLabel: null, hardBlocked: true, disabled: true },
    },
    {
      name: "lets an admin bypass approval along with soft items",
      checklist: approval,
      canBypassApproval: true,
      bypassed: true,
      expected: {
        bypassLabel: reviewAndTodo,
        waivesApproval: true,
        disabled: false,
      },
    },
    {
      name: "names only approvals when approval is all that's left",
      checklist: { ...approval, remaining: 1 },
      canBypassApproval: true,
      expected: {
        bypassLabel: "Bypass approvals and start now",
        waivesApproval: true,
        disabled: true,
      },
    },
    {
      name: "offers an admin nothing when approval isn't all that's left",
      checklist: { ...approval, blocking: 2 },
      canBypassApproval: true,
      bypassed: true,
      expected: {
        bypassLabel: null,
        waivesApproval: true,
        hardBlocked: true,
        disabled: true,
      },
    },
    {
      name: "starts at once when the schedule has passed",
      scheduledStartAt: past,
      checklist: done,
      expected: { bypassLabel: null, disabled: false },
    },
    {
      name: "approves a future schedule once everything is done",
      scheduledStartAt: future,
      checklist: done,
      expected: {
        action: "approve-schedule",
        label: futureLabel,
        bypassLabel: null,
        disabled: false,
      },
    },
    {
      name: "waits for the bypass of a soft item on a future schedule",
      scheduledStartAt: future,
      checklist: soft,
      expected: {
        action: "approve-schedule",
        label: futureLabel,
        bypassLabel: scheduleStart,
        disabled: true,
      },
    },
    {
      name: "approves a future schedule past a bypassed soft item",
      scheduledStartAt: future,
      checklist: soft,
      bypassed: true,
      expected: {
        action: "approve-schedule",
        label: futureLabel,
        bypassLabel: scheduleStart,
        disabled: false,
      },
    },
    {
      name: "never lets a scheduled start bypass approval",
      scheduledStartAt: future,
      checklist: approval,
      canBypassApproval: true,
      bypassed: true,
      expected: {
        action: "approve-schedule",
        label: futureLabel,
        bypassLabel: null,
        hardBlocked: true,
        disabled: true,
      },
    },
  ] as {
    name: string;
    scheduledStartAt?: Date;
    checklist: typeof done;
    canBypassApproval?: boolean;
    needsUpgrade?: boolean;
    bypassed?: boolean;
    expected: Partial<StartActions>;
  }[])(
    "$name",
    ({
      scheduledStartAt = null,
      checklist,
      canBypassApproval = false,
      needsUpgrade = false,
      bypassed = false,
      expected,
    }) => {
      expect(
        getStartActions({
          scheduledStartAt,
          now,
          checklist,
          canBypassApproval,
          needsUpgrade,
          bypassed,
        }),
      ).toEqual({
        action: "start",
        label: "Start now",
        waivesApproval: false,
        hardBlocked: false,
        ...expected,
      });
    },
  );
});

describe("withServerChecklist", () => {
  const customTask: ServerChecklistItem = {
    key: "Get legal sign-off",
    required: true,
    status: "incomplete",
    manual: true,
    reason: "Required custom launch checklist item is incomplete",
  };
  const targeting: ServerChecklistItem = {
    key: "targeting",
    required: true,
    status: "incomplete",
    manual: false,
    reason: "Configure variation assignment and targeting behavior",
  };
  const mergeConflict: ServerChecklistItem = {
    key: "mergeConflict:flag-a",
    required: true,
    status: "incomplete",
    manual: false,
    reason: "Resolve the merge conflict",
    hardBlock: true,
  };
  it.each([
    {
      name: "counts a soft item the page lacks",
      checklist: done,
      server: [customTask],
      expected: { ...done, remaining: 1 },
    },
    {
      name: "counts every soft item on top of the page's",
      checklist: soft,
      server: [customTask, targeting],
      expected: { ...soft, remaining: 3 },
    },
    {
      // Resolving it on the page must not leave Start blocked by the refusal.
      name: "leaves a hard item to the page's live rows",
      checklist: approval,
      server: [mergeConflict, customTask],
      expected: { ...approval, remaining: 3 },
    },
  ] as {
    name: string;
    checklist: StartChecklist;
    server: ServerChecklistItem[];
    expected: StartChecklist;
  }[])("$name", ({ checklist, server, expected }) => {
    expect(withServerChecklist(checklist, server)).toEqual(expected);
  });
});

type TitleInput = Parameters<typeof getExperimentReviewTitle>[0];

describe("getExperimentReviewTitle", () => {
  const approvedStart = {
    type: "start",
    date: future.toISOString(),
  } as TitleInput["nextScheduledStatusUpdate"];
  it.each([
    {
      name: "a draft with no schedule",
      status: "draft",
      startAt: null,
      next: null,
      expected: "Review & start experiment",
    },
    {
      name: "a draft Bandit",
      type: "multi-armed-bandit",
      status: "draft",
      startAt: null,
      next: null,
      expected: "Review & start Bandit",
    },
    {
      name: "a draft awaiting its schedule's approval",
      status: "draft",
      startAt: future,
      next: null,
      expected: "Review & schedule experiment",
    },
    {
      name: "a draft whose schedule is approved",
      status: "draft",
      startAt: future,
      next: approvedStart,
      expected: "Review & start experiment",
    },
    {
      name: "a draft whose schedule has passed",
      status: "draft",
      startAt: past,
      next: null,
      expected: "Review & start experiment",
    },
    {
      name: "a running experiment",
      status: "running",
      startAt: future,
      next: null,
      expected: "Review & publish value changes",
    },
  ] as {
    name: string;
    type?: ExperimentInterfaceStringDates["type"];
    status: ExperimentInterfaceStringDates["status"];
    startAt: Date | null;
    next: TitleInput["nextScheduledStatusUpdate"];
    expected: string;
  }[])(
    "titles $name $expected",
    ({ type = "standard", status, startAt, next, expected }) => {
      expect(
        getExperimentReviewTitle(
          {
            type,
            status,
            statusUpdateSchedule: startAt
              ? { startAt: startAt.toISOString() }
              : null,
            nextScheduledStatusUpdate: next,
          },
          now,
        ),
      ).toBe(expected);
    },
  );
});
