import {
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getUserIdTypesToAdd,
  isEventForwarderAllowedUserIdTypesChange,
  isHashAttributeUserIdType,
  mergeUserIdTypes,
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
        description: "",
        attributes: ["id"],
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
        description: "",
        attributes: ["id"],
      },
    ]);
  });

  it("uses attribute description when present", () => {
    const result = buildUserIdTypesFromAttributeSchema([
      {
        property: "user_id",
        datatype: "string",
        hashAttribute: true,
        description: "Logged-in user",
      },
    ]);

    expect(result[0]?.description).toBe("Logged-in user");
  });
});

describe("isHashAttributeUserIdType", () => {
  const schema = [
    { property: "user_id", datatype: "string" as const, hashAttribute: true },
    { property: "id", datatype: "string" as const, hashAttribute: true },
  ];

  it("returns true when userIdType matches a hash attribute", () => {
    expect(isHashAttributeUserIdType("user_id", schema)).toBe(true);
    expect(isHashAttributeUserIdType("USER_ID", schema)).toBe(true);
  });

  it("returns false for non-hash or unknown identifier types", () => {
    expect(isHashAttributeUserIdType("device_id", schema)).toBe(false);
    expect(isHashAttributeUserIdType("session_id", schema)).toBe(false);
  });
});

describe("isEventForwarderAllowedUserIdTypesChange", () => {
  const schema = [
    { property: "user_id", datatype: "string" as const, hashAttribute: true },
  ];
  const existing = [
    {
      userIdType: "user_id",
      description: "Logged-in user",
      attributes: ["user_id"],
    },
    {
      userIdType: "device_id",
      description: "",
      attributes: ["device_id", "session_id"],
    },
  ];

  it("allows description-only changes to hash-attribute identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(
        existing,
        [
          {
            userIdType: "user_id",
            description: "Updated description",
            attributes: ["user_id"],
          },
          existing[1],
        ],
        schema,
      ),
    ).toBe(true);
  });

  it("allows editing non-hash-attribute identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(
        existing,
        [
          {
            userIdType: "user_id",
            description: "Logged-in user",
            attributes: ["user_id"],
          },
          {
            userIdType: "account_id",
            description: "Renamed",
            attributes: ["account_id"],
          },
        ],
        schema,
      ),
    ).toBe(true);
  });

  it("allows deleting non-hash-attribute identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(existing, [existing[0]], schema),
    ).toBe(true);
  });

  it("rejects deleting hash-attribute identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(existing, [existing[1]], schema),
    ).toBe(false);
  });

  it("allows adding new identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(
        existing,
        [...existing, { userIdType: "session_id", description: "Session" }],
        schema,
      ),
    ).toBe(true);
  });

  it("rejects structural changes to hash-attribute identifier types", () => {
    expect(
      isEventForwarderAllowedUserIdTypesChange(
        existing,
        [
          {
            userIdType: "account_id",
            description: "Logged-in user",
            attributes: ["user_id"],
          },
          existing[1],
        ],
        schema,
      ),
    ).toBe(false);

    expect(
      isEventForwarderAllowedUserIdTypesChange(
        existing,
        [
          {
            userIdType: "user_id",
            description: "",
            attributes: ["device_id"],
          },
          existing[1],
        ],
        schema,
      ),
    ).toBe(false);

    expect(
      isEventForwarderAllowedUserIdTypesChange(existing, [existing[1]], schema),
    ).toBe(false);
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
