import {
  EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  findCollidingUserIdTypeName,
  findDuplicateUserIdTypeName,
  findNewDuplicateUserIdTypeName,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getEventForwarderUserIdTypeSourceAttribute,
  getUserIdTypesToAdd,
  isEventForwarderManagedUserIdType,
  mergeUserIdTypes,
  reconcileEventForwarderManagedUserIdTypes,
  supportsEventForwarder,
} from "../../src/util/event-forwarder-datasource";

describe("getEventForwarderSinkTypeForDatasource", () => {
  it("returns sink type for supported datasources", () => {
    expect(getEventForwarderSinkTypeForDatasource({ type: "bigquery" })).toBe(
      "bigquery",
    );
    expect(getEventForwarderSinkTypeForDatasource({ type: "snowflake" })).toBe(
      "snowflake",
    );
  });

  it("returns null for unsupported datasources", () => {
    expect(getEventForwarderSinkTypeForDatasource({ type: "postgres" })).toBe(
      null,
    );
  });
});

describe("supportsEventForwarder", () => {
  it("returns true for supported datasource types", () => {
    expect(supportsEventForwarder({ type: "bigquery" })).toBe(true);
    expect(supportsEventForwarder({ type: "snowflake" })).toBe(true);
  });

  it("returns false for unsupported or missing datasources", () => {
    expect(supportsEventForwarder({ type: "postgres" })).toBe(false);
    expect(supportsEventForwarder(null)).toBe(false);
    expect(supportsEventForwarder(undefined)).toBe(false);
  });
});

describe("getEventForwarderDatasourceParams", () => {
  it("narrows params by datasource type", () => {
    const bqParams = { projectId: "proj" };
    expect(getEventForwarderDatasourceParams("bigquery", bqParams)).toBe(
      bqParams,
    );
    expect(getEventForwarderDatasourceParams("postgres", bqParams)).toBe(
      undefined,
    );
  });
});

describe("attributeMatchesDatasourceProjects", () => {
  it("returns true when neither has projects", () => {
    expect(
      attributeMatchesDatasourceProjects(
        { property: "id", datatype: "string" },
        [],
      ),
    ).toBe(true);
  });

  it("returns true when attribute has no projects", () => {
    expect(
      attributeMatchesDatasourceProjects(
        { property: "id", datatype: "string" },
        ["proj_a"],
      ),
    ).toBe(true);
  });

  it("returns true when datasource has no projects", () => {
    expect(
      attributeMatchesDatasourceProjects(
        { property: "id", datatype: "string", projects: ["proj_a"] },
        [],
      ),
    ).toBe(true);
  });

  it("returns true when projects overlap", () => {
    expect(
      attributeMatchesDatasourceProjects(
        { property: "id", datatype: "string", projects: ["proj_a", "proj_b"] },
        ["proj_b"],
      ),
    ).toBe(true);
  });

  it("returns false when projects do not overlap", () => {
    expect(
      attributeMatchesDatasourceProjects(
        { property: "id", datatype: "string", projects: ["proj_a"] },
        ["proj_b"],
      ),
    ).toBe(false);
  });
});

describe("buildUserIdTypesFromAttributeSchema", () => {
  it("includes only hash attributes that are not archived", () => {
    const result = buildUserIdTypesFromAttributeSchema([
      { property: "id", datatype: "string", hashAttribute: true },
      {
        property: "company",
        datatype: "string",
        hashAttribute: true,
        archived: true,
      },
      { property: "country", datatype: "string" },
    ]);

    expect(result).toEqual([
      {
        userIdType: "id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
        managedBy: "api",
        sourceAttribute: "id",
      },
    ]);
  });

  it("filters by datasource projects", () => {
    const result = buildUserIdTypesFromAttributeSchema(
      [
        { property: "id", datatype: "string", hashAttribute: true },
        {
          property: "device_id",
          datatype: "string",
          hashAttribute: true,
          projects: ["proj_a"],
        },
      ],
      ["proj_b"],
    );

    expect(result).toEqual([
      {
        userIdType: "id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
        managedBy: "api",
        sourceAttribute: "id",
      },
    ]);
  });

  it("uses managed description when attribute description is present", () => {
    const result = buildUserIdTypesFromAttributeSchema([
      {
        property: "user_id",
        datatype: "string",
        hashAttribute: true,
        description: "Logged-in user",
      },
    ]);

    expect(result[0]?.description).toBe(
      EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
    );
  });
});

