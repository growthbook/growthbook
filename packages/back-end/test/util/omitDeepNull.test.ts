import { omitDeepNull } from "back-end/src/util/omitDeepNull";

describe("omitDeepNull", () => {
  it("drops null leaves on objects", () => {
    expect(omitDeepNull({ a: 1, b: null })).toEqual({ a: 1 });
  });

  it("recurses into attributeSchema-like payloads", () => {
    expect(
      omitDeepNull({
        attributeSchema: [
          {
            property: "country",
            datatype: "string",
            description: null,
            format: null,
            projects: null,
          },
        ],
      }),
    ).toEqual({
      attributeSchema: [
        {
          property: "country",
          datatype: "string",
        },
      ],
    });
  });

  it("removes null entries from arrays", () => {
    expect(omitDeepNull({ items: [1, null, 2] })).toEqual({ items: [1, 2] });
  });

  it("preserves Date instances", () => {
    const d = new Date("2020-01-01T00:00:00.000Z");
    expect(omitDeepNull({ at: d })).toEqual({ at: d });
  });
});
