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
  it("identifies current managed types by the marker", () => {
    expect(
      isEventForwarderManagedUserIdType({
        userIdType: "user_id",
        managedBy: "api",
      }),
    ).toBe(true);
    expect(
      isEventForwarderManagedUserIdType({
        userIdType: "user_id",
        managedBy: "",
      }),
    ).toBe(false);
    expect(isEventForwarderManagedUserIdType({ userIdType: "user_id" })).toBe(
      false,
    );
  });

  // Ownership is taken at creation and never afterwards. A record written before
  // the marker existed is linked, not owned, so it stays the user's to edit.
  it("does not promote a record that predates the marker", () => {
    expect(
      isEventForwarderManagedUserIdType({
        userIdType: "ef_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["id"],
      }),
    ).toBe(false);
  });

  it("leaves an ef_ name that links something else alone", () => {
    expect(
      isEventForwarderManagedUserIdType({
        userIdType: "ef_id",
        attributes: ["something_else"],
      }),
    ).toBe(false);
    expect(
      isEventForwarderManagedUserIdType({
        userIdType: "ef_id",
        attributes: [],
      }),
    ).toBe(false);
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

  // The old builder always wrote the attribute into Linked Hash Attributes, so
  // that is what recovers it. The name is never read, prefixed or not.
  it("recovers the attribute from a lone linked hash attribute", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_user_id",
        attributes: ["user_id"],
      }),
    ).toBe("user_id");
  });

  it("reads no meaning from an ef_ name on its own", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({ userIdType: "ef_user_id" }),
    ).toBe("ef_user_id");
    // Including one an old build produced by prefixing an attribute already
    // called "ef_user_id".
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_ef_user_id",
        attributes: ["ef_user_id"],
      }),
    ).toBe("ef_user_id");
  });

  it("falls back to the name when several hash attributes are linked", () => {
    // Several means the entry is the user's own construct rather than a model
    // of one attribute.
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "anonymous_id",
        attributes: ["anonymous_id", "user_id"],
      }),
    ).toBe("anonymous_id");
  });

  it("prefers an explicit link over the linked hash attribute", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_user_id",
        attributes: ["user_id"],
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

  it("releases managed types whose attribute is no longer eligible", () => {
    const existing = [
      {
        userIdType: "company_id",
        managedBy: "api" as const,
        sourceAttribute: "company_id",
      },
    ];

    // Never deleted: identity joins, experiments, and the Events fact table may
    // still read this name. The marker and the link come off and it is the
    // user's to remove.
    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([{ userIdType: "company_id", managedBy: "" }, ...desired]);
  });

  it("writes nothing on the sync after a type is released", () => {
    const released = [{ userIdType: "company_id", managedBy: "" as const }];

    expect(
      reconcileEventForwarderManagedUserIdTypes(released, desired),
    ).toEqual([...released, ...desired]);
  });

  it("releases a legacy type without writing to it", () => {
    // Predates managedBy, so there is no marker to clear and no link to drop.
    const legacy = [
      {
        userIdType: "ef_company_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["company_id"],
      },
    ];

    expect(reconcileEventForwarderManagedUserIdTypes(legacy, desired)).toEqual([
      ...legacy,
      ...desired,
    ]);
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
  // unit, so connecting links their entry instead of duplicating it.
  it("leaves a same-named user-created type alone when it already links the attribute", () => {
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
        sourceAttribute: "user_id",
      },
    ]);
  });

  it("links the hash attribute on a type that has none, without claiming it", () => {
    const existing = [
      { userIdType: "user_id", description: "", attributes: [] },
    ];

    // No managedBy, and the description stays the user's — calling it "Managed
    // by Event Forwarder" would be a lie for an entry we do not own.
    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([
      {
        userIdType: "user_id",
        description: "",
        attributes: ["user_id"],
        sourceAttribute: "user_id",
      },
    ]);
  });

  it("unlinks rather than deletes a linked type once its attribute is gone", () => {
    const existing = [
      { userIdType: "user_id", description: "Mine", attributes: ["user_id"] },
    ];
    const linked = reconcileEventForwarderManagedUserIdTypes(existing, desired);

    // Linking is not ownership, so archiving the attribute leaves the user's
    // entry intact along with anything referencing its name.
    expect(linked[0].managedBy).toBe(undefined);
    expect(reconcileEventForwarderManagedUserIdTypes(linked, [])).toEqual(
      existing,
    );
  });

  it("is idempotent across repeated linking", () => {
    const existing = [
      { userIdType: "user_id", description: "", attributes: [] },
    ];
    const once = reconcileEventForwarderManagedUserIdTypes(existing, desired);

    expect(reconcileEventForwarderManagedUserIdTypes(once, desired)).toEqual(
      once,
    );
  });

  it("does not add a second identifier type when a linked one was renamed", () => {
    const renamed = [
      {
        userIdType: "logged_in_user",
        description: "Mine",
        attributes: ["user_id"],
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

  // Exactly what the old builder wrote: no managedBy, attribute in `attributes`.
  it("links a record that predates the marker without taking it over", () => {
    const legacy = [
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
      },
    ];

    // Linked, so it claims the attribute and no unprefixed twin appears. Not
    // owned: no managedBy is written, so it stays editable and deletable.
    expect(reconcileEventForwarderManagedUserIdTypes(legacy, desired)).toEqual([
      { ...legacy[0], sourceAttribute: "user_id" },
    ]);
  });

  it("lets an explicit link win the attribute over one inferred from attributes", () => {
    const existing = [
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
      },
      // Spawned because the legacy entry above was mistaken for a user's own.
      {
        userIdType: "user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
        managedBy: "api" as const,
        sourceAttribute: "user_id",
      },
    ];

    // The explicit link settles it, so the attribute is not contested by the
    // older entry's Linked Hash Attributes. Both records survive untouched —
    // the loser is simply left unlinked rather than deleted.
    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual(existing);
  });

  it("prefers the entry whose linked hash attributes model the attribute", () => {
    const existing = [
      // Provisioned by an older build. Its exposure query, warehouse column, and
      // every experiment reference hang off this name, so it keeps the attribute
      // even though another entry is named after it.
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
      },
      { userIdType: "user_id", description: "Mine", attributes: [] },
    ];

    expect(
      reconcileEventForwarderManagedUserIdTypes(existing, desired),
    ).toEqual([
      { ...existing[0], sourceAttribute: "user_id" },
      // Untouched: no link, no marker, still entirely the user's.
      existing[1],
    ]);
  });

  it("claims one attribute per identifier type", () => {
    const existing = [
      {
        userIdType: "combined",
        description: "Mine",
        attributes: ["user_id", "device_id"],
      },
    ];

    const reconciled = reconcileEventForwarderManagedUserIdTypes(existing, [
      ...desired,
      {
        userIdType: "device_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["device_id"],
        managedBy: "api" as const,
        sourceAttribute: "device_id",
      },
    ]);

    // One entry cannot serve two attributes: its query aliases a single column
    // reading a single attribute. It takes the first, and the second gets its
    // own entry rather than being silently folded in.
    expect(reconciled).toHaveLength(2);
    expect(reconciled[0]).toEqual({
      ...existing[0],
      sourceAttribute: "user_id",
    });
    expect(reconciled[1].userIdType).toBe("device_id");
    expect(reconciled[1].managedBy).toBe("api");
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

  it("does not re-add an attribute an older record already models", () => {
    // No marker and a name that shares nothing with the attribute, so only its
    // Linked Hash Attributes say it already covers user_id.
    const existing = [
      {
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
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
