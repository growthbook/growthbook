import { MAX_ID_LENGTH } from "../src/constants";
import { parseRemoteGroupCsv } from "../src/parser";
import { RemoteGroupCsvOptions } from "../src/types";

const encode = (s: string) => new TextEncoder().encode(s);

// Splits bytes into chunks of `size`, to cross line and character boundaries.
function chunked(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    chunks.push(bytes.subarray(i, i + size));
  }
  return chunks;
}

const options: RemoteGroupCsvOptions = {
  attributeKey: "account_id",
  numeric: false,
};

describe("parseRemoteGroupCsv", () => {
  const parse = async (
    csv: string | Uint8Array,
    extra: Partial<RemoteGroupCsvOptions> = {},
    chunkSize = 3,
  ) => {
    const ids: string[] = [];
    const result = await parseRemoteGroupCsv(
      chunked(typeof csv === "string" ? encode(csv) : csv, chunkSize),
      { ...options, ...extra, onId: (id) => ids.push(id) },
    );
    return { result, ids };
  };

  it("reads IDs, skipping a BOM, header, blanks and quotes", async () => {
    expect(
      await parse('\uFEFFAccount_ID\r\n  acct_1  \n\n"acct,2"\nacct_1\nacct_é'),
    ).toEqual({
      result: { type: "valid", idCount: 4 },
      ids: ["acct_1", "acct,2", "acct_1", "acct_é"],
    });
  });

  it("only treats the first line as a header", async () => {
    expect((await parse("a\naccount_id")).ids).toEqual(["a", "account_id"]);
  });

  it("converts numbers to the key resolvers look up", async () => {
    expect(
      await parse("001\n1.0\n-2.50\n1e3", { attributeKey: "n", numeric: true }),
    ).toEqual({
      result: { type: "valid", idCount: 4 },
      ids: ["1", "1", "-2.5", "1000"],
    });
  });

  it("counts every invalid line and lists the first ones", async () => {
    const csv = ["ok", ...Array.from({ length: 12 }, (_, i) => `a${i},b`)].join(
      "\n",
    );
    const { result } = await parse(csv);
    expect(result).toMatchObject({ type: "invalid", invalidLineCount: 12 });
    expect(result.type === "invalid" && result.errors).toHaveLength(10);
    expect(result.type === "invalid" && result.errors[0]).toBe(
      "Line 2 has more than one column. Upload one ID per line.",
    );
  });

  it("rejects non-numbers for a number attribute", async () => {
    expect(
      (await parse("1\nabc", { attributeKey: "n", numeric: true })).result,
    ).toEqual({
      type: "invalid",
      invalidLineCount: 1,
      errors: ["Line 2 is not a number, but n is a number attribute"],
    });
  });

  it("rejects long lines without buffering them", async () => {
    const huge = "x".repeat(MAX_ID_LENGTH * 10);
    expect((await parse(`a\n${huge}\nb`, {}, 1000)).result).toEqual({
      type: "invalid",
      invalidLineCount: 1,
      errors: [`Line 2 is longer than ${MAX_ID_LENGTH} characters`],
    });
    expect((await parse(huge, {}, 1000)).result).toMatchObject({
      type: "invalid",
      invalidLineCount: 1,
    });
  });

  it("rejects invalid UTF-8", async () => {
    expect(
      (await parse(new Uint8Array([0x61, 0x0a, 0xff, 0x0a]))).result,
    ).toEqual({
      type: "invalid",
      invalidLineCount: 1,
      errors: ["Line 2 is not valid UTF-8 text"],
    });
  });

  it("stops at binary files", async () => {
    expect((await parse(new Uint8Array([0x50, 0x4b, 3, 4]))).result).toEqual({
      type: "invalid",
      invalidLineCount: 0,
      errors: [
        "This looks like a spreadsheet or zip file. Upload a CSV with one ID per line.",
      ],
    });
    expect(
      (await parse(new Uint8Array([0x61, 0x0a, 0x62, 0, 0x63]))).result,
    ).toMatchObject({ type: "invalid", invalidLineCount: 0 });
  });

  it("rejects a file with no IDs", async () => {
    expect((await parse("account_id\n\n")).result).toEqual({
      type: "invalid",
      invalidLineCount: 0,
      errors: ["The file has no IDs"],
    });
  });

  it("gives the same result for any chunk size", async () => {
    const csv = 'acct_é1\nacct_2\r\n"acct_3"\n';
    const results = await Promise.all(
      [1, 2, 5, 100].map((size) => parse(csv, {}, size)),
    );
    results.forEach((r) => expect(r).toEqual(results[0]));
  });
});
