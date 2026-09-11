import { SlackEventWebHookOptions } from "shared/validators";
import {
  getSlackDigestScheduleUpdate,
  finishSlackDigestWindow,
} from "back-end/src/services/slack/digestSchedule";

const options: SlackEventWebHookOptions = {
  experimentDigest: { frequency: "daily", hourUtc: 9 },
  featureDigest: { frequency: "weekly", hourUtc: 14, dayOfWeekUtc: 1 },
};
const now = new Date("2026-09-11T10:00:00Z");
it("clears both due dates when disabling without cancelling the delivery lease", () => {
  expect(
    getSlackDigestScheduleUpdate(
      { enabled: true, slackOptions: options },
      { enabled: false },
      now,
    ),
  ).toEqual({
    set: {},
    unset: { nextExperimentDigestAt: "", nextFeatureDigestAt: "" },
  });
});
it("resumes at future boundaries instead of replaying a month of paused digests", () => {
  const state = {
    enabled: false,
    slackOptions: options,
    nextExperimentDigestAt: new Date("2026-08-01T09:00:00Z"),
    nextFeatureDigestAt: new Date("2026-08-03T14:00:00Z"),
  };
  expect(getSlackDigestScheduleUpdate(state, { enabled: true }, now)).toEqual({
    set: {
      nextExperimentDigestAt: new Date("2026-09-12T09:00:00Z"),
      nextFeatureDigestAt: new Date("2026-09-14T14:00:00Z"),
    },
    unset: {},
  });
});
it("resuming respects newly saved cadence and leaves disabled digests off", () => {
  expect(
    getSlackDigestScheduleUpdate(
      { enabled: false, slackOptions: options },
      {
        enabled: true,
        slackOptions: {
          experimentDigest: {
            frequency: "monthly",
            dayOfMonth: 1,
            hourUtc: 12,
          },
          featureDigest: { frequency: "off" },
        },
      },
      now,
    ),
  ).toEqual({
    set: { nextExperimentDigestAt: new Date("2026-10-01T12:00:00Z") },
    unset: { nextFeatureDigestAt: "" },
  });
});
it("preserves schedule and in-flight lease for an unrelated settings save", () => {
  const lease = new Date(now.getTime() + 600000);
  const state = {
    enabled: true,
    slackOptions: options,
    experimentDigestLeaseUntil: lease,
  };
  const update = getSlackDigestScheduleUpdate(
    state,
    { slackOptions: { ...options, experimentCardFormat: "compact" } },
    now,
  );
  expect(update).toEqual({ set: {}, unset: {} });
  expect({ ...state, ...update.set }.experimentDigestLeaseUntil).toEqual(lease);
});
it("cadence changes replace only that due date, preserving completion ownership", () => {
  const update = getSlackDigestScheduleUpdate(
    { enabled: true, slackOptions: options },
    {
      slackOptions: {
        ...options,
        experimentDigest: { frequency: "weekly", hourUtc: 9, dayOfWeekUtc: 1 },
      },
    },
    now,
  );
  expect(update).toEqual({
    set: { nextExperimentDigestAt: new Date("2026-09-14T09:00:00Z") },
    unset: {},
  });
});
it("completion consumes the unchanged window even after an unrelated save", async () => {
  const release = jest.fn();
  const advance = jest.fn().mockResolvedValue(true);
  await finishSlackDigestWindow({ advance, release });
  expect(advance).toHaveBeenCalledTimes(1);
  expect(release).not.toHaveBeenCalled();
});
it("completion releases its lease when the due date was replaced or cleared", async () => {
  const release = jest.fn();
  await finishSlackDigestWindow({
    advance: jest.fn().mockResolvedValue(false),
    release,
  });
  expect(release).toHaveBeenCalledTimes(1);
});
it("does not treat a failed completion write as a replaced schedule", async () => {
  const release = jest.fn();
  await expect(
    finishSlackDigestWindow({
      advance: jest.fn().mockRejectedValue(new Error("database unavailable")),
      release,
    }),
  ).rejects.toThrow("database unavailable");
  expect(release).not.toHaveBeenCalled();
});
