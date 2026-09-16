import fs from "fs";
import { DiscussionModel } from "back-end/src/models/DiscussionModel";
import {
  cleanupDeletedDiscussionUploads,
  getConfiguredApiOrigin,
  getDiscussionUploadUrls,
} from "back-end/src/services/discussionFiles";
import {
  deleteFile,
  resolveUploadPath,
  uploadFile,
} from "back-end/src/services/files";

jest.mock("back-end/src/models/DiscussionModel", () => ({
  DiscussionModel: { exists: jest.fn() },
}));
jest.mock("back-end/src/util/logger", () => ({
  logger: { error: jest.fn() },
}));

describe("getConfiguredApiOrigin", () => {
  const originalApiHost = process.env.API_HOST;

  afterEach(() => {
    if (originalApiHost === undefined) {
      delete process.env.API_HOST;
    } else {
      process.env.API_HOST = originalApiHost;
    }
  });

  it("uses the configured public API host without trailing slashes", () => {
    process.env.API_HOST = "https://api.growthbook.company.com///";

    expect(getConfiguredApiOrigin()).toBe("https://api.growthbook.company.com");
  });
});

describe("getDiscussionUploadUrls", () => {
  const organization = "org_test";
  const prefix = "https://api.example.com/upload/";
  const key = "org_test/2026-09/img_123e4567-e89b-12d3-a456-426614174000.jpeg";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await deleteFile(key);
  });

  it("extracts generated uploads from Markdown images", () => {
    const uploads = getDiscussionUploadUrls(
      `Before ![screenshot](${prefix}${key}) after`,
      organization,
      [prefix],
    );

    expect(Array.from(uploads)).toEqual([[key, `${prefix}${key}`]]);
  });

  it("deduplicates repeated image references", () => {
    const url = `${prefix}${key}`;
    const uploads = getDiscussionUploadUrls(
      `![first](${url}) ![second](${url})`,
      organization,
      [prefix],
    );

    expect(Array.from(uploads)).toEqual([[key, url]]);
  });

  it.each([
    ["a normal link", `[image](${prefix}${key})`],
    ["an external image", `![image](https://example.com/${key})`],
    [
      "another organization's upload",
      `![image](${prefix}${key.replace("org_test", "org_other")})`,
    ],
    [
      "a non-generated upload path",
      `![image](${prefix}org_test/2026-09/manual.jpeg)`,
    ],
  ])("ignores %s", (_description, content) => {
    expect(getDiscussionUploadUrls(content, organization, [prefix]).size).toBe(
      0,
    );
  });

  it("deletes an upload after its final discussion reference is removed", async () => {
    jest.mocked(DiscussionModel.exists).mockResolvedValueOnce(null);
    await uploadFile(key, "image/jpeg", Buffer.from("image"));

    await cleanupDeletedDiscussionUploads({
      content: `![image](${prefix}${key})`,
      organization,
      localOrigin: "https://api.example.com",
    });

    expect(DiscussionModel.exists).toHaveBeenCalledWith({
      organization,
      "comments.content": {
        $regex:
          "org_test/2026-09/img_123e4567-e89b-12d3-a456-426614174000\\.jpeg",
      },
    });
    expect(fs.existsSync(resolveUploadPath(key))).toBe(false);
  });

  it("keeps an upload referenced through a different URL form", async () => {
    jest.mocked(DiscussionModel.exists).mockResolvedValueOnce({ _id: "ref" });
    await uploadFile(key, "image/jpeg", Buffer.from("image"));

    await cleanupDeletedDiscussionUploads({
      content: `![image](${prefix}${key})`,
      organization,
      localOrigin: "https://api.example.com",
    });

    expect(DiscussionModel.exists).toHaveBeenCalledWith({
      organization,
      "comments.content": {
        $regex:
          "org_test/2026-09/img_123e4567-e89b-12d3-a456-426614174000\\.jpeg",
      },
    });
    expect(fs.existsSync(resolveUploadPath(key))).toBe(true);
  });
});
