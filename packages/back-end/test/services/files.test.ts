import path from "path";
import fs from "fs";
import {
  copyFile,
  deleteFile,
  getFileSize,
  getUploadsDir,
  readFileRange,
  readFileStream,
  resolveUploadPath,
  uploadFile,
} from "back-end/src/services/files";
import { s3FileStorage } from "back-end/src/services/files/s3";
import { DestinationConfig } from "back-end/src/services/files/config";

// Commands keep their input, so tests can check what was sent.
const mockSend = jest.fn();
jest.mock("@aws-sdk/client-s3", () => {
  const command = class {
    constructor(public input: unknown) {}
  };
  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    GetObjectCommand: command,
    HeadObjectCommand: command,
    CopyObjectCommand: command,
    PutObjectCommand: command,
    DeleteObjectCommand: command,
    ListObjectsV2Command: command,
  };
});

describe("resolveUploadPath", () => {
  const root = getUploadsDir();

  it("resolves a normal key under the uploads dir", () => {
    const key = "org_abc/2025-06/img_uuid.jpeg";
    expect(resolveUploadPath(key)).toBe(path.join(root, key));
  });

  it("returns the root dir for an empty key", () => {
    expect(resolveUploadPath("")).toBe(root);
  });

  it("allows in-bounds traversal that stays under the uploads dir", () => {
    // Cross-org containment is enforced at the controller layer, not here —
    // this only guarantees the path doesn't escape the uploads dir.
    expect(resolveUploadPath("org_a/../org_b/x")).toBe(
      path.join(root, "org_b/x"),
    );
  });

  it.each([
    ["../../etc/passwd"],
    ["../uploads-evil/key"], // sibling-prefix: must not pass a bare prefix match
    ["org_a/../../secrets"],
  ])("throws when %p escapes the uploads dir", (key) => {
    expect(() => resolveUploadPath(key)).toThrow(
      "Path must not escape out of the 'uploads' directory.",
    );
  });
});

// Tests run with UPLOAD_METHOD=local, so the helpers use the uploads dir.
describe("file helpers (local storage)", () => {
  const prefix = `test-files-${process.pid}`;
  const key = (name: string) => `${prefix}/${name}`;

  beforeEach(async () => {
    await uploadFile(key("src.csv"), "text/csv", Buffer.from("0123456789"));
  });
  afterAll(async () => {
    await fs.promises.rm(path.join(getUploadsDir(), prefix), {
      recursive: true,
      force: true,
    });
  });

  it("gets a file's size, or null when it's missing", async () => {
    expect(await getFileSize(key("src.csv"))).toBe(10);
    expect(await getFileSize(key("missing.csv"))).toBeNull();
  });

  it("reads an inclusive range, cut short at the end of the file", async () => {
    expect((await readFileRange(key("src.csv"), 2, 4)).toString()).toBe("234");
    expect((await readFileRange(key("src.csv"), 8, 20)).toString()).toBe("89");
  });

  it("streams the whole file", async () => {
    const chunks: Uint8Array[] = [];
    for await (const chunk of readFileStream(key("src.csv"))) {
      chunks.push(chunk);
    }
    expect(Buffer.concat(chunks).toString()).toBe("0123456789");
  });

  it("copies a file, leaving the source", async () => {
    await copyFile(key("src.csv"), key("copy/dest.csv"));
    expect(await getFileSize(key("copy/dest.csv"))).toBe(10);
    expect(await getFileSize(key("src.csv"))).toBe(10);
  });

  it("fails to copy a missing file", async () => {
    await expect(
      copyFile(key("missing.csv"), key("dest.csv")),
    ).rejects.toThrow();
  });

  it("deletes a file, ignoring missing ones", async () => {
    await deleteFile(key("src.csv"));
    expect(await getFileSize(key("src.csv"))).toBeNull();
    await expect(deleteFile(key("src.csv"))).resolves.toBeUndefined();
  });

  it("rejects keys that escape the uploads dir", async () => {
    await expect(readFileRange("../secrets", 0, 1)).rejects.toThrow();
    await expect(copyFile(key("src.csv"), "../evil")).rejects.toThrow();
  });
});

describe("s3FileStorage", () => {
  const cfg: DestinationConfig = {
    s3Bucket: "bucket",
    s3Region: "us-east-1",
    s3Domain: "",
    gcsBucket: "",
    gcsDomain: "",
    cacheControl: undefined,
  };
  afterEach(() => mockSend.mockReset());

  const sentInput = () => mockSend.mock.calls[0][0].input;

  it("reads a range with an inclusive Range header", async () => {
    mockSend.mockImplementation(async () => ({
      Body: (async function* () {
        yield Buffer.from("234");
      })(),
    }));
    const contents = await s3FileStorage.readRange("a/b.csv", 2, 4, cfg);
    expect(contents.toString()).toBe("234");
    expect(sentInput()).toEqual({
      Bucket: "bucket",
      Key: "a/b.csv",
      Range: "bytes=2-4",
    });
  });

  it("gets the size from a HEAD request", async () => {
    mockSend.mockImplementation(async () => ({ ContentLength: 42 }));
    expect(await s3FileStorage.getSize("a/b.csv", cfg)).toBe(42);
    expect(sentInput()).toEqual({ Bucket: "bucket", Key: "a/b.csv" });
  });

  it("copies with an encoded CopySource", async () => {
    mockSend.mockImplementation(async () => ({}));
    await s3FileStorage.copy("a/b c.csv", "a/d.csv", cfg);
    expect(sentInput()).toEqual({
      Bucket: "bucket",
      CopySource: "bucket/a/b%20c.csv",
      Key: "a/d.csv",
    });
  });

  it("passes storage errors through", async () => {
    mockSend.mockImplementation(async () => {
      throw new Error("NoSuchKey");
    });
    await expect(s3FileStorage.getSize("a/b.csv", cfg)).rejects.toThrow(
      "NoSuchKey",
    );
  });
});
