import {
  assertAssignmentQueryRefIdentifierType,
  assertExposureQueryDeclaresIdentifierType,
  getExposureQueryIdentifierTypes,
  parseAssignmentQueryInput,
  getAnalysisIdentifierType,
  assertValidAssignmentQuerySelection,
  hasAssignmentQuerySelectionChanged,
  toApiAssignmentQueryRef,
  resolveExposureQueryForAnalysis,
  parseAssignmentQuerySelection,
  isSameAssignmentQuerySelection,
  flattenExposureQueryInput,
} from "shared/util";
import { ExposureQuery } from "shared/types/datasource";

function query(
  partial: Partial<ExposureQuery> &
    Pick<ExposureQuery, "id" | "userIdType" | "userIdTypes">,
): ExposureQuery {
  return {
    name: partial.id,
    query: "SELECT 1",
    dimensions: [],
    ...partial,
  };
}

describe("assertExposureQueryDeclaresIdentifierType", () => {
  const multi = query({
    id: "exq_multi",
    name: "Multi",
    userIdType: "user_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });

  it("allows any declared identifier, including a secondary one", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, "anonymous_id"),
    ).not.toThrow();
  });

  it("allows a missing identifier type", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, undefined),
    ).not.toThrow();
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, ""),
    ).not.toThrow();
  });

  it("throws for a legacy record whose legacy identifier was removed", () => {
    const removed = query({
      id: "exq_multi",
      name: "Multi",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id"],
    });
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(removed, undefined),
    ).toThrow(
      'Assignment query "Multi" no longer declares the "anonymous_id" identifier type',
    );
  });

  it("throws for an identifier the query does not declare", () => {
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(multi, "device_id"),
    ).toThrow(
      'Assignment query "Multi" no longer declares the "device_id" identifier type. Choose an assignment query that declares it',
    );
  });

  it("falls back to the legacy scalar when userIdTypes is empty", () => {
    const legacy = query({
      id: "exq_legacy",
      userIdType: "user_id",
      userIdTypes: [],
    });
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(legacy, "user_id"),
    ).not.toThrow();
    expect(() =>
      assertExposureQueryDeclaresIdentifierType(legacy, "anonymous_id"),
    ).toThrow();
  });
});

describe("getExposureQueryIdentifierTypes", () => {
  it("returns the declared identifier types", () => {
    expect(
      getExposureQueryIdentifierTypes({
        userIdType: "user_id",
        userIdTypes: ["user_id", "anonymous_id"],
      }),
    ).toEqual(["user_id", "anonymous_id"]);
  });

  it("falls back to the legacy scalar", () => {
    expect(
      getExposureQueryIdentifierTypes({
        userIdType: "user_id",
        userIdTypes: [],
      }),
    ).toEqual(["user_id"]);
  });

  it("returns nothing when neither is set", () => {
    expect(
      getExposureQueryIdentifierTypes({ userIdType: "", userIdTypes: [] }),
    ).toEqual([]);
  });
});

describe("parseAssignmentQueryInput", () => {
  it("reads the id and identifier type from the grouped field", () => {
    expect(
      parseAssignmentQueryInput(
        { id: "exq_1", identifierType: "anonymous_id" },
        undefined,
        "assignmentQuery",
      ),
    ).toEqual({ id: "exq_1", identifierType: "anonymous_id" });
  });

  it("falls back to the deprecated id with no identifier type", () => {
    expect(
      parseAssignmentQueryInput(undefined, "exq_1", "exposureQuery"),
    ).toEqual({ id: "exq_1", identifierType: undefined });
  });

  it("returns nothing when neither is set", () => {
    expect(
      parseAssignmentQueryInput(undefined, undefined, "assignmentQuery"),
    ).toEqual({ id: undefined, identifierType: undefined });
  });

  it("rejects both fields together, naming them", () => {
    expect(() =>
      parseAssignmentQueryInput(
        { id: "exq_1", identifierType: "user_id" },
        "exq_2",
        "exposureQuery",
      ),
    ).toThrow(
      "Cannot set exposureQuery together with the deprecated exposureQueryId",
    );
  });
});

