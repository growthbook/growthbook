import zlib from "zlib";
import {
  getSessionReplayEventsByStoragePrefix,
  parseChunkIndexFromKey,
  sortReplayChunkKeysByChunkIndex,
} from "back-end/src/services/session-replay";
import {
  listSessionReplayChunks,
  getSessionReplayObjectBuffer,
} from "back-end/src/services/files";

jest.mock("back-end/src/services/files", () => ({
  listSessionReplayChunks: jest.fn(),
  getSessionReplayObjectBuffer: jest.fn(),
}));

const mockListChunks = jest.mocked(listSessionReplayChunks);
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
// getSessionReplayEventsByStoragePrefix
// ---------------------------------------------------------------------------

describe("getSessionReplayEventsByStoragePrefix", () => {
  it("returns an empty array when there are no chunks", async () => {
    mockListChunks.mockResolvedValue([]);
    const result = await getSessionReplayEventsByStoragePrefix("org/session");
    expect(result).toEqual([]);
    expect(mockGetBuffer).not.toHaveBeenCalled();
  });

  it("decompresses and returns events from a single chunk", async () => {
    const events = [
      { type: 2, timestamp: 1000, data: { foo: "bar" } },
      { type: 3, timestamp: 2000, data: {} },
    ];
    mockListChunks.mockResolvedValue(["org/session/0.json.gz"]);
    mockGetBuffer.mockResolvedValue(gzip(events));

    const result = await getSessionReplayEventsByStoragePrefix("org/session");
    expect(result).toEqual(events);
  });

  it("concatenates events from multiple chunks in order", async () => {
    const chunk0 = [{ type: 2, timestamp: 100, data: {} }];
    const chunk1 = [{ type: 3, timestamp: 200, data: {} }];

    mockListChunks.mockResolvedValue([
      "org/session/0.json.gz",
      "org/session/1.json.gz",
    ]);
    mockGetBuffer
      .mockResolvedValueOnce(gzip(chunk0))
      .mockResolvedValueOnce(gzip(chunk1));

    const result = await getSessionReplayEventsByStoragePrefix("org/session");
    expect(result).toEqual([...chunk0, ...chunk1]);
  });

  it("sorts out-of-order chunk keys before fetching", async () => {
    const chunk0 = [{ type: 2, timestamp: 100, data: {} }];
    const chunk2 = [{ type: 5, timestamp: 300, data: {} }];

    // ClickHouse / S3 listing returns them out of order
    mockListChunks.mockResolvedValue([
      "org/session/2.json.gz",
      "org/session/0.json.gz",
    ]);

    // We need to know which buffer was requested for which key
    mockGetBuffer.mockImplementation(async (key: string) => {
      if (key === "org/session/0.json.gz") return gzip(chunk0);
      if (key === "org/session/2.json.gz") return gzip(chunk2);
      throw new Error(`unexpected key: ${key}`);
    });

    const result = await getSessionReplayEventsByStoragePrefix("org/session");
    // chunk0 events must precede chunk2 events
    expect(result).toEqual([...chunk0, ...chunk2]);
  });

  it("flattens events from all chunks into one array", async () => {
    const chunk0 = [
      { type: 1, timestamp: 1, data: {} },
      { type: 2, timestamp: 2, data: {} },
    ];
    const chunk1 = [{ type: 3, timestamp: 3, data: {} }];

    mockListChunks.mockResolvedValue([
      "org/session/0.json.gz",
      "org/session/1.json.gz",
    ]);
    mockGetBuffer
      .mockResolvedValueOnce(gzip(chunk0))
      .mockResolvedValueOnce(gzip(chunk1));

    const result = await getSessionReplayEventsByStoragePrefix("org/session");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(chunk0.length + chunk1.length);
  });

  it("throws when a chunk buffer cannot be decompressed", async () => {
    mockListChunks.mockResolvedValue(["org/session/0.json.gz"]);
    mockGetBuffer.mockResolvedValue(Buffer.from("not-gzip-data"));

    await expect(
      getSessionReplayEventsByStoragePrefix("org/session"),
    ).rejects.toThrow();
  });
});
