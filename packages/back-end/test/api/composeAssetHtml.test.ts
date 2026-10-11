import { composeAssetHtml } from "back-end/src/enterprise/api/visual-editor-ai/postFigmaToVariant";

const asset = {
  url: "https://cdn.example.com/org/visual-editor/img_abc.svg",
  width: 64,
  height: 64,
};

describe("composeAssetHtml", () => {
  it("swaps a single sentinel for the asset", () => {
    const html = composeAssetHtml(
      `<div class="gb"><h2>Hi</h2>{{ASSET}}</div>`,
      asset,
    );
    expect(html).toBe(
      `<div class="gb"><h2>Hi</h2><img src="${asset.url}" alt="" width="64" height="64" /></div>`,
    );
  });

  it("omits width/height when the intrinsic size is unknown", () => {
    expect(composeAssetHtml("<div>{{ASSET}}</div>", { url: asset.url })).toBe(
      `<div><img src="${asset.url}" alt="" /></div>`,
    );
  });

  it("escapes the url and alt so they can't break out of the attribute", () => {
    const html = composeAssetHtml("<div>{{ASSET}}</div>", {
      url: "https://x.test/a.png?a=1&b=2",
      alt: `a "quoted" <tag>`,
    });
    expect(html).toContain(`src="https://x.test/a.png?a=1&amp;b=2"`);
    expect(html).toContain(`alt="a &quot;quoted&quot; &lt;tag&gt;"`);
  });

  it("treats a $ sequence in the url literally", () => {
    const html = composeAssetHtml("<div>{{ASSET}}</div>", {
      url: "https://x.test/$&a.png",
    });
    expect(html).toContain(`src="https://x.test/$&amp;a.png"`);
  });

  it("rejects a response with no sentinel", () => {
    expect(
      composeAssetHtml(`<div><img src="https://evil/x.png"></div>`, asset),
    ).toBeNull();
  });

  it("rejects more than one sentinel rather than duplicating the image", () => {
    expect(composeAssetHtml("<div>{{ASSET}}{{ASSET}}</div>", asset)).toBeNull();
  });

  it("rejects a sentinel inside a tag", () => {
    expect(composeAssetHtml(`<div title="{{ASSET}}"></div>`, asset)).toBeNull();
  });

  it("rejects a sentinel inside a comment", () => {
    expect(composeAssetHtml("<div><!-- {{ASSET}} --></div>", asset)).toBeNull();
    // A `>` inside the comment must not make it look like element content.
    expect(
      composeAssetHtml("<div><!-- a > b {{ASSET}} --></div>", asset),
    ).toBeNull();
  });
});
