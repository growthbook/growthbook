import {
  incrementalRefreshMissedReplay,
  sqlReferencesTable,
} from "back-end/src/services/eventForwarder/replayRefresh";

jest.mock("back-end/src/enterprise/licenseUtil", () => ({
  postEventForwarderStatusToLicenseServer: jest.fn(),
}));
jest.mock("back-end/src/models/FactTableModel", () => ({
  dangerouslyGetFactTableByIdBypassPermission: jest.fn(),
}));
jest.mock("back-end/src/services/eventForwarder/config", () => ({
  decryptEventForwarderConfigModel: jest.fn(),
  isInHouseConsumerTopic: jest.fn(),
}));

describe("sqlReferencesTable", () => {
  it("matches the table whatever the path, case or quoting", () => {
    expect(
      sqlReferencesTable("SELECT * FROM `proj.gb.GB_EVENTS` e", "gb_events"),
    ).toBe(true);
    expect(
      sqlReferencesTable(
        'select * from "DB"."PUBLIC"."GB_EVENTS"',
        "GB_EVENTS",
      ),
    ).toBe(true);
    expect(
      sqlReferencesTable("SELECT * FROM gb_events", "main.gb.gb_events"),
    ).toBe(true);
  });

  it("does not match a longer table name", () => {
    expect(sqlReferencesTable("SELECT * FROM gb_events_v2", "gb_events")).toBe(
      false,
    );
    expect(sqlReferencesTable("SELECT * FROM my_gb_events", "gb_events")).toBe(
      false,
    );
    expect(sqlReferencesTable("SELECT 1", "")).toBe(false);
  });

  it("ignores the name in a comment or a string value", () => {
    expect(
      sqlReferencesTable(
        "SELECT * FROM analytics.orders -- formerly gb_events",
        "gb_events",
      ),
    ).toBe(false);
    expect(
      sqlReferencesTable(
        "SELECT * /* gb_events */ FROM orders WHERE src = 'gb_events'",
        "gb_events",
      ),
    ).toBe(false);
    // A quote in a comment, or `--` in a string, must not hide a real read.
    expect(
      sqlReferencesTable(
        "-- don't drop\nSELECT * FROM gb_events WHERE a = 'x--y' AND b = 'z'",
        "gb_events",
      ),
    ).toBe(true);
    expect(
      sqlReferencesTable("SELECT 'a--b' AS c FROM gb_events", "gb_events"),
    ).toBe(true);
  });
});

describe("incrementalRefreshMissedReplay", () => {
  const replay = {
    earliestEventAt: "2026-11-09T08:00:00.000Z",
    lastWriteAt: "2026-11-10T12:00:00.000Z",
  };
  const source = (factTableId: string, maxTimestamp: string | null) => ({
    groupId: factTableId,
    factTableId,
    metrics: [],
    maxTimestamp: maxTimestamp ? new Date(maxTimestamp) : null,
    tableFullName: "t",
  });
  const base = {
    replay,
    forwarderTables: ["main.gb.gb_events", "main.gb.gb_experiment_viewed"],
    exposureQuerySql: "SELECT * FROM main.gb.gb_experiment_viewed",
    getFactTableSql: (id: string) =>
      id === "ft_forwarder"
        ? "SELECT * FROM main.gb.gb_events"
        : "SELECT * FROM analytics.orders",
  };
  // Refreshed before the replay, with watermarks past the replayed events.
  const stale = {
    unitsMaxTimestamp: new Date("2026-11-10T09:00:00.000Z"),
    metricSources: [source("ft_forwarder", "2026-11-10T09:00:00.000Z")],
    fullRefreshStartedAt: new Date("2026-11-01T00:00:00.000Z"),
  };

  it("flags an experiment whose watermark is past the replayed events", () => {
    expect(
      incrementalRefreshMissedReplay({ ...base, incrementalRefresh: stale }),
    ).toBe(true);
    // State saved before the field existed predates the replay.
    expect(
      incrementalRefreshMissedReplay({
        ...base,
        incrementalRefresh: { ...stale, fullRefreshStartedAt: undefined },
      }),
    ).toBe(true);
  });

  it("clears once a Full Refresh has started after the replay's last write", () => {
    expect(
      incrementalRefreshMissedReplay({
        ...base,
        incrementalRefresh: {
          ...stale,
          fullRefreshStartedAt: new Date("2026-11-10T12:00:01.000Z"),
        },
      }),
    ).toBe(false);
  });

  it("leaves alone an experiment that has not read past the replayed events", () => {
    expect(
      incrementalRefreshMissedReplay({
        ...base,
        incrementalRefresh: {
          ...stale,
          unitsMaxTimestamp: new Date("2026-11-09T07:00:00.000Z"),
          metricSources: [source("ft_forwarder", "2026-11-09T07:00:00.000Z")],
        },
      }),
    ).toBe(false);
  });

  it("leaves alone an experiment that does not read the forwarder's tables", () => {
    expect(
      incrementalRefreshMissedReplay({
        ...base,
        exposureQuerySql: "SELECT * FROM analytics.exposures",
        incrementalRefresh: {
          ...stale,
          metricSources: [source("ft_orders", "2026-11-10T09:00:00.000Z")],
        },
      }),
    ).toBe(false);
  });

  it("flags on a metric source alone", () => {
    expect(
      incrementalRefreshMissedReplay({
        ...base,
        exposureQuerySql: "SELECT * FROM analytics.exposures",
        incrementalRefresh: stale,
      }),
    ).toBe(true);
  });
});