describe("assertAssignmentQueryRefIdentifierType", () => {
  const single = query({
    id: "exq_single",
    userIdType: "user_id",
    userIdTypes: ["user_id"],
  });
  const multi = query({
    id: "exq_multi",
    name: "Main",
    userIdType: "user_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });
  const check =
    (
      ref: { id: string; identifierType?: string } | undefined,
      currentExposureQueryId?: string,
    ) =>
    () =>
      assertAssignmentQueryRefIdentifierType({
        ref,
        field: "assignmentQuery",
        exposureQueries: [single, multi],
        currentExposureQueryId,
      });

  it("allows omitting it for a query with one identifier type", () => {
    expect(check({ id: "exq_single" })).not.toThrow();
  });

  it("rejects omitting it for a new query with several, naming them", () => {
    expect(check({ id: "exq_multi" }, "exq_single")).toThrow(
      'Assignment query "Main" declares several identifier types (user_id, anonymous_id). Set assignmentQuery.identifierType to choose one.',
    );
  });

  it("allows omitting it when keeping the current query", () => {
    expect(check({ id: "exq_multi" }, "exq_multi")).not.toThrow();
  });

  it("allows an explicit identifier type", () => {
    expect(
      check({ id: "exq_multi", identifierType: "anonymous_id" }),
    ).not.toThrow();
  });

  it("ignores a missing ref or unknown query", () => {
    expect(check(undefined)).not.toThrow();
    expect(check({ id: "exq_missing" })).not.toThrow();
  });
});

describe("getAnalysisIdentifierType", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });

  it("uses the stored identifier, even when the query no longer declares it", () => {
    expect(getAnalysisIdentifierType(multi, "user_id")).toBe("user_id");
    expect(getAnalysisIdentifierType(multi, "company_id")).toBe("company_id");
  });

  it("falls back to the query's legacy identifier when none is stored", () => {
    expect(getAnalysisIdentifierType(multi, undefined)).toBe("anonymous_id");
  });

  it("keeps the legacy identifier after the query's identifiers are reordered", () => {
    const reordered = query({
      id: "eq_1",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(getAnalysisIdentifierType(reordered, undefined)).toBe(
      "anonymous_id",
    );
  });

  it("uses the first identifier for a query without a legacy one", () => {
    const noLegacy = query({
      id: "eq_1",
      userIdType: "",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(getAnalysisIdentifierType(noLegacy, undefined)).toBe("user_id");
  });

  it("is undefined with neither a stored identifier nor a query", () => {
    expect(getAnalysisIdentifierType(undefined, undefined)).toBeUndefined();
  });
});

describe("assertValidAssignmentQuerySelection", () => {
  const exposureQueries = [
    query({
      id: "eq_multi",
      userIdType: "anonymous_id",
      userIdTypes: ["anonymous_id", "user_id"],
    }),
  ];

  it("returns the query for a valid selection", () => {
    expect(
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_multi",
        identifierType: "user_id",
      }).id,
    ).toBe("eq_multi");
  });

  it("rejects an unknown query", () => {
    expect(() =>
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_missing",
      }),
    ).toThrow('Assignment query "eq_missing" doesn\'t exist');
  });

  it("rejects an identifier the query does not declare", () => {
    expect(() =>
      assertValidAssignmentQuerySelection({
        exposureQueries,
        exposureQueryId: "eq_multi",
        identifierType: "company_id",
      }),
    ).toThrow('doesn\'t declare the "company_id" identifier type');
  });
});

describe("hasAssignmentQuerySelectionChanged", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });
  const legacy = { datasource: "ds_1", exposureQueryId: "eq_1" };

  it("treats echoing a legacy record's resolved identifier as unchanged", async () => {
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "anonymous_id" },
        async () => [multi],
      ),
    ).resolves.toBe(false);
  });

  it("detects a real identifier change", async () => {
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "user_id" },
        async () => [multi],
      ),
    ).resolves.toBe(true);
  });

  it("compares a legacy record against the legacy identifier, not the first", async () => {
    const reordered = query({
      id: "eq_1",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "anonymous_id" },
        async () => [reordered],
      ),
    ).resolves.toBe(false);
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, identifierType: "user_id" },
        async () => [reordered],
      ),
    ).resolves.toBe(true);
  });

  it("detects a query change without loading queries", async () => {
    const load = jest.fn(async () => [multi]);
    await expect(
      hasAssignmentQuerySelectionChanged(
        legacy,
        { ...legacy, exposureQueryId: "eq_2" },
        load,
      ),
    ).resolves.toBe(true);
    expect(load).not.toHaveBeenCalled();
  });
});

describe("toApiAssignmentQueryRef", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });

  it("resolves a legacy record to its query's legacy identifier", () => {
    expect(toApiAssignmentQueryRef("eq_1", undefined, [multi])).toEqual({
      id: "eq_1",
      identifierType: "anonymous_id",
    });
    const reordered = query({
      id: "eq_1",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(toApiAssignmentQueryRef("eq_1", undefined, [reordered])).toEqual({
      id: "eq_1",
      identifierType: "anonymous_id",
    });
  });

  it("reports the stored identifier as is, even if no longer declared", () => {
    expect(toApiAssignmentQueryRef("eq_1", "company_id", [multi])).toEqual({
      id: "eq_1",
      identifierType: "company_id",
    });
  });

  it("is undefined without a query id or a resolvable identifier", () => {
    expect(toApiAssignmentQueryRef("", "user_id", [multi])).toBeUndefined();
    expect(
      toApiAssignmentQueryRef("eq_gone", undefined, [multi]),
    ).toBeUndefined();
  });
});

