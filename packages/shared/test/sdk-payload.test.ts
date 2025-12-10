import { SavedGroupInterface } from "../types/groups";
import {
  conditionHasSavedGroupErrors,
  replaceSavedGroups,
} from "../src/sdk-versioning";
import { isSavedGroupCyclic, recursiveWalk } from "../util";

describe("replaceSavedGroups", () => {
  it("allows valid nested saved groups", () => {
    const savedGroups = {
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
    } as unknown as Record<string, SavedGroupInterface>;

    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, replaceSavedGroups(savedGroups, {}));

    expect(condition).toEqual({
      os: "ios",
      country: "US",
      browser: "chrome",
    });

    expect(isSavedGroupCyclic(JSON.stringify(condition), savedGroups)).toEqual([
      false,
      null,
    ]);

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

    recursiveWalk(condition, replaceSavedGroups(savedGroups, {}));
    expect(condition).toEqual({
      os: "ios",
      __sgCycle__: "sg_1",
    });

    expect(isSavedGroupCyclic(JSON.stringify(condition), savedGroups)).toEqual([
      true,
      "sg_1",
    ]);

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });

  it("handles unknown saved groups", () => {
    const condition = {
      os: "ios",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, replaceSavedGroups({}, {}));
    expect(condition).toEqual({
      os: "ios",
      __sgUnknown__: "sg_2",
    });
    expect(isSavedGroupCyclic(JSON.stringify(condition), {})).toEqual([
      false,
      null,
    ]);

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
      country: "GB",
      $savedGroups: ["sg_2"],
    };

    recursiveWalk(condition, replaceSavedGroups(savedGroups, {}));
    expect(condition).toEqual({
      country: "GB",
      foo: "bar",
      bar: "baz",
      $and: [{ country: { $ne: "CA" } }, { country: { $nin: ["US"] } }],
    });

    expect(isSavedGroupCyclic(JSON.stringify(condition), savedGroups)).toEqual([
      false,
      null,
    ]);

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
    recursiveWalk(condition, replaceSavedGroups(savedGroups, {}));
    expect(condition).toEqual({
      level1: true,
      level2: true,
      level3: true,
      level4: true,
      level5: true,
      level6: true,
      level7: true,
      level8: true,
      level9: true,
      level10: true,
      __sgMaxDepth__: true,
    });

    expect(isSavedGroupCyclic(JSON.stringify(condition), savedGroups)).toEqual([
      true,
      null,
    ]);

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

    recursiveWalk(condition, replaceSavedGroups(savedGroups, {}));

    expect(condition).toEqual({
      os: "ios",
      __sgInvalid__: "sg_1",
    });

    expect(isSavedGroupCyclic(JSON.stringify(condition), savedGroups)).toEqual([
      false,
      null,
    ]);

    expect(conditionHasSavedGroupErrors(condition)).toBe(true);
  });
});
