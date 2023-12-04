import { getLegacySavedGroupValues, isLegacySavedGroup } from "../../util";

describe("when getting legacy saved group values", () => {
  it("migrates legacy groups", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        "id"
      )
    ).toEqual(["1", "2", "3"]);
  });

  it("migrates legacy groups with numeric attribute", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: [1, 2, 3] },
        }),
        "id"
      )
    ).toEqual([1, 2, 3]);
  });

  it("returns empty when the wrong attribute is used", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        "device_id"
      )
    ).toEqual([]);
  });

  it("returns empty when the wrong operator is used", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $nin: ["1", "2", "3"] },
        }),
        "id"
      )
    ).toEqual([]);
  });

  it("returns empty when there's an extra attribute", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
          foo: "bar",
        }),
        "id"
      )
    ).toEqual([]);
  });

  it("returns empty when there's an extra operator", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: ["1", "2", "3"], $gt: 0 },
        }),
        "id"
      )
    ).toEqual([]);
  });

  it("returns empty when the attribute is empty", () => {
    expect(
      getLegacySavedGroupValues(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        ""
      )
    ).toEqual([]);
  });

  it("returns empty when the condition is an empty string", () => {
    expect(getLegacySavedGroupValues("", "id")).toEqual([]);
  });

  it("returns empty when the condition is an empty object", () => {
    expect(getLegacySavedGroupValues("{}", "id")).toEqual([]);
  });
});

describe("determines if a saved group is legacy", () => {
  it("detects legacy groups", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        "id"
      )
    ).toEqual(true);
  });

  it("detects legacy groups with an empty list", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: [] },
        }),
        "id"
      )
    ).toEqual(true);
  });

  it("detects legacy groups with numeric attribute", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: [1, 2, 3] },
        }),
        "id"
      )
    ).toEqual(true);
  });

  it("returns false when the wrong attribute is used", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        "device_id"
      )
    ).toEqual(false);
  });

  it("returns false when the wrong operator is used", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $nin: ["1", "2", "3"] },
        }),
        "id"
      )
    ).toEqual(false);
  });

  it("returns false when there's an extra attribute", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
          foo: "bar",
        }),
        "id"
      )
    ).toEqual(false);
  });

  it("returns false when there's an extra operator", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: ["1", "2", "3"], $gt: 0 },
        }),
        "id"
      )
    ).toEqual(false);
  });

  it("returns false when the attribute is empty", () => {
    expect(
      isLegacySavedGroup(
        JSON.stringify({
          id: { $in: ["1", "2", "3"] },
        }),
        ""
      )
    ).toEqual(false);
  });

  it("returns false when the condition is an empty string", () => {
    expect(isLegacySavedGroup("", "id")).toEqual(false);
  });

  it("returns false when the condition is an empty object", () => {
    expect(isLegacySavedGroup("{}", "id")).toEqual(false);
  });
});
