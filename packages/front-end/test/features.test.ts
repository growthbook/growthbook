import stringify from "json-stringify-pretty-compact";
import { AttributeData, condToJson, jsonToConds } from "@/services/features";

describe("json <-> conds", () => {
  const attributeMap: Map<string, AttributeData> = new Map();
  attributeMap.set("str", {
    attribute: "str",
    datatype: "string",
    array: false,
    enum: [],
    identifier: false,
    archived: false,
  });
  attributeMap.set("num", {
    attribute: "num",
    datatype: "number",
    array: false,
    enum: [],
    identifier: false,
    archived: false,
  });
  attributeMap.set("bool", {
    attribute: "bool",
    datatype: "boolean",
    array: false,
    enum: [],
    identifier: false,
    archived: false,
  });
  attributeMap.set("enum", {
    attribute: "enum",
    datatype: "string",
    array: false,
    enum: ["foo", "bar"],
    identifier: false,
    archived: false,
  });
  attributeMap.set("str_arr", {
    attribute: "str_arr",
    datatype: "string",
    array: true,
    enum: [],
    identifier: false,
    archived: false,
  });
  attributeMap.set("num_arr", {
    attribute: "num_arr",
    datatype: "number",
    array: true,
    enum: [],
    identifier: false,
    archived: false,
  });

  // Global operators
  it("$exists operator", () => {
    const json = stringify({ str: { $exists: true } });
    const conds = [[{ field: "str", operator: "$exists", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("$notExists operator", () => {
    const json = stringify({ str: { $exists: false } });
    const conds = [[{ field: "str", operator: "$notExists", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });

  // String operators
  it("string - simple eq", () => {
    const json = stringify({ str: "bar" });
    const conds = [[{ field: "str", operator: "$eq", value: "bar" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $eq operator", () => {
    const json = stringify({ str: { $eq: "bar" } });
    const conds = [[{ field: "str", operator: "$eq", value: "bar" }]];
    const simplifiedJSON = stringify({ str: "bar" });
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(simplifiedJSON);
  });
  it("string - $ne operator", () => {
    const json = stringify({ str: { $ne: "bar" } });
    const conds = [[{ field: "str", operator: "$ne", value: "bar" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $regex operator", () => {
    const json = stringify({ str: { $regex: "url\\.com" } });
    const conds = [[{ field: "str", operator: "$regex", value: "url\\.com" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $notRegex operator", () => {
    const json = stringify({ str: { $not: { $regex: "url\\.com" } } });
    const conds = [
      [{ field: "str", operator: "$notRegex", value: "url\\.com" }],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $gt operator", () => {
    const json = stringify({ str: { $gt: "abc" } });
    const conds = [[{ field: "str", operator: "$gt", value: "abc" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $in operator", () => {
    const json = stringify({ str: { $in: ["a", "b"] } });
    const conds = [[{ field: "str", operator: "$in", value: "a, b" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $nin operator", () => {
    const json = stringify({ str: { $nin: ["a", "b"] } });
    const conds = [[{ field: "str", operator: "$nin", value: "a, b" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $inGroup operator", () => {
    const json = stringify({ str: { $inGroup: "abc" } });
    const conds = [[{ field: "str", operator: "$inGroup", value: "abc" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("string - $notInGroup operator", () => {
    const json = stringify({ str: { $notInGroup: "abc" } });
    const conds = [[{ field: "str", operator: "$notInGroup", value: "abc" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });

  // Number operators
  it("number - simple eq", () => {
    const json = stringify({ num: 10 });
    const conds = [[{ field: "num", operator: "$eq", value: "10" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("number - $eq operator", () => {
    const json = stringify({ num: { $eq: 10 } });
    const conds = [[{ field: "num", operator: "$eq", value: "10" }]];
    const simplifiedJSON = stringify({ num: 10 });
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(simplifiedJSON);
  });
  it("number - $ne operator", () => {
    const json = stringify({ num: { $ne: 10 } });
    const conds = [[{ field: "num", operator: "$ne", value: "10" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("number - $gt operator", () => {
    const json = stringify({ num: { $gt: 10 } });
    const conds = [[{ field: "num", operator: "$gt", value: "10" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("number - $gt and $lt", () => {
    const json = stringify({ num: { $gt: 5, $lt: 10 } });
    const conds = [
      [
        { field: "num", operator: "$gt", value: "5" },
        { field: "num", operator: "$lt", value: "10" },
      ],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("number - $in operator", () => {
    const json = stringify({ num: { $in: [1, 2, 3] } });
    const conds = [[{ field: "num", operator: "$in", value: "1, 2, 3" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });

  // Boolean operators
  it("bool - simple true", () => {
    const json = stringify({ bool: true });
    const conds = [[{ field: "bool", operator: "$true", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("bool - $eq true", () => {
    const json = stringify({ bool: { $eq: true } });
    const conds = [[{ field: "bool", operator: "$true", value: "" }]];
    const simplifiedJson = stringify({ bool: true });
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(simplifiedJson);
  });
  it("bool - simple false", () => {
    const json = stringify({ bool: false });
    const conds = [[{ field: "bool", operator: "$false", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("bool - $eq false", () => {
    const json = stringify({ bool: { $eq: false } });
    const conds = [[{ field: "bool", operator: "$false", value: "" }]];
    const simplifiedJson = stringify({ bool: false });
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(simplifiedJson);
  });

  // Array operators
  it("str_arr - $includes", () => {
    const json = stringify({ str_arr: { $elemMatch: { $eq: "foo" } } });
    const conds = [[{ field: "str_arr", operator: "$includes", value: "foo" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("str_arr - $notIncludes", () => {
    const json = stringify({
      str_arr: { $not: { $elemMatch: { $eq: "foo" } } },
    });
    const conds = [
      [{ field: "str_arr", operator: "$notIncludes", value: "foo" }],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("str_arr - $empty", () => {
    const json = stringify({ str_arr: { $size: 0 } });
    const conds = [[{ field: "str_arr", operator: "$empty", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("str_arr - $notEmpty", () => {
    const json = stringify({ str_arr: { $size: { $gt: 0 } } });
    const conds = [[{ field: "str_arr", operator: "$notEmpty", value: "" }]];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("$savedGroups $in", () => {
    const json = stringify({ $savedGroups: ["sg_1", "sg_2"] });
    const conds = [
      [{ field: "$savedGroups", operator: "$in", value: "sg_1, sg_2" }],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("$savedGroups $nin", () => {
    const json = stringify({ $not: { $savedGroups: ["sg_1", "sg_2"] } });
    const conds = [
      [{ field: "$savedGroups", operator: "$nin", value: "sg_1, sg_2" }],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });
  it("$savedGroups merging", () => {
    const json = stringify({
      $savedGroups: ["sg_1", "sg_2"],
      $not: { $savedGroups: ["sg_3", "sg_4"] },
    });
    const conds = [
      [
        { field: "$savedGroups", operator: "$in", value: "sg_1" },
        { field: "$savedGroups", operator: "$in", value: "sg_2" },
        { field: "$savedGroups", operator: "$nin", value: "sg_3" },
        { field: "$savedGroups", operator: "$nin", value: "sg_4" },
      ],
    ];
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });

  it("$or operator", () => {
    const json = stringify({ $or: [{ num: 10 }, { num: 20 }] });
    const conds = [
      [{ field: "num", operator: "$eq", value: "10" }],
      [{ field: "num", operator: "$eq", value: "20" }],
    ];
    expect(jsonToConds(json, attributeMap)).toEqual(conds);
    expect(condToJson(conds, attributeMap)).toEqual(json);
  });

  // Advanced mode
  it("unknown attribute", () => {
    const json = stringify({ unknown: "foo" });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("double negative", () => {
    const json = stringify({ num: { $not: { $ne: 10 } } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("unknown operator", () => {
    const json = stringify({ num: { $foo: 10 } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("nested $or", () => {
    const json = stringify({ $or: [{ num: 10 }, { $or: [{ num: 20 }] }] });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("$or with other fields", () => {
    const json = stringify({ $or: [{ num: 10 }], num: 20 });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("$nor", () => {
    const json = stringify({ $nor: [{ num: 10 }] });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("null values", () => {
    const json = stringify({ str: null });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("array values", () => {
    const json = stringify({ str_arr: ["a", "b", "c"] });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("object values", () => {
    const json = stringify({ str_arr: { "0": "a" } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("$elemMatch null values", () => {
    const json = stringify({ str_arr: { $elemMatch: { $eq: null } } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("$not $elemMatch null values", () => {
    const json = stringify({
      str_arr: { $not: { $elemMatch: { $eq: null } } },
    });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("$not $regex null", () => {
    const json = stringify({ str: { $not: { $regex: null } } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  it("string - $in operator - string contains comma", () => {
    const json = stringify({ str: { $in: ["a,b", "c,d"] } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  /* TODO: This test case fails right now
  it("string - $in operator, commas", () => {
    const json = stringify({ str: { $in: ["a,", "b"] } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  */
  /* TODO: This test case fails right now
  it("number - $in operator, invalid types", () => {
    const json = stringify({ num: { $in: [1, "foo"] } });
    expect(jsonToConds(json, attributeMap)).toEqual(null);
  });
  */
});
