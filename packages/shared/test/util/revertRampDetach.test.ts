import { RampScheduleInterface } from "shared/validators";
import {
  getRevertRampDetachActions,
  revertRampStopWarning,
  toRampAttachments,
} from "shared/util";

type Schedule = Pick<
  RampScheduleInterface,
  "id" | "name" | "status" | "targets" | "dateCreated"
>;

function schedule(
  id: string,
  ruleIds: string[],
  overrides: Partial<Schedule> = {},
): Schedule {
  return {
    id,
    name: `Ramp ${id}`,
    status: "running",
    dateCreated: new Date("2026-09-10T00:00:00Z"),
    targets: ruleIds.map((ruleId, i) => ({
      id: `t_${id}_${i}`,
      entityType: "feature",
      entityId: "feat",
      ruleId,
      status: "active",
    })),
    ...overrides,
  };
}

const detach = (rampScheduleId: string, ruleId: string) => ({
  mode: "detach" as const,
  rampScheduleId,
  ruleId,
  deleteScheduleWhenEmpty: true,
});

describe("toRampAttachments", () => {
  it("records live targets on this feature only", () => {
    expect(
      toRampAttachments("feat", [
        schedule("a", ["fr_1", "fr_2"]),
        schedule("done", ["fr_3"], { status: "completed" }),
        schedule("other", ["fr_4"], {
          targets: [
            {
              id: "t",
              entityType: "feature",
              entityId: "other-feat",
              ruleId: "fr_4",
              status: "active",
            },
          ],
        }),
      ]),
    ).toEqual([
      { rampScheduleId: "a", ruleId: "fr_1" },
      { rampScheduleId: "a", ruleId: "fr_2" },
    ]);
  });
});

describe("getRevertRampDetachActions", () => {
  it("detaches targets the recorded attachments do not list, by exact rule id", () => {
    const actions = getRevertRampDetachActions(
      "feat",
      {
        datePublished: new Date("2026-09-20T00:00:00Z"),
        rampAttachments: [
          { rampScheduleId: "kept", ruleId: "fr_1__production" },
        ],
      },
      [
        schedule("kept", ["fr_1__production", "fr_1__dev"]),
        schedule("new", ["fr_3"]),
      ],
    );
    expect(actions).toEqual([
      detach("kept", "fr_1__dev"),
      detach("new", "fr_3"),
    ]);
  });

  it("treats an empty recording as no ramps attached", () => {
    expect(
      getRevertRampDetachActions(
        "feat",
        { datePublished: null, rampAttachments: [] },
        [schedule("a", ["fr_1"])],
      ),
    ).toEqual([detach("a", "fr_1")]);
  });

  it("falls back to creation vs publish time for unrecorded revisions", () => {
    const schedules = [
      schedule("before", ["fr_1"], {
        dateCreated: new Date("2026-09-01T00:00:00Z"),
      }),
      // JSON-string dates, as the dashboard holds them.
      schedule("after", ["fr_2"], {
        dateCreated: "2026-09-15T00:00:00Z" as unknown as Date,
      }),
    ];
    expect(
      getRevertRampDetachActions(
        "feat",
        { datePublished: "2026-09-05T00:00:00Z" as unknown as Date },
        schedules,
      ),
    ).toEqual([detach("after", "fr_2")]);
    expect(
      getRevertRampDetachActions("feat", { datePublished: null }, schedules),
    ).toEqual([]);
  });
});

describe("revertRampStopWarning", () => {
  const schedules = [schedule("a", ["fr_1"]), schedule("b", ["fr_2", "fr_3"])];

  it("deletes a ramp whose every rule is detached", () => {
    expect(revertRampStopWarning([], schedules)).toBeNull();
    expect(revertRampStopWarning([detach("a", "fr_1")], schedules)).toBe(
      'This revert will delete the ramp-up on Rule "fr_1".',
    );
    expect(
      revertRampStopWarning([detach("a", "fr_1")], schedules, { draft: true }),
    ).toBe(
      'When published, this revert draft will delete the ramp-up on Rule "fr_1".',
    );
    expect(
      revertRampStopWarning([detach("a", "fr_1")], schedules, {
        apiRequest: true,
      }),
    ).toBe(
      'This revert will delete the ramp schedule "Ramp a" (a) on Rule "fr_1".',
    );
  });

  it("removes rules from a ramp that keeps others", () => {
    expect(revertRampStopWarning([detach("b", "fr_2")], schedules)).toBe(
      'This revert will remove Rule "fr_2" from its ramp-up.',
    );
    // A migrated sibling stays on the ramp, as it does in the detach itself.
    expect(
      revertRampStopWarning(
        [detach("c", "fr_4__dev")],
        [schedule("c", ["fr_4__dev", "fr_4__prod"])],
      ),
    ).toBe('This revert will remove Rule "fr_4__dev" from its ramp-up.');
    expect(
      revertRampStopWarning(
        [detach("a", "fr_1"), detach("b", "fr_2")],
        schedules,
        { apiRequest: true },
      ),
    ).toBe(
      'This revert will remove Rules "fr_1", "fr_2" from the ramp schedules "Ramp a" (a), "Ramp b" (b).',
    );
  });
});
