import {
  getQueryStringOverride,
  getBucketRanges,
  chooseVariation,
  hashFnv32a,
  inNamespace,
} from "../src/util";

describe("utils", () => {
  it("bucket ranges", () => {
    // Normal 50/50 split
    expect(getBucketRanges(2, 1)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    // Reduced coverage
    expect(getBucketRanges(2, 0.5)).toEqual([
      [0, 0.25],
      [0.5, 0.75],
    ]);

    // Zero coverage
    expect(getBucketRanges(2, 0)).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);

    // More variations
    expect(getBucketRanges(4, 1)).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);

    // Uneven weights
    expect(getBucketRanges(2, 1, [0.4, 0.6])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ]);

    // Uneven weights, more variations
    expect(getBucketRanges(3, 1, [0.2, 0.3, 0.5])).toEqual([
      [0, 0.2],
      [0.2, 0.5],
      [0.5, 1],
    ]);

    // Uneven weights, more variations, reduced coverage
    expect(getBucketRanges(3, 0.2, [0.2, 0.3, 0.5])).toEqual([
      [0, 0.2 * 0.2],
      [0.2, 0.2 + 0.3 * 0.2],
      [0.5, 0.5 + 0.5 * 0.2],
    ]);
  });
  it("choose variation", () => {
    const evenRange: [number, number][] = [
      [0, 0.5],
      [0.5, 1],
    ];
    const reducedRange: [number, number][] = [
      [0, 0.25],
      [0.5, 0.75],
    ];
    const zeroRange: [number, number][] = [
      [0, 0.5],
      [0.5, 0.5],
      [0.5, 1],
    ];

    expect(chooseVariation(0.2, evenRange)).toEqual(0);
    expect(chooseVariation(0.6, evenRange)).toEqual(1);
    expect(chooseVariation(0.4, evenRange)).toEqual(0);
    expect(chooseVariation(0.8, evenRange)).toEqual(1);
    expect(chooseVariation(0, evenRange)).toEqual(0);
    expect(chooseVariation(0.5, evenRange)).toEqual(1);

    expect(chooseVariation(0.2, reducedRange)).toEqual(0);
    expect(chooseVariation(0.6, reducedRange)).toEqual(1);
    expect(chooseVariation(0.4, reducedRange)).toEqual(-1);
    expect(chooseVariation(0.8, reducedRange)).toEqual(-1);

    expect(chooseVariation(0.5, zeroRange)).toEqual(2);
  });

  it("hashing", () => {
    expect(hashFnv32a("a") % 1000).toEqual(220);
    expect(hashFnv32a("b") % 1000).toEqual(77);
    expect(hashFnv32a("ab") % 1000).toEqual(946);
    expect(hashFnv32a("def") % 1000).toEqual(652);
    expect(hashFnv32a("8952klfjas09ujkasdf") % 1000).toEqual(549);
    expect(hashFnv32a("123") % 1000).toEqual(11);
    expect(hashFnv32a('___)((*":&') % 1000).toEqual(563);
  });

  it("persists assignment when coverage changes", () => {
    expect(getBucketRanges(2, 0.1, [0.4, 0.6])).toEqual([
      [0, 0.4 * 0.1],
      [0.4, 0.4 + 0.6 * 0.1],
    ]);

    expect(getBucketRanges(2, 1, [0.4, 0.6])).toEqual([
      [0, 0.4],
      [0.4, 1],
    ]);
  });

  it("handles weird experiment values", () => {
    const spy = jest.spyOn(console, "error").mockImplementation();

    expect(getBucketRanges(2, -0.2)).toEqual([
      [0, 0],
      [0.5, 0.5],
    ]);

    expect(getBucketRanges(2, 1.5)).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(2, 1, [0.4, 0.1])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(2, 1, [0.7, 0.6])).toEqual([
      [0, 0.5],
      [0.5, 1],
    ]);

    expect(getBucketRanges(4, 1, [0.4, 0.4, 0.2])).toEqual([
      [0, 0.25],
      [0.25, 0.5],
      [0.5, 0.75],
      [0.75, 1],
    ]);

    spy.mockRestore();
  });

  it("querystring force invalid url", () => {
    expect(getQueryStringOverride("my-test", "")).toEqual(null);

    expect(getQueryStringOverride("my-test", "http://example.com")).toEqual(
      null
    );

    expect(getQueryStringOverride("my-test", "http://example.com?")).toEqual(
      null
    );

    expect(
      getQueryStringOverride("my-test", "http://example.com?somequery")
    ).toEqual(null);

    expect(
      getQueryStringOverride("my-test", "http://example.com??&&&?#")
    ).toEqual(null);
  });

  it("calculates namespace inclusion correctly", () => {
    let included = 0;
    for (let i = 0; i < 10000; i++) {
      if (inNamespace(i + "", ["namespace1", 0, 0.4])) {
        included++;
      }
    }
    expect(included).toEqual(4042);

    included = 0;
    for (let i = 0; i < 10000; i++) {
      if (inNamespace(i + "", ["namespace1", 0.4, 1])) {
        included++;
      }
    }
    expect(included).toEqual(5958);

    included = 0;
    for (let i = 0; i < 10000; i++) {
      if (inNamespace(i + "", ["namespace2", 0, 0.4])) {
        included++;
      }
    }
    expect(included).toEqual(3984);
  });
});
