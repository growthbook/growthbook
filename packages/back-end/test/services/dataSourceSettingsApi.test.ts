import { DataSourceSettings, ExposureQuery } from "shared/types/datasource";
import {
  findRepeatedAssignmentQueryId,
  mergeDataSourceSettingsBody,
  testDataSourceSettingsQueries,
} from "back-end/src/services/dataSourceSettingsApi";
import { SourceIntegrationInterface } from "back-end/src/types/Integration";

const storedQuery: ExposureQuery = {
  id: "eq_a",
  name: "Anonymous",
  description: "",
  userIdType: "anonymous_id",
  userIdTypes: ["anonymous_id"],
  query: "SELECT * FROM exposures",
  hasNameCol: false,
  dimensions: [],
  error: "old error",
};

// What GET /data-sources/:id shows for storedQuery
const shownQuery = {
  id: "eq_a",
  name: "Anonymous",
  description: "",
  identifierTypes: ["anonymous_id"],
  identifierType: "anonymous_id",
  sql: "SELECT * FROM exposures",
  includesNameColumns: false,
  dimensionColumns: [],
  projects: [],
  error: "old error",
};

const stored: DataSourceSettings = {
  userIdTypes: [
    { userIdType: "anonymous_id", description: "", attributes: ["id"] },
  ],
  queries: {
    exposure: [storedQuery],
    identityJoins: [{ ids: ["anonymous_id", "user_id"], query: "SELECT 1" }],
  },
};

describe("findRepeatedAssignmentQueryId", () => {
  it("returns the first repeated id", () => {
    expect(
      findRepeatedAssignmentQueryId([{ id: "a" }, { id: "b" }, { id: "a" }]),
    ).toBe("a");
    expect(findRepeatedAssignmentQueryId([{ id: "a" }, { id: "b" }])).toBe(
      null,
    );
    expect(findRepeatedAssignmentQueryId(undefined)).toBe(null);
  });
});

describe("mergeDataSourceSettingsBody", () => {
  it("changes nothing when the GET is sent back", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      identifierTypes: [{ id: "anonymous_id", description: "" }],
      assignmentQueries: [shownQuery],
      identifierJoinQueries: [
        { identifierTypes: ["anonymous_id", "user_id"], sql: "SELECT 1" },
      ],
    });
    expect(merged.changed).toBe(false);
    expect(merged.changedExposureQueries).toEqual([]);
    expect(merged.newIdentityJoins).toEqual([]);
    expect(merged.settings).toEqual(stored);
  });

  it("treats an empty join list as unchanged when none is stored", () => {
    const merged = mergeDataSourceSettingsBody(
      { queries: { exposure: [storedQuery] } },
      { identifierJoinQueries: [] },
    );
    expect(merged.changed).toBe(false);
  });

  it("doesn't count missing stored dimensions as a change", () => {
    const legacy = { ...storedQuery } as Partial<ExposureQuery>;
    delete legacy.dimensions;
    const merged = mergeDataSourceSettingsBody(
      { queries: { exposure: [legacy as ExposureQuery] } },
      { assignmentQueries: [shownQuery] },
    );
    expect(merged.changed).toBe(false);
  });

  it("only changes a stored identifier type's description", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      identifierTypes: [
        { id: "anonymous_id", description: "Cookie" },
        { id: "user_id" },
      ],
    });
    expect(merged.changed).toBe(true);
    expect(merged.settings.userIdTypes).toEqual([
      { userIdType: "anonymous_id", description: "Cookie", attributes: ["id"] },
      { userIdType: "user_id", description: "" },
    ]);
  });

  it("updates a stored query by id, keeping fields left out, and clears its error", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      assignmentQueries: [
        {
          id: "eq_a",
          name: "Anonymous",
          identifierTypes: ["anonymous_id"],
          sql: "SELECT * FROM new_exposures",
        },
      ],
    });
    const expected = {
      ...storedQuery,
      query: "SELECT * FROM new_exposures",
    };
    delete expected.error;
    expect(merged.changed).toBe(true);
    expect(merged.changedExposureQueries).toEqual([expected]);
    expect(merged.settings.queries?.exposure).toEqual([expected]);
    // Other lists are left as stored
    expect(merged.settings.userIdTypes).toBe(stored.userIdTypes);
    expect(merged.settings.queries?.identityJoins).toBe(
      stored.queries?.identityJoins,
    );
  });

  it("doesn't write [] projects onto a query stored with none", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      assignmentQueries: [{ ...shownQuery, name: "Renamed" }],
    });
    expect(merged.changedExposureQueries[0]).not.toHaveProperty("projects");
    expect(merged.changedExposureQueries[0].name).toBe("Renamed");
  });

  it("adds new queries at the end and never removes stored ones", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      assignmentQueries: [
        {
          id: "eq_b",
          name: "Users",
          identifierTypes: ["user_id"],
          sql: "SELECT * FROM user_exposures",
          projects: ["prj_1"],
        },
      ],
    });
    expect(merged.settings.queries?.exposure).toEqual([
      storedQuery,
      {
        id: "eq_b",
        name: "Users",
        description: "",
        userIdType: "user_id",
        userIdTypes: ["user_id"],
        query: "SELECT * FROM user_exposures",
        hasNameCol: false,
        dimensions: [],
        projects: ["prj_1"],
      },
    ]);
  });

  it("gives added queries a server id when asked", () => {
    const merged = mergeDataSourceSettingsBody(
      stored,
      {
        assignmentQueries: [
          { ...shownQuery, name: "Edited" },
          {
            id: "eq_mine",
            name: "Mine",
            identifierTypes: ["user_id"],
            sql: "SELECT 2",
          },
        ],
      },
      () => "exq_new",
    );
    expect(merged.changedExposureQueries.map((q) => q.id)).toEqual([
      "eq_a",
      "exq_new",
    ]);
  });

  it("only updates the first stored query sharing an id", () => {
    const twin = { ...storedQuery, query: "SELECT 2" };
    const merged = mergeDataSourceSettingsBody(
      { queries: { exposure: [storedQuery, twin] } },
      { assignmentQueries: [{ ...shownQuery, sql: "SELECT 3" }] },
    );
    expect(merged.settings.queries?.exposure?.map((q) => q.query)).toEqual([
      "SELECT 3",
      "SELECT 2",
    ]);
  });

  it("replaces the join list and lists only joins not stored as sent", () => {
    const merged = mergeDataSourceSettingsBody(stored, {
      identifierJoinQueries: [
        { identifierTypes: ["anonymous_id", "user_id"], sql: "SELECT 1" },
        { identifierTypes: ["user_id", "device_id"], sql: "SELECT 2" },
      ],
    });
    expect(merged.changed).toBe(true);
    expect(merged.newIdentityJoins).toEqual([
      { ids: ["user_id", "device_id"], query: "SELECT 2" },
    ]);
    expect(
      mergeDataSourceSettingsBody(stored, { identifierJoinQueries: [] })
        .settings.queries?.identityJoins,
    ).toEqual([]);
  });
});

