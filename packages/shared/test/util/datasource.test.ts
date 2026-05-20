import {
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  mergeUserIdTypes,
} from "../../src/util/datasource";

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
