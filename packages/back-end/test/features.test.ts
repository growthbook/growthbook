import { replaceSavedGroupsInCondition } from "../src/util/features";

describe("replaceSavedGroupsInCondition", () => {
  it("replaces the $inGroup and groupId with $in and the array of IDs", () => {
    const rawCondition = '{ id: { $inGroup: "6323291eb4bb4f3035feff45" } }';

    const groupMap = new Map();

    groupMap.set("6323291eb4bb4f3035feff45", ["123", "345", "678", "91011"]);
    groupMap.set("6323293ab4bb4f3035feff53", [
      "dsfdf23",
      "234232sd",
      "23423ewr",
      "23423efrwe",
    ]);

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      "{ id: { $in: '6323291eb4bb4f3035feff45' } }"
    );
  });
});
