import omit from "lodash/omit";
import { LegacySavedGroup, migrateSavedGroup } from "../src/util/migrations";
import { SDKAttributeSchema } from "../types/organization";

describe("Saved Group Migration", () => {
  const baseGroup: LegacySavedGroup = {
    attributeKey: "str",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    groupName: "My Group",
    id: "grp_abc123",
    organization: "org_abc123",
    owner: "",
    values: ["1", "2", "3"],
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

  it("adds missing source/condition for legacy saved groups", () => {
    expect(migrateSavedGroup(baseGroup, attributes)).toEqual({
      ...baseGroup,
      source: "inline",
      condition: JSON.stringify({ str: { $in: ["1", "2", "3"] } }),
    });
  });

  it("adds missing source/condition for legacy saved groups with a numeric attribute", () => {
    expect(
      migrateSavedGroup(
        {
          ...baseGroup,
          attributeKey: "num",
        },
        attributes
      )
    ).toEqual({
      ...baseGroup,
      attributeKey: "num",
      source: "inline",
      condition: JSON.stringify({ num: { $in: [1, 2, 3] } }),
    });
  });

  it("assumes string when attribute cannot be found", () => {
    expect(
      migrateSavedGroup(
        {
          ...baseGroup,
          attributeKey: "foo",
        },
        attributes
      )
    ).toEqual({
      ...baseGroup,
      attributeKey: "foo",
      source: "inline",
      condition: JSON.stringify({ foo: { $in: ["1", "2", "3"] } }),
    });
  });

  it("assumes string when attribute is not a number or string", () => {
    expect(
      migrateSavedGroup({
        ...baseGroup,
        attributeKey: "str_arr",
      })
    ).toEqual({
      ...baseGroup,
      attributeKey: "str_arr",
      source: "inline",
      condition: JSON.stringify({ str_arr: { $in: ["1", "2", "3"] } }),
    });
  });

  it("does not add a condition for a runtime group", () => {
    expect(
      migrateSavedGroup({
        ...omit(baseGroup, ["values"]),
        attributeKey: "admin",
        source: "runtime",
      })
    ).toEqual({
      ...omit(baseGroup, ["values"]),
      attributeKey: "admin",
      source: "runtime",
      condition: "",
    });
  });

  it("migrates condition when source is already inline", () => {
    expect(
      migrateSavedGroup(
        {
          ...baseGroup,
          attributeKey: "num",
          source: "inline",
        },
        attributes
      )
    ).toEqual({
      ...baseGroup,
      attributeKey: "num",
      source: "inline",
      condition: JSON.stringify({ num: { $in: [1, 2, 3] } }),
    });
  });

  it("does not overwrite existing condition", () => {
    expect(
      migrateSavedGroup(
        {
          ...baseGroup,
          attributeKey: "num",
          source: "inline",
          condition: JSON.stringify({ foo: "bar" }),
        },
        attributes
      )
    ).toEqual({
      ...baseGroup,
      attributeKey: "num",
      source: "inline",
      condition: JSON.stringify({ foo: "bar" }),
    });
  });

  it("does nothing for saved groups already in the new format (no values)", () => {
    expect(
      migrateSavedGroup(
        {
          ...omit(baseGroup, ["values"]),
          attributeKey: "",
          source: "inline",
          condition: JSON.stringify({ str: { $in: ["1", "2", "3"] } }),
        },
        attributes
      )
    ).toEqual({
      ...omit(baseGroup, ["values"]),
      attributeKey: "",
      source: "inline",
      condition: JSON.stringify({ str: { $in: ["1", "2", "3"] } }),
    });
  });
});