describe("isEventForwarderManagedUserIdType", () => {
  it("identifies managed types by the marker, not by the name", () => {
    expect(
      isEventForwarderManagedUserIdType({ managedBy: "api" as const }),
    ).toBe(true);
    expect(isEventForwarderManagedUserIdType({ managedBy: "" as const })).toBe(
      false,
    );
    expect(isEventForwarderManagedUserIdType({})).toBe(false);
  });
});

describe("getEventForwarderUserIdTypeSourceAttribute", () => {
  it("resolves a renamed managed type back to its source attribute", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "logged_in_user",
        managedBy: "api",
        sourceAttribute: "user_id",
      }),
    ).toBe("user_id");
  });

  it("falls back to the name when a managed type has no link yet", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "user_id",
        managedBy: "api",
      }),
    ).toBe("user_id");
  });

  it("honors the link on a reused user-created type", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "logged_in_user",
        sourceAttribute: "user_id",
      }),
    ).toBe("user_id");
  });

  it("falls back to the name when there is no link", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({ userIdType: "device_id" }),
    ).toBe("device_id");
  });

  it("recovers the attribute from a legacy ef_-prefixed managed name", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_user_id",
        managedBy: "api",
      }),
    ).toBe("user_id");
  });

  it("strips exactly one legacy prefix", () => {
    // The old code prefixed unconditionally, so an attribute literally named
    // "ef_user_id" was stored as "ef_ef_user_id".
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_ef_user_id",
        managedBy: "api",
      }),
    ).toBe("ef_user_id");
  });

  it("leaves an ef_ name alone on a user-created type", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({ userIdType: "ef_user_id" }),
    ).toBe("ef_user_id");
  });

  it("prefers an explicit link over the legacy name", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_user_id",
        managedBy: "api",
        sourceAttribute: "device_id",
      }),
    ).toBe("device_id");
  });
});

describe("findCollidingUserIdTypeName", () => {
  const userIdTypes = [{ userIdType: "user_id" }, { userIdType: "Device_ID" }];

  it("matches case insensitively and returns the existing spelling", () => {
    expect(findCollidingUserIdTypeName(userIdTypes, "USER_ID")).toBe("user_id");
    expect(findCollidingUserIdTypeName(userIdTypes, "device_id")).toBe(
      "Device_ID",
    );
  });

  it("returns null when the name is free", () => {
    expect(findCollidingUserIdTypeName(userIdTypes, "anonymous_id")).toBe(null);
  });
});

describe("findDuplicateUserIdTypeName", () => {
  it("returns null when names are unique ignoring case", () => {
    expect(
      findDuplicateUserIdTypeName([
        { userIdType: "user_id" },
        { userIdType: "device_id" },
      ]),
    ).toBe(null);
  });

  it("returns the later spelling when two names collide case-insensitively", () => {
    expect(
      findDuplicateUserIdTypeName([
        { userIdType: "user_id" },
        { userIdType: "USER_ID" },
      ]),
    ).toBe("USER_ID");
  });
});

