import type { MaterializedColumn } from "shared/types/datasource";
import type { SDKAttribute } from "shared/types/organization";
import { dangerouslyGetGrowthbookDatasourceBypassPermission } from "back-end/src/models/DataSourceModel";
import {
  dangerouslyGetFactTableByIdBypassPermission,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  prepareManagedWarehouseAttributeMigrationViaLicenseServer,
  syncManagedWarehouseAttributesViaLicenseServer,
} from "back-end/src/services/licenseServerManagedClickhouse";
import {
  assertRegisteredAttributes,
  diffMaterializedColumnsForFactTable,
  updateAttributeSchema,
} from "back-end/src/services/attributes";
import { BadRequestError } from "back-end/src/util/errors";
import type { ReqContext } from "back-end/types/request";

jest.mock("back-end/src/models/DataSourceModel", () => ({
  dangerouslyGetGrowthbookDatasourceBypassPermission: jest.fn(),
}));

jest.mock("back-end/src/models/FactTableModel", () => ({
  dangerouslyGetFactTableByIdBypassPermission: jest.fn(),
  updateFactTableColumns: jest.fn(),
}));

jest.mock("back-end/src/models/OrganizationModel", () => ({
  updateOrganization: jest.fn(),
}));

jest.mock("back-end/src/services/licenseServerManagedClickhouse", () => ({
  prepareManagedWarehouseAttributeMigrationViaLicenseServer: jest.fn(),
  syncManagedWarehouseAttributesViaLicenseServer: jest.fn(),
}));

const col = (
  name: string,
  overrides: Partial<MaterializedColumn> = {},
): MaterializedColumn => ({
  columnName: name,
  sourceField: name,
  datatype: "string",
  type: "dimension",
  ...overrides,
});

const attr = (
  overrides: Partial<SDKAttribute> &
    Pick<SDKAttribute, "property" | "datatype">,
): SDKAttribute => ({
  ...overrides,
});

const mockDangerouslyGetDatasource =
  dangerouslyGetGrowthbookDatasourceBypassPermission as jest.MockedFunction<
    typeof dangerouslyGetGrowthbookDatasourceBypassPermission
  >;
const mockDangerouslyGetFactTable =
  dangerouslyGetFactTableByIdBypassPermission as jest.MockedFunction<
    typeof dangerouslyGetFactTableByIdBypassPermission
  >;
const mockUpdateFactTableColumns =
  updateFactTableColumns as jest.MockedFunction<typeof updateFactTableColumns>;
const mockUpdateOrganization = updateOrganization as jest.MockedFunction<
  typeof updateOrganization
>;
const mockPrepareMigration =
  prepareManagedWarehouseAttributeMigrationViaLicenseServer as jest.MockedFunction<
    typeof prepareManagedWarehouseAttributeMigrationViaLicenseServer
  >;
const mockSyncAttributes =
  syncManagedWarehouseAttributesViaLicenseServer as jest.MockedFunction<
    typeof syncManagedWarehouseAttributesViaLicenseServer
  >;

afterEach(() => {
  jest.clearAllMocks();
});