describe("flattenExposureQueryInput", () => {
  it("maps the grouped object onto the flat fields and keeps the rest", () => {
    expect(
      flattenExposureQueryInput({
        exposureQuery: { id: "eq_1", identifierType: "user_id" },
        datasourceId: "ds_1",
      }),
    ).toEqual({
      exposureQueryId: "eq_1",
      exposureQueryIdentifierType: "user_id",
      datasourceId: "ds_1",
    });
  });

  it("leaves a partial body without either field untouched", () => {
    const flat = flattenExposureQueryInput({ name: "renamed" } as {
      name: string;
      exposureQueryId?: string;
    });
    expect(flat).toEqual({ name: "renamed" });
    expect(flat).not.toHaveProperty("exposureQueryId");
  });

  it("rejects the grouped object together with the deprecated id", () => {
    expect(() =>
      flattenExposureQueryInput({
        exposureQuery: { id: "eq_1", identifierType: "user_id" },
        exposureQueryId: "eq_1",
      }),
    ).toThrow("Cannot set exposureQuery together with the deprecated");
  });
});

describe("resolveExposureQueryForAnalysis", () => {
  const multi = query({
    id: "eq_1",
    name: "Multi",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
    query: "SELECT user_id, anonymous_id",
  });

  it("pairs the SQL with the stored identifier", () => {
    expect(resolveExposureQueryForAnalysis(multi, "user_id")).toEqual({
      query: "SELECT user_id, anonymous_id",
      identifierType: "user_id",
    });
  });

  it("resolves a legacy record to the legacy identifier, not the first", () => {
    expect(
      resolveExposureQueryForAnalysis(multi, undefined).identifierType,
    ).toBe("anonymous_id");
  });

  it("refuses an identifier the query no longer declares", () => {
    expect(() => resolveExposureQueryForAnalysis(multi, "company_id")).toThrow(
      'no longer declares the "company_id" identifier type',
    );
  });
});

describe("parseAssignmentQuerySelection", () => {
  const multi = query({
    id: "eq_multi",
    name: "Multi",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });
  const single = query({
    id: "eq_single",
    name: "Single",
    userIdType: "user_id",
    userIdTypes: ["user_id"],
  });
  const queries = [multi, single];

  it("returns a declared identifier with its query", () => {
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_multi",
        identifierType: "anonymous_id",
        onOmitted: "requireUnambiguous",
      }),
    ).toEqual({ ok: true, identifierType: "anonymous_id", query: multi });
  });

  it("rejects an unknown query", () => {
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_missing",
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({
      ok: false,
      error: 'Assignment query "eq_missing" doesn\'t exist on this data source',
    });
  });

  it("rejects an identifier the query doesn't declare", () => {
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_multi",
        identifierType: "company_id",
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({
      ok: false,
      error:
        'Assignment query "Multi" doesn\'t declare the "company_id" identifier type',
    });
  });

  it("defaults an omitted identifier to the query's first, not its legacy one", () => {
    const parsed = parseAssignmentQuerySelection(queries, {
      exposureQueryId: "eq_multi",
      onOmitted: "defaultToFirst",
    });
    expect(parsed.ok && parsed.identifierType).toBe("user_id");
  });

  it("requires an identifier when the query declares several", () => {
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_multi",
        onOmitted: "requireUnambiguous",
        field: "assignmentQuery",
      }),
    ).toEqual({
      ok: false,
      error:
        'Assignment query "Multi" declares several identifier types (user_id, anonymous_id). Set assignmentQuery.identifierType to choose one.',
    });
  });

  it("allows omitting the identifier when the query declares one", () => {
    const parsed = parseAssignmentQuerySelection(queries, {
      exposureQueryId: "eq_single",
      onOmitted: "requireUnambiguous",
    });
    expect(parsed.ok && parsed.identifierType).toBe("user_id");
  });

  it("rejects a query that declares no identifiers", () => {
    const empty = query({ id: "eq_empty", userIdType: "", userIdTypes: [] });
    expect(
      parseAssignmentQuerySelection([empty], {
        exposureQueryId: "eq_empty",
        onOmitted: "defaultToFirst",
      }).ok,
    ).toBe(false);
  });
});

describe("isSameAssignmentQuerySelection", () => {
  // Reordered after records were saved: the legacy identifier is no longer first.
  const reordered = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });
  const legacy = { datasource: "ds_1", exposureQueryId: "eq_1" };

  it("treats an unset identifier as the legacy one, not the first", () => {
    expect(
      isSameAssignmentQuerySelection(
        legacy,
        { ...legacy, identifierType: "anonymous_id" },
        [reordered],
      ),
    ).toBe(true);
    expect(
      isSameAssignmentQuerySelection(
        legacy,
        { ...legacy, identifierType: "user_id" },
        [reordered],
      ),
    ).toBe(false);
  });

  it("differs when the query or data source does", () => {
    expect(
      isSameAssignmentQuerySelection(
        legacy,
        { ...legacy, exposureQueryId: "eq_2" },
        [reordered],
      ),
    ).toBe(false);
    expect(
      isSameAssignmentQuerySelection(
        legacy,
        { ...legacy, datasource: "ds_2" },
        [reordered],
      ),
    ).toBe(false);
  });

  it("only matches identical raw identifiers without the query", () => {
    expect(isSameAssignmentQuerySelection(legacy, { ...legacy }, [])).toBe(
      true,
    );
    expect(
      isSameAssignmentQuerySelection(
        legacy,
        { ...legacy, identifierType: "anonymous_id" },
        [],
      ),
    ).toBe(false);
  });
});
