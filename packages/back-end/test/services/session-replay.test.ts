import zlib from "zlib";
import {
  filterClientKeysByProject,
  getSessionReplayEventsByChunkKeys,
  parseChunkIndexFromKey,
  sortReplayChunkKeysByChunkIndex,
} from "back-end/src/services/session-replay";
import { getSessionReplayObjectBuffer } from "back-end/src/services/files";

jest.mock("back-end/src/services/files", () => ({
  getSessionReplayObjectBuffer: jest.fn(),
}));

const mockGetBuffer = jest.mocked(getSessionReplayObjectBuffer);

function gzip(events: unknown[]): Buffer {
  return zlib.gzipSync(Buffer.from(JSON.stringify(events)));
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// parseChunkIndexFromKey
// ---------------------------------------------------------------------------

describe("parseChunkIndexFromKey", () => {
  it("extracts a numeric index from a path with subdirectories", () => {
    expect(parseChunkIndexFromKey("org/session/3.json.gz")).toBe(3);
  });

  it("extracts zero index", () => {
    expect(parseChunkIndexFromKey("org/session/0.json.gz")).toBe(0);
  });

  it("extracts a large index", () => {
    expect(parseChunkIndexFromKey("org/session/999.json.gz")).toBe(999);
  });

  it("works with no path prefix (bare filename)", () => {
    expect(parseChunkIndexFromKey("42.json.gz")).toBe(42);
  });

  it("returns 0 for a non-numeric filename", () => {
    expect(parseChunkIndexFromKey("org/session/meta.json.gz")).toBe(0);
  });

  it("returns 0 for an empty string", () => {
    expect(parseChunkIndexFromKey("")).toBe(0);
  });

  it("returns 0 when path ends with a trailing slash (empty filename segment)", () => {
    expect(parseChunkIndexFromKey("org/session/")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sortReplayChunkKeysByChunkIndex
// ---------------------------------------------------------------------------

describe("sortReplayChunkKeysByChunkIndex", () => {
  it("returns an already-sorted list unchanged", () => {
    const keys = ["s/1.json.gz", "s/2.json.gz", "s/3.json.gz"];
    expect(sortReplayChunkKeysByChunkIndex(keys)).toEqual([
      "s/1.json.gz",
      "s/2.json.gz",
      "s/3.json.gz",
    ]);
  });

  it("sorts a reversed list into ascending order", () => {
    const keys = ["s/3.json.gz", "s/1.json.gz", "s/2.json.gz"];
    expect(sortReplayChunkKeysByChunkIndex(keys)).toEqual([
      "s/1.json.gz",
      "s/2.json.gz",
      "s/3.json.gz",
    ]);
  });

  it("handles a single element", () => {
    expect(sortReplayChunkKeysByChunkIndex(["s/0.json.gz"])).toEqual([
      "s/0.json.gz",
    ]);
  });

  it("handles an empty array", () => {
    expect(sortReplayChunkKeysByChunkIndex([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const keys = ["s/3.json.gz", "s/1.json.gz"];
    const original = [...keys];
    sortReplayChunkKeysByChunkIndex(keys);
    expect(keys).toEqual(original);
  });

  it("non-numeric filenames sort as index 0 (alongside true zero-index)", () => {
    const keys = ["s/meta.json.gz", "s/2.json.gz", "s/0.json.gz"];
    const sorted = sortReplayChunkKeysByChunkIndex(keys);
    // Both meta and 0 resolve to index 0, so 2 must be last
    expect(sorted.indexOf("s/2.json.gz")).toBe(2);
    expect(sorted.indexOf("s/meta.json.gz")).toBeLessThan(2);
    expect(sorted.indexOf("s/0.json.gz")).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// getSessionReplayEventsByChunkKeys
// ---------------------------------------------------------------------------

describe("getSessionReplayEventsByChunkKeys", () => {
  it("returns an empty array when given no keys", async () => {
    const result = await getSessionReplayEventsByChunkKeys([], "us-east-1");
    expect(result).toEqual([]);
    expect(mockGetBuffer).not.toHaveBeenCalled();
  });

  it("sorts out-of-order chunk keys before concatenating", async () => {
    const chunk0 = [{ type: 2, timestamp: 100, data: {} }];
    const chunk2 = [{ type: 5, timestamp: 300, data: {} }];

    mockGetBuffer.mockImplementation(async (key: string) => {
      if (key === "org/session/0.json.gz") return gzip(chunk0);
      if (key === "org/session/2.json.gz") return gzip(chunk2);
      throw new Error(`unexpected key: ${key}`);
    });

    const result = await getSessionReplayEventsByChunkKeys(
      ["org/session/2.json.gz", "org/session/0.json.gz"],
      "us-east-1",
    );
    expect(result).toEqual([...chunk0, ...chunk2]);
  });

  // The S3 listing this replaces was a single unpaginated ListObjectsV2,
  // so a session past 1000 chunks silently lost its tail.
  it("handles more chunks than an unpaginated S3 listing would return", async () => {
    const total = 1500;
    const keys = Array.from(
      { length: total },
      (_, i) => `org/session/${i}.json.gz`,
    );
    mockGetBuffer.mockImplementation(async (key: string) => {
      const i = parseChunkIndexFromKey(key);
      return gzip([{ type: 3, timestamp: i, data: {} }]);
    });

    const result = await getSessionReplayEventsByChunkKeys(keys, "us-east-1");

    expect(result).toHaveLength(total);
    expect((result[0] as { timestamp: number }).timestamp).toBe(0);
    expect((result[total - 1] as { timestamp: number }).timestamp).toBe(
      total - 1,
    );
  });

  it("bounds how many chunks are fetched concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    mockGetBuffer.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      return gzip([{ type: 3, timestamp: 1, data: {} }]);
    });

    const keys = Array.from(
      { length: 200 },
      (_, i) => `org/session/${i}.json.gz`,
    );
    await getSessionReplayEventsByChunkKeys(keys, "us-east-1");

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(24);
  });

  it("throws when a chunk buffer cannot be decompressed", async () => {
    mockGetBuffer.mockResolvedValue(Buffer.from("not-gzip-data"));

    await expect(
      getSessionReplayEventsByChunkKeys(["org/session/0.json.gz"], "us-east-1"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// filterClientKeysByProject
// ---------------------------------------------------------------------------

describe("filterClientKeysByProject", () => {
  const permittedKeys = new Map([
    ["sdk-abc", ["prj_1", "prj_2"]],
    ["sdk-def", ["prj_2", "prj_3"]],
    ["sdk-ghi", []], // empty = all projects
    ["sdk-jkl", ["prj_1"]],
  ]);

  it("returns all keys when no project filter is specified", () => {
    const result = filterClientKeysByProject(permittedKeys);
    expect(result).toEqual(["sdk-abc", "sdk-def", "sdk-ghi", "sdk-jkl"]);
  });

  it("returns all keys when project is empty string", () => {
    const result = filterClientKeysByProject(permittedKeys, "");
    expect(result).toEqual(["sdk-abc", "sdk-def", "sdk-ghi", "sdk-jkl"]);
  });

  it("filters to connections that include the specified project", () => {
    const result = filterClientKeysByProject(permittedKeys, "prj_1");
    expect(result).toEqual(["sdk-abc", "sdk-ghi", "sdk-jkl"]);
  });

  it("always includes connections with empty projects (all-projects)", () => {
    const result = filterClientKeysByProject(permittedKeys, "prj_3");
    expect(result).toEqual(["sdk-def", "sdk-ghi"]);
  });

  it("returns only all-projects connections when project matches none", () => {
    const result = filterClientKeysByProject(permittedKeys, "prj_unknown");
    expect(result).toEqual(["sdk-ghi"]);
  });

  it("returns empty array when map is empty", () => {
    const result = filterClientKeysByProject(new Map(), "prj_1");
    expect(result).toEqual([]);
  });

  it("returns empty when no connections match and none are all-projects", () => {
    const noGlobal = new Map([
      ["sdk-abc", ["prj_1"]],
      ["sdk-def", ["prj_2"]],
    ]);
    const result = filterClientKeysByProject(noGlobal, "prj_99");
    expect(result).toEqual([]);
  });
});
