import {
  ColumnInterface,
  CreateColumnProps,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { ReqContext } from "back-end/types/request";
import {
  buildColumnInterface,
  mergeUpsertColumns,
  updateFactTable,
} from "../../src/models/FactTableModel";

describe("buildColumnInterface", () => {
  it("defaults display fields and hard-sets server-owned fields", () => {
    const result = buildColumnInterface({ column: "amount" });

    expect(result.name).toBe("amount");
    expect(result.description).toBe("");
    expect(result.numberFormat).toBe("");
    expect(result.deleted).toBe(false);
    expect(result.dateCreated).toBeInstanceOf(Date);
    expect(result.dateUpdated).toBeInstanceOf(Date);
  });

  it('defaults a missing datatype to "" so auto-detection can fill it', () => {
    expect(buildColumnInterface({ column: "amount" }).datatype).toBe("");
  });

  it("stores a supplied datatype verbatim", () => {
    expect(
      buildColumnInterface({ column: "amount", datatype: "number" }).datatype,
    ).toBe("number");
  });

  it("passes through user-supplied metadata and slice config unchanged", () => {
    const input: CreateColumnProps = {
      column: "country",
      name: "Country",
      description: "user country",
      numberFormat: "",
      datatype: "string",
      alwaysInlineFilter: true,
      isAutoSliceColumn: true,
      autoSlices: ["us", "ca"],
      lockedAutoSlices: ["us"],
      topValues: ["us", "ca"],
    };

    const result = buildColumnInterface(input);

    expect(result.name).toBe("Country");
    expect(result.description).toBe("user country");
    expect(result.datatype).toBe("string");
    expect(result.alwaysInlineFilter).toBe(true);
    expect(result.isAutoSliceColumn).toBe(true);
    expect(result.autoSlices).toEqual(["us", "ca"]);
    expect(result.lockedAutoSlices).toEqual(["us"]);
    expect(result.topValues).toEqual(["us", "ca"]);
  });

  it("passes through user-supplied jsonFields unchanged on a json column", () => {
    const result = buildColumnInterface({
      column: "metadata",
      datatype: "json",
      jsonFields: { nested: { datatype: "string" } },
    });

    expect(result.jsonFields).toEqual({ nested: { datatype: "string" } });
  });

  it("overrides a supplied deleted flag to false", () => {
    expect(
      buildColumnInterface({ column: "amount", deleted: true }).deleted,
    ).toBe(false);
  });
});

describe("mergeUpsertColumns", () => {
  const makeColumn = (
    overrides: Partial<ColumnInterface> & { column: string },
  ): ColumnInterface => ({
    dateCreated: new Date("2020-01-01"),
    dateUpdated: new Date("2020-01-01"),
    name: overrides.column,
    description: "",
    numberFormat: "",
    datatype: "number",
    deleted: false,
    ...overrides,
  });

  it("patches an existing column while preserving unspecified fields", () => {
    const existing = [
      makeColumn({ column: "amount", name: "Amount", datatype: "number" }),
    ];

    const { columns, removedAutoSliceColumns } = mergeUpsertColumns(existing, [
      { column: "amount", description: "revenue in cents" },
    ]);

    expect(columns).toHaveLength(1);
    expect(columns[0].description).toBe("revenue in cents");
    expect(columns[0].name).toBe("Amount");
    expect(columns[0].datatype).toBe("number");
    expect(removedAutoSliceColumns).toEqual([]);
  });

  it("inserts a new column that does not yet exist", () => {
    const { columns } = mergeUpsertColumns(
      [],
      [{ column: "country", datatype: "string" }],
    );

    expect(columns).toHaveLength(1);
    expect(columns[0].column).toBe("country");
    expect(columns[0].datatype).toBe("string");
    expect(columns[0].name).toBe("country");
    expect(columns[0].description).toBe("");
    expect(columns[0].deleted).toBe(false);
  });

  it("leaves columns omitted from the request untouched (sparse patch)", () => {
    const existing = [
      makeColumn({ column: "amount", name: "Amount" }),
      makeColumn({ column: "country", name: "Country", datatype: "string" }),
    ];

    const { columns } = mergeUpsertColumns(existing, [
      { column: "amount", description: "changed" },
    ]);

    expect(columns).toHaveLength(2);
    const country = columns.find((c) => c.column === "country");
    expect(country?.name).toBe("Country");
    expect(country?.description).toBe("");
  });

  it("preserves an existing datatype when datatype is absent", () => {
    const existing = [makeColumn({ column: "amount", datatype: "number" })];

    const { columns } = mergeUpsertColumns(existing, [
      { column: "amount", description: "no datatype key" },
    ]);

    expect(columns[0].datatype).toBe("number");
  });

  it('resets an existing datatype when datatype is ""', () => {
    const existing = [makeColumn({ column: "amount", datatype: "number" })];

    const { columns } = mergeUpsertColumns(existing, [
      { column: "amount", datatype: "" },
    ]);

    expect(columns[0].datatype).toBe("");
  });

  it("stores a new column with an empty datatype when omitted", () => {
    const { columns } = mergeUpsertColumns([], [{ column: "amount" }]);

    expect(columns[0].datatype).toBe("");
  });

  it("clears alwaysInlineFilter on a non-string column", () => {
    const existing = [makeColumn({ column: "amount", datatype: "number" })];

    const { columns } = mergeUpsertColumns(existing, [
      { column: "amount", alwaysInlineFilter: true },
    ]);

    expect(columns[0].alwaysInlineFilter).toBe(false);
  });

  it("allows alwaysInlineFilter on a string column", () => {
    const { columns } = mergeUpsertColumns(
      [],
      [{ column: "country", datatype: "string", alwaysInlineFilter: true }],
    );

    expect(columns[0].alwaysInlineFilter).toBe(true);
  });

  it("defaults autoSlices to [] when isAutoSliceColumn is enabled without values", () => {
    const { columns } = mergeUpsertColumns(
      [],
      [{ column: "country", datatype: "string", isAutoSliceColumn: true }],
    );

    expect(columns[0].autoSlices).toEqual([]);
  });

  it('normalizes boolean column autoSlices to ["true", "false"]', () => {
    const { columns } = mergeUpsertColumns(
      [],
      [
        {
          column: "flag",
          datatype: "boolean",
          isAutoSliceColumn: true,
          autoSlices: ["something"],
        },
      ],
    );

    expect(columns[0].autoSlices).toEqual(["true", "false"]);
  });

  it("reports existing columns whose auto-slicing was removed", () => {
    const existing = [
      makeColumn({
        column: "country",
        datatype: "string",
        isAutoSliceColumn: true,
        autoSlices: ["us"],
      }),
    ];

    const { removedAutoSliceColumns } = mergeUpsertColumns(existing, [
      { column: "country", isAutoSliceColumn: false },
    ]);

    expect(removedAutoSliceColumns).toEqual(["country"]);
  });

  it("reports existing columns that were marked deleted", () => {
    const existing = [makeColumn({ column: "amount" })];

    const { removedAutoSliceColumns } = mergeUpsertColumns(existing, [
      { column: "amount", deleted: true },
    ]);

    expect(removedAutoSliceColumns).toEqual(["amount"]);
  });

  it("does not mutate the input columns array", () => {
    const existing = [makeColumn({ column: "amount", name: "Amount" })];

    mergeUpsertColumns(existing, [{ column: "amount", name: "Changed" }]);

    expect(existing[0].name).toBe("Amount");
  });
});

describe("updateFactTable", () => {
  const factTable: FactTableInterface = {
    organization: "org_123",
    id: "ftb_123",
    managedBy: "api",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Fact Table",
    description: "",
    owner: "owner",
    projects: [],
    tags: [],
    datasource: "ds_123",
    userIdTypes: [],
    sql: "SELECT 1",
    eventName: "",
    columns: [],
    filters: [],
  };

  const getContext = () => {
    const canUpdateFactTable = jest.fn().mockReturnValue(false);
    const throwPermissionError = jest.fn(() => {
      throw new Error("permission denied");
    });

    const context = {
      permissions: {
        canUpdateFactTable,
        throwPermissionError,
      },
    } as unknown as ReqContext;

    return { context, canUpdateFactTable };
  };

  it("allows columns-only changes for API-managed tables", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "permission denied",
    );
    expect(canUpdateFactTable).toHaveBeenCalledWith(factTable, changes);
  });

  it("rejects columnsError (system side-effect, not user-specified)", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
      columnsError: null,
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });

  it("rejects userIdTypes (system side-effect, not user-specified)", async () => {
    const changes: UpdateFactTableProps = {
      columns: [],
      userIdTypes: ["user_id"],
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });

  it("rejects unrelated fields like name", async () => {
    const changes: UpdateFactTableProps = {
      name: "Updated Name",
    };
    const { context, canUpdateFactTable } = getContext();

    await expect(updateFactTable(context, factTable, changes)).rejects.toThrow(
      "Cannot update fact table managed by API if the request isn't from the API.",
    );
    expect(canUpdateFactTable).not.toHaveBeenCalled();
  });
});
