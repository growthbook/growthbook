import {
  EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
  attributeMatchesDatasourceProjects,
  findCollidingUserIdTypeName,
  findEventForwarderManagedViolation,
  findNewDuplicateUserIdTypeName,
  getEventForwarderDatasourceParams,
  getEventForwarderHashAttributes,
  getEventForwarderSinkTypeForDatasource,
  getEventForwarderUserIdTypeSourceAttribute,
  isEventForwarderManaged,
  resolveEventForwarderManagedName,
  resolveEventForwarderManagedUserIdTypes,
  supportsEventForwarder,
  toNormalizedNameSet,
} from "../../src/util/event-forwarder-datasource";

const managed = (userIdType: string, attribute: string) => ({
  userIdType,
  description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
  attributes: [attribute],
  managedBy: "api",
});

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

describe("getEventForwarderHashAttributes", () => {
  it("includes only hash attributes that are not archived", () => {
    expect(
      getEventForwarderHashAttributes([
        { property: "user_id", datatype: "string", hashAttribute: true },
        { property: "device_id", datatype: "string", hashAttribute: true },
        { property: "country", datatype: "string" },
        {
          property: "old_id",
          datatype: "string",
          hashAttribute: true,
          archived: true,
        },
      ]),
    ).toEqual(["user_id", "device_id"]);
  });

  it("filters by datasource projects", () => {
    expect(
      getEventForwarderHashAttributes(
        [
          {
            property: "user_id",
            datatype: "string",
            hashAttribute: true,
            projects: ["proj_a"],
          },
          {
            property: "device_id",
            datatype: "string",
            hashAttribute: true,
            projects: ["proj_b"],
          },
        ],
        ["proj_a"],
      ),
    ).toEqual(["user_id"]);
  });
});

describe("isEventForwarderManaged", () => {
  it("recognizes a managed record by its marker, never by its name", () => {
    expect(isEventForwarderManaged({ managedBy: "api" })).toBe(true);
    expect(isEventForwarderManaged({ managedBy: "" })).toBe(false);
    expect(isEventForwarderManaged({})).toBe(false);
  });

  it("does not promote a record that predates the marker", () => {
    expect(
      isEventForwarderManaged({
        userIdType: "ef_user_id",
        description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
        attributes: ["user_id"],
      }),
    ).toBe(false);
  });
});

describe("getEventForwarderUserIdTypeSourceAttribute", () => {
  it("uses the sole Linked Hash Attribute", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "ef_user_id",
        attributes: ["user_id"],
      }),
    ).toBe("user_id");
  });

  it("falls back to the name when there are no links", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({ userIdType: "user_id" }),
    ).toBe("user_id");
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "user_id",
        attributes: [],
      }),
    ).toBe("user_id");
  });

  it("models no attribute at all when several are linked", () => {
    expect(
      getEventForwarderUserIdTypeSourceAttribute({
        userIdType: "account",
        attributes: ["user_id", "org_id"],
      }),
    ).toBe("account");
  });
});

describe("resolveEventForwarderManagedName", () => {
  it("keeps the attribute name when it is free", () => {
    expect(resolveEventForwarderManagedName("user_id", new Set())).toBe(
      "user_id",
    );
  });

  it("prefixes once to break a collision", () => {
    expect(
      resolveEventForwarderManagedName("user_id", new Set(["user_id"])),
    ).toBe("ef_user_id");
  });

  it("prefixes again when the prefixed name is also taken", () => {
    expect(
      resolveEventForwarderManagedName(
        "user_id",
        new Set(["user_id", "ef_user_id"]),
      ),
    ).toBe("ef_ef_user_id");
  });

  it("treats a differently-cased name as already taken", () => {
    expect(
      resolveEventForwarderManagedName(
        "user_id",
        toNormalizedNameSet(["USER_ID"]),
      ),
    ).toBe("ef_user_id");
  });
});

