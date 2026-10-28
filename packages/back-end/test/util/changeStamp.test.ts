import fs from "fs";
import path from "path";
import { withChangeStamp } from "back-end/src/util/changeStamp";

describe("withChangeStamp", () => {
  it("adds $set to an operator update", () => {
    expect(
      withChangeStamp({ $push: { members: { id: "u_1" } } }, "s1"),
    ).toEqual({
      $push: { members: { id: "u_1" } },
      $set: { changeStamp: "s1" },
    });
  });

  it("merges into an existing $set", () => {
    expect(
      withChangeStamp({ $set: { name: "A" }, $unset: { url: 1 } }, "s1"),
    ).toEqual({
      $set: { name: "A", changeStamp: "s1" },
      $unset: { url: 1 },
    });
  });

  it("stamps an $unset-only update", () => {
    expect(withChangeStamp({ $unset: { "settings.x": 1 } }, "s1")).toEqual({
      $unset: { "settings.x": 1 },
      $set: { changeStamp: "s1" },
    });
  });

  it("keeps implicit-set fields beside the new $set", () => {
    expect(withChangeStamp({ messages: [] }, "s1")).toEqual({
      messages: [],
      $set: { changeStamp: "s1" },
    });
  });

  it("overrides a stamp the caller passed", () => {
    expect(
      withChangeStamp(
        { changeStamp: "old", $set: { changeStamp: "old" } },
        "s1",
      ),
    ).toEqual({ $set: { changeStamp: "s1" } });
  });

  it("appends a $set stage to a pipeline", () => {
    expect(withChangeStamp([{ $set: { a: 1 } }], "s1")).toEqual([
      { $set: { a: 1 } },
      { $set: { changeStamp: "s1" } },
    ]);
  });

  it("stamps an empty or missing update", () => {
    expect(withChangeStamp({}, "s1")).toEqual({ $set: { changeStamp: "s1" } });
    expect(withChangeStamp(null, "s1")).toEqual({
      $set: { changeStamp: "s1" },
    });
  });

  it("never changes the caller's update", () => {
    const update = { $set: { name: "A" }, changeStamp: "old" };
    const pipeline = [{ $set: { a: 1 } }];
    withChangeStamp(update, "s1");
    withChangeStamp(pipeline, "s1");
    expect(update).toEqual({ $set: { name: "A" }, changeStamp: "old" });
    expect(pipeline).toEqual([{ $set: { a: 1 } }]);
  });
});

describe("OrganizationModel writes", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/models/OrganizationModel.ts"),
    "utf8",
  );

  it("only uses writes the changeStamp hook covers", () => {
    // Writes that skip the hook must set changeStamp themselves. Reads are fine.
    expect(source).not.toMatch(
      /\.(save|replaceOne|findOneAndReplace|bulkWrite|insertMany|deleteOne|deleteMany|findOneAndDelete|findOneAndRemove|findByIdAndUpdate|update)\(/,
    );
    // The raw driver skips mongoose middleware entirely
    const rawWrites = [
      ...source.matchAll(/getCollection\(COLLECTION\)\s*\.(\w+)\(/g),
    ]
      .map((m) => m[1])
      .filter(
        (method) => !/^(find|findOne|countDocuments|aggregate)$/.test(method),
      );
    expect(rawWrites).toEqual([]);
  });

  it("hooks every update method the model uses", () => {
    const hooked = source.match(/organizationSchema\.pre\(\s*\[([^\]]*)\]/);
    expect(hooked).not.toBeNull();
    const hookedMethods = (hooked?.[1] ?? "").match(/\w+/g) ?? [];
    const updates = [
      ...source.matchAll(
        /OrganizationModel\.(updateOne|updateMany|findOneAndUpdate)\(/g,
      ),
    ].map((m) => m[1]);
    expect(updates.length).toBeGreaterThan(0);
    for (const method of updates) expect(hookedMethods).toContain(method);
  });
});
