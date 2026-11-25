import zlib from "zlib";
import {
  dedupeNewestChunkRows,
  extractSortedChunkKeys,
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
// dedupeNewestChunkRows
// ---------------------------------------------------------------------------

describe("dedupeNewestChunkRows", () => {
  const row = (chunk_index: number, ingested_at: string, event_count = 0) => ({
    chunk_index,
    ingested_at,
    event_count,
  });

  // The recorder can reuse a session id and restart its chunk counter, so the
  // same index arrives twice. Summing both inflates every merged count.
  it("keeps only the newest row per chunk index", () => {
    const rows = dedupeNewestChunkRows([
      row(0, "2026-05-21 20:46:23", 19),
      row(0, "2026-05-21 22:36:46", 347),
      row(1, "2026-05-21 20:47:26", 423),
    ]);

    expect(rows.map((r) => r.event_count)).toEqual([347, 423]);
  });

  it("keeps the newest row regardless of input order", () => {
    const rows = dedupeNewestChunkRows([
      row(0, "2026-05-21 22:36:46", 347),
      row(0, "2026-05-21 20:46:23", 19),
    ]);

    expect(rows.map((r) => r.event_count)).toEqual([347]);
  });

  it("returns every row unchanged when no index repeats", () => {
    const rows = [row(0, "2026-05-21 20:46:23"), row(1, "2026-05-21 20:47:26")];
    expect(dedupeNewestChunkRows(rows)).toEqual(rows);
  });

  it("returns an empty array for no rows", () => {
    expect(dedupeNewestChunkRows([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractSortedChunkKeys
// ---------------------------------------------------------------------------

describe("extractSortedChunkKeys", () => {
  const row = (
    s3_key: string,
    chunk_index: number,
    ingested_at = "2026-01-01 00:00:00",
  ) => ({
    s3_key,
    chunk_index,
    ingested_at,
  });

  // The detail query has no ORDER BY, so rows arrive arbitrarily. Callers
  // slice the result by chunk range to load progressively, which is only
  // correct if the keys are in chunk-index order.
  it("sorts rows by chunk index, not lexicographically", () => {
    const keys = extractSortedChunkKeys([
      row("p/sess/2.json.gz", 2),
      row("p/sess/10.json.gz", 10),
      row("p/sess/0.json.gz", 0),
    ]);
    // 10 after 2 proves numeric ordering.
    expect(keys).toEqual([
      "p/sess/0.json.gz",
      "p/sess/2.json.gz",
      "p/sess/10.json.gz",
    ]);
  });

  // A row with no key would otherwise become an empty S3 lookup and fail the
  // whole session rather than just skipping that chunk.
  it("drops rows with an empty s3_key", () => {
    expect(
      extractSortedChunkKeys([row("p/sess/0.json.gz", 0), row("", 1)]),
    ).toEqual(["p/sess/0.json.gz"]);
  });

  it("returns an empty array for no rows", () => {
    expect(extractSortedChunkKeys([])).toEqual([]);
  });

  // The recorder can reuse a session id and restart its chunk counter, so the
  // same chunk arrives more than once. Each later upload overwrote the same S3
  // object, so the newest row is the one that matches what is stored — and
  // without collapsing them the player replays the chunk repeatedly.
  it("keeps only the newest row per chunk index", () => {
    const keys = extractSortedChunkKeys([
      row("p/sess/0.json.gz", 0, "2026-05-21 20:46:23"),
      row("p/sess/0.json.gz", 0, "2026-05-21 22:36:46"),
      row("p/sess/1.json.gz", 1, "2026-05-21 20:47:26"),
    ]);
    expect(keys).toEqual(["p/sess/0.json.gz", "p/sess/1.json.gz"]);
  });

  // The first ingestor stored the session prefix while still uploading to
  // {prefix}/{chunkIndex}.json.gz, so older rows point at a directory.
  it("reconstructs the object key for legacy prefix-only rows", () => {
    const prefix = "session-replays/org_1/2026/06/02/2b05477c";
    expect(extractSortedChunkKeys([row(prefix, 1), row(prefix, 0)])).toEqual([
      `${prefix}/0.json.gz`,
      `${prefix}/1.json.gz`,
    ]);
  });

  it("leaves a full object key untouched", () => {
    expect(extractSortedChunkKeys([row("p/sess/3.json.gz", 3)])).toEqual([
      "p/sess/3.json.gz",
    ]);
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
