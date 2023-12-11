import omit from "lodash/omit";
import { LegacySavedGroup, migrateSavedGroup } from "../src/util/migrations";
import { SDKAttributeSchema } from "../types/organization";
import { SavedGroupInterface } from "../types/saved-group";

describe("Saved Group Migration", () => {
  const withValues: LegacySavedGroup = {
    attributeKey: "str",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    groupName: "My Group",
    id: "grp_abc123",
    organization: "org_abc123",
    owner: "",
    values: ["1", "2", "3"],
  };
  const runtimeGroup: LegacySavedGroup = {
    attributeKey: "admin",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    groupName: "Admins",
    id: "grp_abc456",
    organization: "org_abc123",
    owner: "",
    source: "runtime",
  };
  const withCondition: SavedGroupInterface = {
    condition: JSON.stringify({ str: { $nin: ["1", "2", "3"] } }),
    dateCreated: new Date(),
    dateUpdated: new Date(),
    groupName: "My Group",
    id: "grp_abc789",
    organization: "org_abc123",
    owner: "",
  };

  const attributes: SDKAttributeSchema = [
    {
      property: "str",
      datatype: "string",
    },
    {
      property: "num",
      datatype: "number",
    },
    {
      property: "str_arr",
      datatype: "secureString[]",
    },
  ];

  it("adds missing condition for saved groups with values", () => {
    expect(migrateSavedGroup(withValues, attributes)).toEqual({
      ...omit(withValues, ["values"]),
      condition: JSON.stringify({ str: { $in: ["1", "2", "3"] } }),
    });

    // Still migrates when source = "inline"
    expect(
      migrateSavedGroup({ ...withValues, source: "inline" }, attributes)
    ).toEqual({
      ...omit(withValues, ["values"]),
      condition: JSON.stringify({ str: { $in: ["1", "2", "3"] } }),
    });
  });

  it("adds missing condition for saved groups with a numeric attribute", () => {
    expect(
      migrateSavedGroup(
        {
          ...withValues,
          attributeKey: "num",
        },
        attributes
      )
    ).toEqual({
      ...omit(withValues, ["values"]),
      condition: JSON.stringify({ num: { $in: [1, 2, 3] } }),
    });
  });

  it("assumes string when attribute cannot be found", () => {
    expect(
      migrateSavedGroup(
        {
          ...withValues,
          attributeKey: "foo",
        },
        attributes
      )
    ).toEqual({
      ...omit(withValues, ["values"]),
      condition: JSON.stringify({ foo: { $in: ["1", "2", "3"] } }),
    });
  });

  it("assumes string when attribute is not a number or string", () => {
    expect(
      migrateSavedGroup({
        ...withValues,
        attributeKey: "str_arr",
      })
    ).toEqual({
      ...omit(withValues, ["values"]),
      condition: JSON.stringify({ str_arr: { $in: ["1", "2", "3"] } }),
    });
  });

  it("migrates runtime groups", () => {
    expect(migrateSavedGroup(runtimeGroup, attributes)).toEqual({
      ...omit(runtimeGroup, ["attributeKey", "source"]),
      condition: JSON.stringify({ $groups: { $elemMatch: { $eq: "admin" } } }),
    });
  });

  it("does not overwrite existing condition", () => {
    expect(
      migrateSavedGroup(
        {
          ...withValues,
          condition: JSON.stringify({ foo: "bar" }),
        },
        attributes
      )
    ).toEqual({
      ...omit(withValues, ["values", "attributeKey"]),
      condition: JSON.stringify({ foo: "bar" }),
    });
  });

  it("does nothing for saved groups already in the new format (no values)", () => {
    expect(migrateSavedGroup(withCondition, attributes)).toEqual(withCondition);
  });
});