describe("findNewDuplicateUserIdTypeName", () => {
  it("returns a collision the update introduces", () => {
    expect(
      findNewDuplicateUserIdTypeName(
        [{ userIdType: "user_id" }],
        [{ userIdType: "user_id" }, { userIdType: "USER_ID" }],
      ),
    ).toBe("USER_ID");
  });

  it("grandfathers a collision the datasource already stored", () => {
    const stored = [{ userIdType: "user_id" }, { userIdType: "USER_ID" }];

    expect(
      findNewDuplicateUserIdTypeName(stored, [
        ...stored,
        { userIdType: "device_id" },
      ]),
    ).toBe(null);
  });

  it("still catches a second collision alongside a grandfathered one", () => {
    expect(
      findNewDuplicateUserIdTypeName(
        [{ userIdType: "user_id" }, { userIdType: "USER_ID" }],
        [
          { userIdType: "user_id" },
          { userIdType: "USER_ID" },
          { userIdType: "device_id" },
          { userIdType: "Device_Id" },
        ],
      ),
    ).toBe("Device_Id");
  });
});

describe("reconcileEventForwarderManagedUserIdTypes", () => {
  const desired = [
    {
      userIdType: "user_id",
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: ["user_id"],
      managedBy: "api" as const,
      sourceAttribute: "user_id",
    },
  ];

  it("keeps a user-renamed managed type instead of reverting the name", () => {
    const existing = [
      {
        userIdType: "logged_in_user",
        description: "Renamed by the user",
        attributes: ["user_id"],
        managedBy: "api" as const,
        sourceAttribute: "user_id",
      },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([
      {
        userIdType: "logged_in_user",
        description: "Renamed by the user",
        attributes: ["user_id"],
        managedBy: "api",
        sourceAttribute: "user_id",
      },
    ]);
  });

  it("adds managed types for newly eligible attributes", () => {
    expect(reconcileEventForwarderManagedUserIdTypes([], desired)).toEqual(
      desired,
    );
  });

  it("drops managed types whose attribute is no longer eligible", () => {
    const existing = [
      {
        userIdType: "company_id",
        managedBy: "api" as const,
        sourceAttribute: "company_id",
      },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual(desired);
  });

  it("passes user-created types through untouched", () => {
    const existing = [
      { userIdType: "anonymous_id", description: "Mine", attributes: [] },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([...existing, ...desired]);
  });

  // Datasource that predates the Event Forwarder: the user already models this
  // unit, so connecting takes their entry over instead of duplicating it.
  it("takes over a same-named user-created type that already links the attribute", () => {
    const existing = [
      {
        userIdType: "user_id",
        description: "Mine",
        attributes: ["user_id", "device_id"],
      },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([
      {
        userIdType: "user_id",
        description: "Mine",
        attributes: ["user_id", "device_id"],
        managedBy: "api",
        sourceAttribute: "user_id",
      },
    ]);
  });

  it("links the hash attribute when taking over a type that has none", () => {
    const existing = [
      { userIdType: "user_id", description: "", attributes: [] },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([
      {
        userIdType: "user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
        managedBy: "api",
        sourceAttribute: "user_id",
      },
    ]);
  });

  it("drops a taken-over type once its attribute is gone", () => {
    const existing = [
      { userIdType: "user_id", description: "Mine", attributes: ["user_id"] },
    ];
    const takenOver = reconcileEventForwarderManagedUserIdTypes(
      existing,
      desired,
    );

    expect(takenOver[0].managedBy).toBe("api");
    // Take-over means EF owns the lifecycle, deletion included.
    expect(reconcileEventForwarderManagedUserIdTypes(takenOver, [])).toEqual(
      [],
    );
  });

  it("is idempotent across repeated take-over", () => {
    const existing = [
      { userIdType: "user_id", description: "", attributes: [] },
    ];
    const once = reconcileEventForwarderManagedUserIdTypes(existing, desired);

    expect(reconcileEventForwarderManagedUserIdTypes(once, desired)).toEqual(
      once,
    );
  });

  it("does not add a second identifier type when a taken-over one was renamed", () => {
    const renamed = [
      {
        userIdType: "logged_in_user",
        description: "Mine",
        attributes: ["user_id"],
        managedBy: "api" as const,
        sourceAttribute: "user_id",
      },
    ];

    expect(reconcileEventForwarderManagedUserIdTypes(renamed, desired)).toEqual(
      renamed,
    );
  });

  it("links a legacy ef_-prefixed managed type instead of dropping it", () => {
    const legacy = [
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
        managedBy: "api" as const,
      },
    ];

    const reconciled = reconcileEventForwarderManagedUserIdTypes(
      legacy,
      desired,
    );

    // One entry per hash attribute: the legacy one claims "user_id" rather than
    // being dropped and re-minted beside it. Backfilling the link is the only
    // write — the name stays put, so every warehouse artifact keyed off it does.
    expect(reconciled).toEqual([{ ...legacy[0], sourceAttribute: "user_id" }]);
  });

  it("is idempotent after linking a legacy managed type", () => {
    const legacy = [
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
        managedBy: "api" as const,
      },
    ];

    const once = reconcileEventForwarderManagedUserIdTypes(legacy, desired);

    expect(reconcileEventForwarderManagedUserIdTypes(once, desired)).toEqual(
      once,
    );
  });

  it("does not adopt a user-created ef_-prefixed type", () => {
    const mine = [
      {
        userIdType: "ef_user_id",
        description: "Mine",
        attributes: ["something_else"],
      },
    ];

    const reconciled = reconcileEventForwarderManagedUserIdTypes(mine, desired);

    // No link is inferred from the name, so "user_id" is still unclaimed and
    // gets its own managed entry.
    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toEqual(mine[0]);
    expect(reconciled[1].userIdType).toBe("user_id");
  });
});

describe("getUserIdTypesToAdd", () => {
  it("returns only built userIdTypes not already present", () => {
    const existing = [
      { userIdType: "user_id", description: "Existing", attributes: ["id"] },
    ];
    const built = [
      { userIdType: "user_id", description: "Dup", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ];

    expect(getUserIdTypesToAdd(existing, built)).toEqual([
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ]);
  });

  it("returns empty array when nothing to add", () => {
    const existing = [{ userIdType: "id", description: "" }];
    expect(getUserIdTypesToAdd(existing, [])).toEqual([]);
    expect(
      getUserIdTypesToAdd(existing, [{ userIdType: "id", description: "x" }]),
    ).toEqual([]);
  });

  it("does not re-add a managed type that the user renamed", () => {
    const existing = [
      {
        userIdType: "logged_in_user",
        managedBy: "api" as const,
        sourceAttribute: "user_id",
      },
    ];
    const built = [
      {
        userIdType: "user_id",
        managedBy: "api" as const,
        sourceAttribute: "user_id",
      },
    ];

    expect(getUserIdTypesToAdd(existing, built)).toEqual([]);
  });

  it("treats userIdType names as case insensitive", () => {
    const existing = [
      { userIdType: "User_ID", description: "Existing", attributes: ["id"] },
    ];
    const built = [
      { userIdType: "user_id", description: "Dup", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ];

    expect(getUserIdTypesToAdd(existing, built)).toEqual([
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ]);
  });
});

describe("mergeUserIdTypes", () => {
  it("appends only missing userIdType values", () => {
    const existing = [
      { userIdType: "user_id", description: "Existing", attributes: ["id"] },
    ];
    const built = [
      { userIdType: "user_id", description: "Dup", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ];

    expect(mergeUserIdTypes(existing, built)).toEqual([
      { userIdType: "user_id", description: "Existing", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ]);
  });

  it("returns existing unchanged when nothing to add", () => {
    const existing = [{ userIdType: "id", description: "" }];
    expect(mergeUserIdTypes(existing, [])).toBe(existing);
    expect(
      mergeUserIdTypes(existing, [{ userIdType: "id", description: "x" }]),
    ).toBe(existing);
  });

  it("treats userIdType names as case insensitive when merging", () => {
    const existing = [
      { userIdType: "User_ID", description: "Existing", attributes: ["id"] },
    ];
    const built = [
      { userIdType: "user_id", description: "Dup", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ];

    expect(mergeUserIdTypes(existing, built)).toEqual([
      { userIdType: "User_ID", description: "Existing", attributes: ["id"] },
      { userIdType: "device_id", description: "", attributes: ["device_id"] },
    ]);
  });
});
