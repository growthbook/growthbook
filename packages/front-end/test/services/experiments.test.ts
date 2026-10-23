import { describe, expect, it, vi } from "vitest";
import type { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  convertExperimentToTemplate,
  experimentDate,
} from "@/services/experiments";

describe("convertExperimentToTemplate", () => {
  it("stores a legacy experiment's resolved identifier type", () => {
    const experiment = {
      name: "Checkout",
      datasource: "ds_1",
      exposureQueryId: "eq_1",
      phases: [{ coverage: 1, condition: "" }],
    } as unknown as ExperimentInterfaceStringDates;

    const template = convertExperimentToTemplate(experiment, {
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(template.exposureQueryIdentifierType).toBe("anonymous_id");
  });
});

describe("experimentDate", () => {
  const exp = (fields: object) =>
    ({
      archived: false,
      dateCreated: "2024-01-01T00:00:00Z",
      dateUpdated: "2024-02-01T00:00:00Z",
      phases: [],
      ...fields,
    }) as unknown as ExperimentInterfaceStringDates;

  it("returns the last phase's end date for a stopped experiment", () => {
    expect(
      experimentDate(
        exp({
          status: "stopped",
          phases: [
            { dateStarted: "2024-03-01T00:00:00Z" },
            {
              dateStarted: "2024-04-01T00:00:00Z",
              dateEnded: "2024-05-01T00:00:00Z",
            },
          ],
        }),
      ),
    ).toBe("2024-05-01T00:00:00Z");
  });

  it("does not use today for a stopped experiment with no end date", () => {
    expect(
      experimentDate(
        exp({
          status: "stopped",
          phases: [{ dateStarted: "2024-03-01T00:00:00Z" }],
        }),
      ),
    ).toBeUndefined();
  });

  it("falls back to now for a running experiment with no start date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-01T00:00:00Z"));
    try {
      expect(experimentDate(exp({ status: "running", phases: [{}] }))).toBe(
        "2025-06-01T00:00:00.000Z",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses dateUpdated when archived and dateCreated for drafts", () => {
    expect(experimentDate(exp({ status: "stopped", archived: true }))).toBe(
      "2024-02-01T00:00:00Z",
    );
    expect(experimentDate(exp({ status: "draft" }))).toBe(
      "2024-01-01T00:00:00Z",
    );
  });
});
