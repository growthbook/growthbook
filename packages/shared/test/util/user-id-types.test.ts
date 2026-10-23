import {
  addAttributeToUserIdTypes,
  attributeToUserIdTypeName,
  isValidUserIdTypeName,
} from "../../src/util/user-id-types";

describe("isValidUserIdTypeName", () => {
  it.each(["user_id", "device_cookie", "_id", "id"])("accepts %s", (name) => {
    expect(isValidUserIdTypeName(name)).toBe(true);
  });

  it.each(["", "userId", "ga4_id", "user-id", "user id", "1id"])(
    "rejects %s",
    (name) => {
      expect(isValidUserIdTypeName(name)).toBe(false);
    },
  );
});

describe("attributeToUserIdTypeName", () => {
  it("keeps names that are already valid", () => {
    expect(attributeToUserIdTypeName("user_id")).toBe("user_id");
  });

  it("splits camelCase into snake_case", () => {
    expect(attributeToUserIdTypeName("userId")).toBe("user_id");
    expect(attributeToUserIdTypeName("anonymousId")).toBe("anonymous_id");
  });

  it("replaces punctuation and spaces with underscores", () => {
    expect(attributeToUserIdTypeName("Device-ID")).toBe("device_id");
    expect(attributeToUserIdTypeName("company id")).toBe("company_id");
  });

  it("drops digits", () => {
    expect(attributeToUserIdTypeName("ga4Id")).toBe("ga_id");
  });

  it("collapses repeated underscores and trims the ends", () => {
    expect(attributeToUserIdTypeName("__user__id__")).toBe("user_id");
  });

  it("falls back to id when nothing usable is left", () => {
    expect(attributeToUserIdTypeName("123")).toBe("id");
    expect(attributeToUserIdTypeName("!!!")).toBe("id");
    expect(attributeToUserIdTypeName("")).toBe("id");
  });

  it.each(["userId", "Device-ID", "ga4Id", "123", "__user__id__"])(
    "always produces a valid name for %s",
    (attribute) => {
      expect(isValidUserIdTypeName(attributeToUserIdTypeName(attribute))).toBe(
        true,
      );
    },
  );
});

describe("addAttributeToUserIdTypes", () => {
  it("adds a new identifier type for an unknown column", () => {
    expect(
      addAttributeToUserIdTypes(
        [{ userIdType: "user_id", attributes: ["id"] }],
        "team_id",
        "teamId",
      ),
    ).toEqual([
      { userIdType: "user_id", attributes: ["id"] },
      { userIdType: "team_id", attributes: ["teamId"] },
    ]);
  });

  it("gives a new identifier type the attribute's description", () => {
    expect(
      addAttributeToUserIdTypes([], "team_id", "teamId", "Team of the user"),
    ).toEqual([
      {
        userIdType: "team_id",
        description: "Team of the user",
        attributes: ["teamId"],
      },
    ]);
  });

  it("links the attribute to an existing type with that column", () => {
    expect(
      addAttributeToUserIdTypes(
        [
          {
            userIdType: "workspace_id",
            description: "Workspaces",
            attributes: ["workspaceId"],
          },
        ],
        "workspace_id",
        "team_id",
      ),
    ).toEqual([
      {
        userIdType: "workspace_id",
        description: "Workspaces",
        attributes: ["workspaceId", "team_id"],
      },
    ]);
  });

  it("does not duplicate an attribute already linked", () => {
    const types = [{ userIdType: "team_id", attributes: ["team_id"] }];
    expect(addAttributeToUserIdTypes(types, "team_id", "team_id")).toEqual(
      types,
    );
  });
});