describe("testDataSourceSettingsQueries", () => {
  const datasource = { type: "postgres" as const, settings: {} };
  const query: ExposureQuery = { ...storedQuery, error: undefined };
  const join = { ids: ["anonymous_id", "user_id"], query: "SELECT 1" };

  function mockIntegration(
    runTestQuery: jest.Mock,
    getTestValidityQuery: jest.Mock = jest.fn((sql: string) => sql),
  ) {
    return {
      columnNamesAreCaseSensitive: false,
      getTestValidityQuery,
      runTestQuery,
    } as unknown as SourceIntegrationInterface;
  }

  it("passes when every query returns its required columns", async () => {
    const runTestQuery = jest
      .fn()
      .mockResolvedValueOnce({
        results: [],
        columns: [
          { name: "experiment_id" },
          { name: "variation_id" },
          { name: "timestamp" },
          { name: "anonymous_id" },
        ],
      })
      .mockResolvedValueOnce({
        results: [],
        columns: [{ name: "anonymous_id" }, { name: "user_id" }],
      });
    const getTestValidityQuery = jest.fn((sql: string) => sql);
    expect(
      await testDataSourceSettingsQueries(
        mockIntegration(runTestQuery, getTestValidityQuery),
        datasource,
        { exposureQueries: [query], identityJoins: [join], testDays: 7 },
      ),
    ).toBe(null);
    expect(runTestQuery).toHaveBeenCalledTimes(2);
    expect(getTestValidityQuery).toHaveBeenCalledWith(
      query.query,
      7,
      undefined,
      "timestamp",
    );
  });

  it("names each failing query", async () => {
    const runTestQuery = jest
      .fn()
      .mockRejectedValueOnce(new Error("relation does not exist"))
      .mockResolvedValueOnce({
        results: [],
        columns: [{ name: "anonymous_id" }],
      });
    expect(
      await testDataSourceSettingsQueries(
        mockIntegration(runTestQuery),
        datasource,
        { exposureQueries: [query], identityJoins: [join] },
      ),
    ).toBe(
      [
        "Nothing was saved because these queries failed their test.",
        'Assignment query "eq_a": relation does not exist',
        "Identifier join query for anonymous_id, user_id: Missing required columns in response: user_id",
      ].join("\n"),
    );
  });

  it("checks every template before running any query", async () => {
    const runTestQuery = jest.fn();
    const getTestValidityQuery = jest.fn(() => {
      throw new Error("Unknown variable: foo");
    });
    expect(
      await testDataSourceSettingsQueries(
        mockIntegration(runTestQuery, getTestValidityQuery),
        datasource,
        { exposureQueries: [query], identityJoins: [] },
      ),
    ).toBe(
      "Nothing was saved because these queries failed their test.\n" +
        'Assignment query "eq_a": Unknown variable: foo',
    );
    expect(runTestQuery).not.toHaveBeenCalled();
  });

  it("skips data sources that can't run test queries", async () => {
    expect(
      await testDataSourceSettingsQueries(
        {} as SourceIntegrationInterface,
        datasource,
        { exposureQueries: [query], identityJoins: [join] },
      ),
    ).toBe(null);
  });
});
