import { getQueryTagString } from "back-end/src/util/integration";

describe("getQueryTagString", () => {
  const koreanMetadata = {
    experimentProject: "추천",
    experimentOwner: "실험담당자",
    experimentTags: ["구매전환"],
  };

  it("keeps non-ASCII characters as-is by default", () => {
    const tag = getQueryTagString(koreanMetadata, 2000);
    expect(tag).toBe(
      JSON.stringify({ application: "growthbook", ...koreanMetadata }),
    );
  });

  it("produces a printable ASCII value when encoded for an HTTP header", () => {
    const tag = getQueryTagString(koreanMetadata, 2000, encodeURIComponent);
    expect(tag).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(decodeURIComponent(tag))).toEqual({
      application: "growthbook",
      ...koreanMetadata,
    });
  });

  it("applies maxLength to the encoded value", () => {
    const metadata = {
      experimentOwner: "가".repeat(50),
      experimentTags: ["태그"],
    };
    const rawLength = JSON.stringify({
      application: "growthbook",
      ...metadata,
    }).length;

    const tag = getQueryTagString(metadata, rawLength, encodeURIComponent);

    expect(tag.length).toBeLessThanOrEqual(rawLength);
    expect(JSON.parse(decodeURIComponent(tag))).toEqual({
      application: "growthbook",
    });
  });
});