describe("diffMaterializedColumnsForFactTable", () => {
  it("returns empty diff when previous and final are identical", () => {
    const cols = [col("a"), col("b")];
    expect(diffMaterializedColumnsForFactTable(cols, cols, [])).toEqual({
      columnsToAdd: [],
      columnsToDelete: [],
      columnsToRename: [],
    });
  });

  it("emits adds for columns only in final", () => {
    const { columnsToAdd, columnsToDelete, columnsToRename } =
      diffMaterializedColumnsForFactTable([col("a")], [col("a"), col("b")], []);
    expect(columnsToAdd).toEqual([col("b")]);
    expect(columnsToDelete).toEqual([]);
    expect(columnsToRename).toEqual([]);
  });

  it("emits deletes for columns only in previous", () => {
    const { columnsToAdd, columnsToDelete, columnsToRename } =
      diffMaterializedColumnsForFactTable([col("a"), col("b")], [col("a")], []);
    expect(columnsToAdd).toEqual([]);
    expect(columnsToDelete).toEqual(["b"]);
    expect(columnsToRename).toEqual([]);
  });

  it("applies a rename when from exists in previous and to exists in final", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("user_id")],
      [col("deviceId"), col("user_id")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([
      { from: "device_id", to: "deviceId" },
    ]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("falls through to add/delete when rename source isn't in previous", () => {
    // Source column doesn't exist — treat as a plain add of `deviceId`.
    const diff = diffMaterializedColumnsForFactTable(
      [col("user_id")],
      [col("user_id"), col("deviceId")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([col("deviceId")]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("falls through to add/delete when rename dest isn't in final", () => {
    // Dest dropped from final — treat as plain delete of `device_id`.
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("user_id")],
      [col("user_id")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual(["device_id"]);
  });

  it("skips a rename whose destination collides with an existing previous column", () => {
    // Both `device_id` and `deviceId` already exist in previous; renaming one
    // onto the other would clobber the existing column. Should fall through.
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("deviceId")],
      [col("deviceId")],
      [{ from: "device_id", to: "deviceId" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToDelete).toEqual(["device_id"]);
    expect(diff.columnsToAdd).toEqual([]);
  });

  it("ignores no-op self-renames", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("a")],
      [col("a")],
      [{ from: "a", to: "a" }],
    );
    expect(diff.columnsToRename).toEqual([]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });

  it("handles multiple renames plus an unrelated add/delete in one diff", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [col("device_id"), col("session"), col("legacy")],
      [col("deviceId"), col("sessionId"), col("brand_new")],
      [
        { from: "device_id", to: "deviceId" },
        { from: "session", to: "sessionId" },
      ],
    );
    expect(diff.columnsToRename).toEqual([
      { from: "device_id", to: "deviceId" },
      { from: "session", to: "sessionId" },
    ]);
    expect(diff.columnsToAdd).toEqual([col("brand_new")]);
    expect(diff.columnsToDelete).toEqual(["legacy"]);
  });

  it("preserves the column's datatype and arrayElementType when renaming", () => {
    const diff = diffMaterializedColumnsForFactTable(
      [
        col("tags", {
          datatype: "string",
          arrayElementType: "string",
          type: "dimension",
        }),
      ],
      [
        col("user_tags", {
          datatype: "string",
          arrayElementType: "string",
          type: "dimension",
        }),
      ],
      [{ from: "tags", to: "user_tags" }],
    );
    expect(diff.columnsToRename).toEqual([{ from: "tags", to: "user_tags" }]);
    expect(diff.columnsToAdd).toEqual([]);
    expect(diff.columnsToDelete).toEqual([]);
  });
});

describe("updateAttributeSchema", () => {
  it("plans first-time migration from the pre-edit schema and only merges returned backfill", async () => {
    const currentAttributeSchema = [
      attr({
        property: "device_id",
        datatype: "string",
        hashAttribute: true,
      }),
      attr({ property: "old_dimension", datatype: "string" }),
      attr({ property: "kept", datatype: "number" }),
    ];
    const renamedAttribute = attr({
      property: "deviceId",
      datatype: "string",
      hashAttribute: true,
    });
    const keptAttribute = currentAttributeSchema[2];
    const legacyOnlyBackfill = attr({
      property: "legacy_only",
      datatype: "boolean",
    });
    const newAttributeSchema = [renamedAttribute, keptAttribute];
    const finalAttributeSchema = [
      renamedAttribute,
      keptAttribute,
      legacyOnlyBackfill,
    ];
    const postMigrationCurrentSchema = [
      ...currentAttributeSchema,
      legacyOnlyBackfill,
    ];

    mockDangerouslyGetDatasource.mockResolvedValue({
      id: "ds1",
      type: "growthbook_clickhouse",
      settings: {
        syncedMaterializedColumns: undefined,
        materializedColumns: [],
      },
    } as Awaited<
      ReturnType<typeof dangerouslyGetGrowthbookDatasourceBypassPermission>
    >);
    mockPrepareMigration.mockResolvedValue({
      firstTimeMigration: true,
      attributeBackfill: [legacyOnlyBackfill],
    });
    mockSyncAttributes.mockResolvedValue({
      syncedMaterializedColumns: [],
      shouldRegenerateDerivedSettings: false,
      userIdTypes: [],
      exposureQueries: [],
    });
    mockDangerouslyGetFactTable.mockResolvedValue(null);

    await updateAttributeSchema(
      {
        org: {
          id: "org1",
          settings: { attributeSchema: currentAttributeSchema },
        },
      } as unknown as ReqContext,
      {
        newAttributeSchema,
        renames: [{ from: "device_id", to: "deviceId" }],
      },
    );

    expect(mockPrepareMigration).toHaveBeenCalledWith({
      orgId: "org1",
      currentAttributeSchema,
    });
    expect(mockUpdateOrganization).toHaveBeenCalledWith("org1", {
      settings: { attributeSchema: finalAttributeSchema },
    });
    expect(mockSyncAttributes).toHaveBeenCalledWith({
      orgId: "org1",
      attributeSchema: finalAttributeSchema,
      previousAttributeSchema: postMigrationCurrentSchema,
      renames: [{ from: "device_id", to: "deviceId" }],
      skipNameValidation: false,
    });
    expect(mockUpdateFactTableColumns).not.toHaveBeenCalled();
  });
});

const makeContext = (
  overrides: Partial<{
    requireRegisteredAttributes:
      | boolean
      | { isOn: boolean; requireProjectScoping: boolean };
    attributeSchema: Array<{
      property: string;
      datatype: "string";
      archived?: boolean;
    }>;
  }> = {},
): ReqContext => {
  return {
    org: {
      settings: {
        requireRegisteredAttributes:
          overrides.requireRegisteredAttributes ?? true,
        attributeSchema: overrides.attributeSchema ?? [
          { property: "userId", datatype: "string" },
          { property: "country", datatype: "string" },
          { property: "legacyId", datatype: "string", archived: true },
        ],
      },
    },
  } as unknown as ReqContext;
};

describe("assertRegisteredAttributes", () => {
  it("is a no-op when the setting is off", () => {
    const ctx = makeContext({ requireRegisteredAttributes: false });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "typo_attribute",
          condition: JSON.stringify({ another_typo: "x" }),
        },
        "rule",
      ),
    ).not.toThrow();
  });

  it("passes when all keys are registered", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "userId",
          condition: JSON.stringify({
            country: { $eq: "US" },
            $or: [{ userId: "a" }, { userId: "b" }],
          }),
        },
        "rule",
      ),
    ).not.toThrow();
  });

  it("throws for an unknown hashAttribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "accountUUID" }, "rule"),
    ).toThrow(BadRequestError);
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "accountUUID" }, "rule"),
    ).toThrow(/accountUUID/);
  });

  it("throws for an unknown fallbackAttribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", fallbackAttribute: "device_UUID" },
        "experiment",
      ),
    ).toThrow(/device_UUID/);
  });

  it("throws for an unknown condition attribute", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { condition: JSON.stringify({ account_uuid: "x" }) },
        "rule",
      ),
    ).toThrow(/account_uuid/);
  });

  it("treats archived attributes as unknown", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(ctx, { hashAttribute: "legacyId" }, "rule"),
    ).toThrow(/legacyId/);
  });

  it("aggregates every bad key into a single error", () => {
    const ctx = makeContext();
    let err: Error | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "typo1",
          fallbackAttribute: "typo2",
          condition: JSON.stringify({ typo3: "x", typo4: "y" }),
        },
        "rule",
      );
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/typo1/);
    expect(err?.message).toMatch(/typo2/);
    expect(err?.message).toMatch(/typo3/);
    expect(err?.message).toMatch(/typo4/);
  });

  it("silently ignores unparseable condition JSON (validateCondition reports that)", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "{bad json" },
        "rule",
      ),
    ).not.toThrow();
  });

  it("ignores empty condition / whitespace / {} ", () => {
    const ctx = makeContext();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "{}" },
        "rule",
      ),
    ).not.toThrow();
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userId", condition: "" },
        "rule",
      ),
    ).not.toThrow();
  });

  it("accepts dot-notation keys whose root is registered", () => {
    const ctx = makeContext({
      attributeSchema: [{ property: "user", datatype: "string" }],
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { condition: JSON.stringify({ "user.id": "x", "user.role": "y" }) },
        "rule",
      ),
    ).not.toThrow();
  });

  it("emits a project-scope-aware error when the attribute exists but isn't on this project", () => {
    // `country` is registered, but only for proj_one. Calling it from
    // proj_two should fail with a "not part of this project's scope"
    // message rather than the generic "Unknown attribute key" message —
    // the user otherwise reads the latter as "must declare" and tries to
    // recreate it.
    const ctx = makeContext({
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          // Cast — fixture type forbids `projects`, but the shared util reads it.
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/not part of this project's scope/);
    expect(err?.message).toMatch(/country/);
    expect(err?.message).not.toMatch(/Unknown attribute key/);
  });

  it("splits unknown vs out-of-project attributes in the same error", () => {
    const ctx = makeContext({
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        {
          hashAttribute: "country",
          fallbackAttribute: "totally_made_up",
        },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    // Both buckets are surfaced.
    expect(err?.message).toMatch(/Unknown attribute key/);
    expect(err?.message).toMatch(/totally_made_up/);
    expect(err?.message).toMatch(/not part of this project's scope/);
    expect(err?.message).toMatch(/country/);
  });

  // The setting is stored as an object on new orgs; legacy boolean shapes
  // still come through unchanged on older orgs. Lock down both forms behave
  // the same for the strict (everything-on) case so we don't regress
  // either path during future edits.
  it("treats legacy boolean and { isOn:true, requireProjectScoping:true } identically", () => {
    const schema = [
      { property: "userId", datatype: "string" as const },
      {
        property: "country",
        datatype: "string" as const,
        projects: ["proj_one"],
      } as unknown as {
        property: string;
        datatype: "string";
        archived?: boolean;
      },
    ];
    const legacy = makeContext({
      requireRegisteredAttributes: true,
      attributeSchema: schema,
    });
    const obj = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: true },
      attributeSchema: schema,
    });
    for (const ctx of [legacy, obj]) {
      expect(() =>
        assertRegisteredAttributes(
          ctx,
          { hashAttribute: "country" },
          "rule",
          undefined,
          "proj_two",
        ),
      ).toThrow(BadRequestError);
    }
  });

  it("with requireProjectScoping=false, accepts an attribute scoped to other projects", () => {
    // The user has opted into "must be a registered attribute" but NOT into
    // "must also be in this project's scope". An attribute that exists
    // anywhere in the org should pass even when the rule's project doesn't
    // appear on the attribute's scope list.
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
      attributeSchema: [
        { property: "userId", datatype: "string" },
        {
          property: "country",
          datatype: "string",
          projects: ["proj_one"],
        } as unknown as {
          property: string;
          datatype: "string";
          archived?: boolean;
        },
      ],
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "country" },
        "rule",
        undefined,
        "proj_two",
      ),
    ).not.toThrow();
  });

  it("with requireProjectScoping=false, still rejects truly-unknown / typo'd attributes", () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: true, requireProjectScoping: false },
    });
    let err: BadRequestError | undefined;
    try {
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "userID" },
        "rule",
        undefined,
        "proj_two",
      );
    } catch (e) {
      err = e as BadRequestError;
    }
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err?.message).toMatch(/Unknown attribute key/);
    expect(err?.message).toMatch(/userID/);
    expect(err?.message).not.toMatch(/not part of this project's scope/);
  });

  it("with isOn=false and a bogus attribute, is a no-op (master switch beats sub-toggles)", () => {
    const ctx = makeContext({
      requireRegisteredAttributes: { isOn: false, requireProjectScoping: true },
    });
    expect(() =>
      assertRegisteredAttributes(
        ctx,
        { hashAttribute: "totally_fake" },
        "rule",
        undefined,
        "proj_one",
      ),
    ).not.toThrow();
  });
});