describe("resolveEventForwarderManagedUserIdTypes", () => {
  it("creates an unprefixed managed type for an attribute nothing models", () => {
    const { userIdTypes, pairs } = resolveEventForwarderManagedUserIdTypes(
      [],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([managed("user_id", "user_id")]);
    expect(pairs).toEqual([
      { attribute: "user_id", userIdType: managed("user_id", "user_id") },
    ]);
  });

  it("reuses an entry whose sole Linked Hash Attribute is the attribute", () => {
    const { userIdTypes, pairs } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "account", description: "mine", attributes: ["user_id"] }],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([
      {
        userIdType: "account",
        description: "mine",
        attributes: ["user_id"],
        managedBy: "api",
      },
    ]);
    expect(pairs[0].userIdType.userIdType).toBe("account");
  });

  it("adopts an entry named after the attribute and links it", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id", description: "mine" }],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([
      {
        userIdType: "user_id",
        description: "mine",
        attributes: ["user_id"],
        managedBy: "api",
      },
    ]);
  });

  it("keeps an existing entry's own casing on its link", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "account", attributes: ["User_Id"] }],
      ["user_id"],
    );

    expect(userIdTypes[0].attributes).toEqual(["User_Id"]);
  });

  it("prefixes the new type when something linked elsewhere holds its name", () => {
    const { userIdTypes, pairs } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id", attributes: ["device_id"] }],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([
      { userIdType: "user_id", attributes: ["device_id"] },
      managed("ef_user_id", "user_id"),
    ]);
    expect(pairs.map((p) => p.userIdType.userIdType)).toEqual(["ef_user_id"]);
  });

  it("does not reuse an entry linked to several attributes", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "account", attributes: ["user_id", "org_id"] }],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([
      { userIdType: "account", attributes: ["user_id", "org_id"] },
      managed("user_id", "user_id"),
    ]);
  });

  it("prefixes the new type when the multi-linked entry also holds its name", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id", attributes: ["user_id", "org_id"] }],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([
      { userIdType: "user_id", attributes: ["user_id", "org_id"] },
      managed("ef_user_id", "user_id"),
    ]);
  });

  it("prefixes twice when the prefixed name is taken too", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [
        { userIdType: "user_id", attributes: ["device_id"] },
        { userIdType: "ef_user_id", attributes: ["country_id"] },
      ],
      ["user_id"],
    );

    expect(userIdTypes[2]).toEqual(managed("ef_ef_user_id", "user_id"));
  });

  it("keeps a legacy ef_ record as it is instead of minting a twin", () => {
    const legacy = {
      userIdType: "ef_user_id",
      description: EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
      attributes: ["user_id"],
    };

    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [legacy],
      ["user_id"],
    );

    expect(userIdTypes).toEqual([{ ...legacy, managedBy: "api" }]);
  });

  it("leaves a managed type in place when its attribute is gone", () => {
    const existing = [managed("user_id", "user_id")];

    expect(resolveEventForwarderManagedUserIdTypes(existing, [])).toEqual({
      userIdTypes: existing,
      pairs: [],
    });
  });

  it("resumes managing that type when the attribute comes back", () => {
    const existing = [managed("user_id", "user_id")];
    const { pairs } = resolveEventForwarderManagedUserIdTypes(existing, [
      "user_id",
    ]);

    expect(pairs).toEqual([
      { attribute: "user_id", userIdType: managed("user_id", "user_id") },
    ]);
  });

  it("gives each attribute its own entry", () => {
    const { userIdTypes } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id" }],
      ["user_id", "device_id"],
    );

    expect(userIdTypes.map((u) => u.userIdType)).toEqual([
      "user_id",
      "device_id",
    ]);
  });

  it("does not let two attributes share one entry", () => {
    const { userIdTypes, pairs } = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id" }],
      ["user_id", "USER_ID"],
    );

    expect(userIdTypes).toHaveLength(2);
    expect(userIdTypes[1].userIdType).toBe("ef_USER_ID");
    expect(pairs).toHaveLength(2);
  });

  it("returns the same result on the next sync", () => {
    const first = resolveEventForwarderManagedUserIdTypes(
      [{ userIdType: "user_id", description: "mine" }],
      ["user_id"],
    );
    const second = resolveEventForwarderManagedUserIdTypes(first.userIdTypes, [
      "user_id",
    ]);

    expect(second.userIdTypes).toEqual(first.userIdTypes);
  });
});

describe("findEventForwarderManagedViolation", () => {
  const identify = (r: { userIdType: string }) => r.userIdType;
  const label = "identifier type";
  const before = [
    managed("user_id", "user_id"),
    { userIdType: "mine", description: "mine" },
  ];

  it("allows an update that leaves managed records alone", () => {
    expect(
      findEventForwarderManagedViolation({
        before,
        after: [before[0], { userIdType: "mine", description: "edited" }],
        identify,
        label,
      }),
    ).toBe(null);
  });

  it("rejects deleting a managed record", () => {
    expect(
      findEventForwarderManagedViolation({
        before,
        after: [before[1]],
        identify,
        label,
      }),
    ).toBe(
      "Cannot delete identifier type user_id because it is managed by Event Forwarder",
    );
  });

  it("rejects editing a managed record", () => {
    expect(
      findEventForwarderManagedViolation({
        before,
        after: [{ ...before[0], description: "mine now" }, before[1]],
        identify,
        label,
      }),
    ).toBe(
      "Cannot edit identifier type user_id because it is managed by Event Forwarder",
    );
  });

  it("allows validation to stamp an error on a managed record", () => {
    expect(
      findEventForwarderManagedViolation({
        before,
        after: [{ ...before[0], error: "bad query" }, before[1]],
        identify,
        label,
      }),
    ).toBe(null);
    expect(
      findEventForwarderManagedViolation({
        before: [{ ...before[0], error: "bad query" }],
        after: [{ ...before[0], error: undefined }],
        identify,
        label,
      }),
    ).toBe(null);
  });

  it("allows anything when nothing was managed", () => {
    expect(
      findEventForwarderManagedViolation({
        before: [before[1]],
        after: [],
        identify,
        label,
      }),
    ).toBe(null);
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
