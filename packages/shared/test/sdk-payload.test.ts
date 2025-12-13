import { GroupMap, SavedGroupInterface } from "../types/groups";
import {
  conditionHasSavedGroupErrors,
  expandNestedSavedGroups,
  SAVED_GROUP_ERROR_CYCLE,
  SAVED_GROUP_ERROR_INVALID,
  SAVED_GROUP_ERROR_MAX_DEPTH,
  SAVED_GROUP_ERROR_UNKNOWN,
} from "../src/sdk-versioning";
import { recursiveWalk } from "../util";

describe("expandNestedSavedGroups", () => {
  it("allows valid nested saved groups", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({ country: "US" }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            browser: "chrome",
            $savedGroups: ["sg_1"],
          }),
        },
      }),
    );

    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, expandNestedSavedGroups(savedGroups));

    expect(condition).toEqual({
      $and: [{ os: "ios" }, { browser: "chrome" }, { country: "US" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });

  it("handles cycles in saved groups", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: JSON.stringify({
          $savedGroups: ["sg_2"],
        }),
      },
      sg_2: {
        id: "sg_2",
        type: "condition",
        condition: JSON.stringify({
          $savedGroups: ["sg_1"],
        }),
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      os: "ios",
      $savedGroups: ["sg_1"],
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, expandNestedSavedGroups(groupMap));
    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_CYCLE]: "sg_1" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles unknown saved groups", () => {
    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, expandNestedSavedGroups(new Map()));
    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_UNKNOWN]: "sg_2" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles conflicts in merged conditions", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: JSON.stringify({
          country: { $nin: ["US"] },
          bar: "baz",
        }),
      },
      sg_2: {
        id: "sg_2",
        type: "condition",
        condition: JSON.stringify({
          country: { $ne: "CA" },
          foo: "bar",
          $savedGroups: ["sg_1"],
        }),
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      $savedGroups: ["sg_2"],
      country: "GB",
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, expandNestedSavedGroups(groupMap));
    expect(condition).toEqual({
      $and: [
        { country: "GB" },
        { country: { $ne: "CA" }, foo: "bar" },
        {
          country: { $nin: ["US"] },
          bar: "baz",
        },
      ],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });

  it("handles max depth", () => {
    const savedGroups = {} as Record<string, SavedGroupInterface>;
    for (let i = 1; i <= 15; i++) {
      const nextId = i === 15 ? "" : `sg_${i + 1}`;
      savedGroups[`sg_${i}`] = {
        id: `sg_${i}`,
        type: "condition",
        condition: JSON.stringify({
          [`level${i}`]: true,
          $savedGroups: [nextId],
        }),
      } as SavedGroupInterface;
    }
    const condition = {
      $savedGroups: ["sg_1"],
    };
    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, expandNestedSavedGroups(groupMap));
    expect(condition).toEqual({
      $and: [
        { level1: true },
        { level2: true },
        { level3: true },
        { level4: true },
        { level5: true },
        { level6: true },
        { level7: true },
        { level8: true },
        { level9: true },
        { level10: true },
        { [SAVED_GROUP_ERROR_MAX_DEPTH]: true },
      ],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles nested saved group with invalid JSON", () => {
    const savedGroups = {
      sg_1: {
        id: "sg_1",
        type: "condition",
        condition: "{ invalidJson: true ",
      },
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      os: "ios",
      $savedGroups: ["sg_1"],
    };

    const groupMap = new Map(Object.entries(savedGroups));
    recursiveWalk(condition, expandNestedSavedGroups(groupMap));

    expect(condition).toEqual({
      $and: [{ os: "ios" }, { [SAVED_GROUP_ERROR_INVALID]: "sg_1" }],
    });

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("flattens empty $ands", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            $savedGroups: ["sg_1"],
          }),
        },
        sg_3: {
          id: "sg_3",
          type: "condition",
          condition: JSON.stringify({
            $savedGroups: ["sg_2"],
          }),
        },
      }),
    );

    const condition = {
      $savedGroups: ["sg_3"],
    };

    recursiveWalk(condition, expandNestedSavedGroups(savedGroups));

    expect(condition).toEqual({
      foo: "bar",
    });
  });
  it("merges into existing $and", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
        sg_2: {
          id: "sg_2",
          type: "condition",
          condition: JSON.stringify({
            bar: "baz",
            $savedGroups: ["sg_1"],
          }),
        },
      }),
    );

    const condition = {
      $and: [{ country: "US" }, { platform: "ios" }],
      $savedGroups: ["sg_2"],
    };
    recursiveWalk(condition, expandNestedSavedGroups(savedGroups));
    expect(condition).toEqual({
      $and: [
        { country: "US" },
        { platform: "ios" },
        { bar: "baz" },
        { foo: "bar" },
      ],
    });
    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });
  it("works with existing broken $and (non-array)", () => {
    const savedGroups: GroupMap = new Map(
      Object.entries({
        sg_1: {
          id: "sg_1",
          type: "condition",
          condition: JSON.stringify({
            foo: "bar",
          }),
        },
      }),
    );

    const condition = {
      $and: { country: "US" },
      $savedGroups: ["sg_1"],
    };
    recursiveWalk(condition, expandNestedSavedGroups(savedGroups));
    expect(condition).toEqual({
      $and: [{ $and: { country: "US" } }, { foo: "bar" }],
    });
    expect(conditionHasSavedGroupErrors(condition)).toBe(false);
  });
});
