// Mock the same import chain dispatcher.test.ts mocks. general-agent.ts
// transitively imports the dispatcher (which imports api.router) — without
// the stub, the whole app loads and the test takes 30+ seconds.
jest.mock("back-end/src/api/api.router", () => ({
  allRoutes: [],
}));

// Stub createAgentHandler so we don't try to spin up the real handler in
// this unit test. We only care about the coerceBody helper.
jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  createAgentHandler: () => async () => undefined,
}));

import {
  _buildGeneralAgentSystemPrompt,
  _coerceBody,
  _requiresMutationConfirmation,
  _stripConfirmFromSqlBody,
} from "back-end/src/agent/general-agent";

describe("general agent system prompt", () => {
  it("translates canonical skill runtime instructions", () => {
    const prompt = _buildGeneralAgentSystemPrompt();

    expect(prompt).toContain(
      "translate every `gb-call METHOD PATH [body]` example into",
    );
    expect(prompt).toContain("Never run shell commands");
    expect(prompt).toMatch(
      /Ignore API-key, host,\s+`gb-setup`, and credential instructions/,
    );
  });
});

describe("coerceBody (callApi defensive parsing)", () => {
  it("returns objects unchanged", () => {
    const obj = { type: "metric", values: [{ name: "x" }] };
    expect(_coerceBody(obj)).toBe(obj);
  });

  it("returns arrays unchanged", () => {
    const arr = [1, 2, 3];
    expect(_coerceBody(arr)).toBe(arr);
  });

  it("returns undefined and null unchanged", () => {
    expect(_coerceBody(undefined)).toBeUndefined();
    expect(_coerceBody(null)).toBeNull();
  });

  it("parses a JSON-encoded object string into an object", () => {
    const payload = JSON.stringify({ type: "metric", chartType: "line" });
    expect(_coerceBody(payload)).toEqual({ type: "metric", chartType: "line" });
  });

  it("parses a JSON-encoded array string into an array", () => {
    const payload = JSON.stringify([{ a: 1 }, { a: 2 }]);
    expect(_coerceBody(payload)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("parses through leading/trailing whitespace and newlines", () => {
    const payload = `\n  ${JSON.stringify({ x: 1 })}\n`;
    expect(_coerceBody(payload)).toEqual({ x: 1 });
  });

  it("leaves a non-JSON string alone", () => {
    expect(_coerceBody("hello world")).toBe("hello world");
  });

  it("leaves a malformed JSON-looking string alone (handler will reject)", () => {
    const malformed = '{"type": "metric"';
    expect(_coerceBody(malformed)).toBe(malformed);
  });

  it("does not parse plain numeric or boolean strings", () => {
    // These start with neither { nor [, so coerceBody should leave them as-is.
    expect(_coerceBody("42")).toBe("42");
    expect(_coerceBody("true")).toBe("true");
  });
});

describe("requiresMutationConfirmation (deterministic mutation gate)", () => {
  it("never gates GET requests", () => {
    expect(
      _requiresMutationConfirmation({
        method: "GET",
        path: "/api/v1/features",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "GET",
        path: "/api/v2/features/eval-cycle-flag",
      }),
    ).toBe(false);
  });

  it("gates feature flag mutations", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v2/features",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "DELETE",
        path: "/api/v2/features/eval-cycle-flag",
      }),
    ).toBe(true);
  });

  it("gates experiment mutations", () => {
    expect(
      _requiresMutationConfirmation({
        method: "PATCH",
        path: "/api/v1/experiments/exp_123",
      }),
    ).toBe(true);
  });

  it("gates mutations to other resource types (metrics, projects, saved groups)", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/metrics",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "DELETE",
        path: "/api/v1/projects/prj_1",
      }),
    ).toBe(true);
    expect(
      _requiresMutationConfirmation({
        method: "PUT",
        path: "/api/v1/saved-groups/grp_1",
      }),
    ).toBe(true);
  });

  it("allows experiment snapshot refreshes without confirmation", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/experiments/exp_123/snapshot",
      }),
    ).toBe(false);
  });

  it("allows product analytics exploration POSTs without confirmation", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/metric-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/fact-table-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/data-source-exploration",
      }),
    ).toBe(false);
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/product-analytics/funnel-exploration",
      }),
    ).toBe(false);
  });

  it("ignores query strings when matching the allowlist", () => {
    expect(
      _requiresMutationConfirmation({
        method: "POST",
        path: "/api/v1/experiments/exp_123/snapshot?force=true",
      }),
    ).toBe(false);
  });

  it("allows SQL query endpoints without mutation confirmation", () => {
    const sqlPaths = [
      "/api/v1/data-sources/ds_123/sql/run-query",
      "/api/v1/data-sources/ds_123/sql/preview-values",
      "/api/v1/data-sources/ds_123/sql/search-tables",
      "/api/v1/data-sources/ds_123/sql/table-schema",
    ];
    for (const path of sqlPaths) {
      expect(_requiresMutationConfirmation({ method: "POST", path })).toBe(
        false,
      );
    }
  });
});

describe("stripConfirmFromSqlBody (cost confirmation bypass prevention)", () => {
  it("strips confirm from SQL run-query bodies", () => {
    const result = _stripConfirmFromSqlBody(
      "/api/v1/data-sources/ds_123/sql/run-query",
      { sql: "SELECT 1", purpose: "test", confirm: true },
    );
    expect(result).toEqual({ sql: "SELECT 1", purpose: "test" });
    expect(result).not.toHaveProperty("confirm");
  });

  it("strips confirm from other SQL endpoint bodies", () => {
    const result = _stripConfirmFromSqlBody(
      "/api/v1/data-sources/ds_123/sql/preview-values",
      { table: "t", columns: ["c"], confirm: true },
    );
    expect(result).not.toHaveProperty("confirm");
  });

  it("does not strip confirm from non-SQL paths", () => {
    const body = { name: "test", confirm: true };
    expect(_stripConfirmFromSqlBody("/api/v1/features", body)).toBe(body);
  });

  it("passes through non-object bodies unchanged", () => {
    expect(
      _stripConfirmFromSqlBody(
        "/api/v1/data-sources/ds_123/sql/run-query",
        "string body",
      ),
    ).toBe("string body");
  });

  it("returns null/undefined unchanged", () => {
    expect(
      _stripConfirmFromSqlBody(
        "/api/v1/data-sources/ds_123/sql/run-query",
        null,
      ),
    ).toBeNull();
    expect(
      _stripConfirmFromSqlBody(
        "/api/v1/data-sources/ds_123/sql/run-query",
        undefined,
      ),
    ).toBeUndefined();
  });

  it("passes through bodies without confirm unchanged", () => {
    const body = { sql: "SELECT 1", purpose: "test" };
    expect(
      _stripConfirmFromSqlBody(
        "/api/v1/data-sources/ds_123/sql/run-query",
        body,
      ),
    ).toBe(body);
  });
});
