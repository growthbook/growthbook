import {
  assertExposureQueryDeclaresIdentifierType,
  getExposureQueryIdentifierTypes,
  parseAssignmentQueryInput,
  resolveAnalysisIdentifierType,
  toApiAssignmentQueryRef,
  resolveExposureQueryForAnalysis,
  parseAssignmentQuerySelection,
  isSameAssignmentQuerySelection,
  flattenExposureQueryInput,
  getIdentifierTypeForSettingsHash,
  getPreferredIdentifierType,
  withKeptIdentifierType,
  resolveAssignmentQuerySelectionChange,
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

  it("rejects both fields when they name different queries", () => {
    expect(() =>
      parseAssignmentQueryInput(
        { id: "exq_1", identifierType: "user_id" },
        "exq_2",
        "exposureQuery",
      ),
    ).toThrow(
      "exposureQuery.id and the deprecated exposureQueryId name different assignment queries",
    );
  });
});

describe("resolveAnalysisIdentifierType", () => {
  const multi = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["anonymous_id", "user_id"],
  });

  it("uses the stored identifier, even when the query no longer declares it", () => {
    expect(resolveAnalysisIdentifierType(multi, "user_id")).toBe("user_id");
    expect(resolveAnalysisIdentifierType(multi, "company_id")).toBe(
      "company_id",
    );
  });

  it("falls back to the query's legacy identifier when none is stored", () => {
    expect(resolveAnalysisIdentifierType(multi, undefined)).toBe(
      "anonymous_id",
    );
  });

  it("keeps the legacy identifier after the query's identifiers are reordered", () => {
    const reordered = query({
      id: "eq_1",
      userIdType: "anonymous_id",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(resolveAnalysisIdentifierType(reordered, undefined)).toBe(
      "anonymous_id",
    );
  });

  it("uses the first identifier for a query without a legacy one", () => {
    const noLegacy = query({
      id: "eq_1",
      userIdType: "",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    expect(resolveAnalysisIdentifierType(noLegacy, undefined)).toBe("user_id");
  });

  it("is undefined with neither a stored identifier nor a query", () => {
    expect(resolveAnalysisIdentifierType(undefined, undefined)).toBeUndefined();
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

  it("has a null identifier without a query id or a resolvable identifier", () => {
    expect(toApiAssignmentQueryRef("", "user_id", [multi])).toEqual({
      id: "",
      identifierType: null,
    });
    expect(toApiAssignmentQueryRef("eq_gone", undefined, [multi])).toEqual({
      id: "eq_gone",
      identifierType: null,
    });
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

  it("leaves an omitted identifier implicit while the query declares its legacy one", () => {
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_multi",
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, query: multi });
  });

  it("rejects an omitted identifier once the query drops its legacy one", () => {
    const dropped = query({
      id: "eq_dropped",
      name: "Dropped",
      userIdType: "user_id",
      userIdTypes: ["anonymous_id", "company_id"],
    });
    expect(
      parseAssignmentQuerySelection([dropped], {
        exposureQueryId: "eq_dropped",
        onOmitted: "defaultToFirst",
        field: "assignmentQuery",
      }),
    ).toEqual({
      ok: false,
      error:
        'Assignment query "Dropped" no longer declares its default identifier type "user_id". Set assignmentQuery.identifierType to choose one.',
    });
  });

  it("names the choices over the dropped legacy identifier when omission is ambiguous", () => {
    const dropped = query({
      id: "eq_dropped",
      name: "Dropped",
      userIdType: "user_id",
      userIdTypes: ["anonymous_id", "company_id"],
    });
    const droppedSingle = query({
      id: "eq_dropped_single",
      name: "Dropped single",
      userIdType: "user_id",
      userIdTypes: ["anonymous_id"],
    });
    const parse = (exposureQueryId: string) =>
      parseAssignmentQuerySelection([dropped, droppedSingle], {
        exposureQueryId,
        onOmitted: "requireUnambiguous",
      });
    expect(parse("eq_dropped")).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        "declares several identifier types (anonymous_id, company_id)",
      ),
    });
    expect(parse("eq_dropped_single")).toMatchObject({
      ok: false,
      error: expect.stringContaining(
        'no longer declares its default identifier type "user_id"',
      ),
    });
  });

  it("leaves a query with no legacy identifier implicit, as analysis falls back to its first", () => {
    const unfrozen = query({
      id: "eq_unfrozen",
      userIdType: "",
      userIdTypes: ["anonymous_id", "user_id"],
    });
    expect(
      parseAssignmentQuerySelection([unfrozen], {
        exposureQueryId: "eq_unfrozen",
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, query: unfrozen });
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
    expect(
      parseAssignmentQuerySelection(queries, {
        exposureQueryId: "eq_single",
        onOmitted: "requireUnambiguous",
      }),
    ).toEqual({ ok: true, identifierType: undefined, query: single });
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
  /** Reordered after records were saved: the legacy one is no longer first. */
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

describe("withKeptIdentifierType", () => {
  const previous = {
    datasource: "ds_1",
    exposureQueryId: "eq_1",
    identifierType: "user_id",
  };

  it("keeps the stored identifier for the same query", () => {
    expect(
      withKeptIdentifierType(previous, {
        datasource: "ds_1",
        exposureQueryId: "eq_1",
      }).identifierType,
    ).toBe("user_id");
  });

  it("prefers a given identifier", () => {
    expect(
      withKeptIdentifierType(previous, {
        ...previous,
        identifierType: "anonymous_id",
      }).identifierType,
    ).toBe("anonymous_id");
  });

  it("drops it for a different query or data source", () => {
    expect(
      withKeptIdentifierType(previous, {
        datasource: "ds_1",
        exposureQueryId: "eq_2",
      }).identifierType,
    ).toBeUndefined();
    expect(
      withKeptIdentifierType(previous, {
        datasource: "ds_2",
        exposureQueryId: "eq_1",
      }).identifierType,
    ).toBeUndefined();
  });

  it("treats an empty identifier as omitted", () => {
    expect(
      withKeptIdentifierType(previous, { ...previous, identifierType: "" })
        .identifierType,
    ).toBe("user_id");
  });
});

describe("resolveAssignmentQuerySelectionChange", () => {
  const multi = query({
    id: "eq_1",
    name: "Multi",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });
  const legacy = { datasource: "ds_1", exposureQueryId: "eq_1" };

  it("leaves an unchanged selection unvalidated, even if it drifted", () => {
    const drifted = { ...legacy, identifierType: "company_id" };
    expect(
      resolveAssignmentQuerySelectionChange([multi], {
        previous: drifted,
        next: legacy,
        onOmitted: "requireUnambiguous",
      }),
    ).toEqual({ ok: true, identifierType: "company_id", changed: false });
  });

  it("keeps a legacy record implicit when an update echoes its resolved identifier", () => {
    expect(
      resolveAssignmentQuerySelectionChange([multi], {
        previous: legacy,
        next: { ...legacy, identifierType: "anonymous_id" },
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, changed: false });
  });

  it("keeps an explicit identifier the update echoes or omits", () => {
    const pinned = { ...legacy, identifierType: "anonymous_id" };
    for (const next of [pinned, legacy]) {
      expect(
        resolveAssignmentQuerySelectionChange([multi], {
          previous: pinned,
          next,
          onOmitted: "requireUnambiguous",
        }),
      ).toEqual({ ok: true, identifierType: "anonymous_id", changed: false });
    }
  });

  it("leaves a new selection implicit when the query declares its legacy identifier", () => {
    expect(
      resolveAssignmentQuerySelectionChange([multi], {
        previous: null,
        next: legacy,
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, changed: true });
  });

  it("drops the old query's identifier when switching to an implicit one", () => {
    const other = query({
      id: "eq_2",
      userIdType: "user_id",
      userIdTypes: ["user_id"],
    });
    expect(
      resolveAssignmentQuerySelectionChange([multi, other], {
        previous: { ...legacy, identifierType: "anonymous_id" },
        next: { datasource: "ds_1", exposureQueryId: "eq_2" },
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, changed: true });
  });

  it("rejects moving to a query that dropped its legacy identifier, but not staying on one", () => {
    const dropped = query({
      id: "eq_2",
      userIdType: "user_id",
      userIdTypes: ["anonymous_id"],
    });
    const onDropped = { datasource: "ds_1", exposureQueryId: "eq_2" };
    expect(
      resolveAssignmentQuerySelectionChange([multi, dropped], {
        previous: legacy,
        next: onDropped,
        onOmitted: "defaultToFirst",
      }),
    ).toMatchObject({ ok: false });
    expect(
      resolveAssignmentQuerySelectionChange([multi, dropped], {
        previous: onDropped,
        next: onDropped,
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: undefined, changed: false });
  });

  it("parses a changed identifier and rejects an undeclared one", () => {
    expect(
      resolveAssignmentQuerySelectionChange([multi], {
        previous: legacy,
        next: { ...legacy, identifierType: "user_id" },
        onOmitted: "defaultToFirst",
      }),
    ).toEqual({ ok: true, identifierType: "user_id", changed: true });
    expect(
      resolveAssignmentQuerySelectionChange([multi], {
        previous: legacy,
        next: { ...legacy, identifierType: "device_id" },
        onOmitted: "defaultToFirst",
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("getIdentifierTypeForSettingsHash", () => {
  const reordered = query({
    id: "eq_1",
    userIdType: "anonymous_id",
    userIdTypes: ["user_id", "anonymous_id"],
  });

  it("leaves out the query's legacy identifier so older hashes still match", () => {
    expect(
      getIdentifierTypeForSettingsHash("eq_1", "anonymous_id", [reordered]),
    ).toBeUndefined();
    expect(
      getIdentifierTypeForSettingsHash("eq_1", undefined, [reordered]),
    ).toBeUndefined();
  });

  it("includes any other identifier", () => {
    expect(
      getIdentifierTypeForSettingsHash("eq_1", "user_id", [reordered]),
    ).toBe("user_id");
  });

  it("includes the identifier when the query can't be found", () => {
    expect(
      getIdentifierTypeForSettingsHash("eq_gone", "anonymous_id", []),
    ).toBe("anonymous_id");
  });
});

describe("getPreferredIdentifierType", () => {
  it("keeps the legacy identifier while the query declares it", () => {
    expect(
      getPreferredIdentifierType({
        userIdType: "anonymous_id",
        userIdTypes: ["user_id", "anonymous_id"],
      }),
    ).toBe("anonymous_id");
  });

  it("uses a declared identifier once the legacy one was removed", () => {
    expect(
      getPreferredIdentifierType({
        userIdType: "anonymous_id",
        userIdTypes: ["user_id"],
      }),
    ).toBe("user_id");
  });
});
