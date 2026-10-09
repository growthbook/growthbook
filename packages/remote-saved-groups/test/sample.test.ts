import { checkRemoteGroupCsvSample } from "../src/sample";
import { RemoteGroupCsvOptions } from "../src/types";

const encode = (s: string) => new TextEncoder().encode(s);

const options: RemoteGroupCsvOptions = {
  attributeKey: "account_id",
  numeric: false,
};

describe("checkRemoteGroupCsvSample", () => {
  const whole = { ...options, start: true, end: true };
  const check = (csv: string | Uint8Array, extra: Partial<typeof whole> = {}) =>
    checkRemoteGroupCsvSample(typeof csv === "string" ? encode(csv) : csv, {
      ...whole,
      ...extra,
    });

  it("counts IDs, skipping blanks, quotes and a matching header", () => {
    expect(check('\uFEFFAccount_ID\r\n  acct_1  \n\n"acct,2"\n')).toEqual({
      idCount: 2,
    });
  });

  it("throws the first problem", () => {
    expect(() => check("a\nb,c")).toThrow("Line 2 has more than one column");
    expect(() => check("42\nabc", { numeric: true })).toThrow(
      "Line 2 is not a number",
    );
    expect(() => check(new Uint8Array([0x50, 0x4b, 3, 4]))).toThrow(
      "spreadsheet or zip",
    );
  });

  it("skips lines cut off at the edges", () => {
    // "é" is two bytes; cutting it leaves invalid UTF-8 on the edge lines
    const bytes = encode("éa\nb\nc,dé");
    expect(
      check(bytes.subarray(1, bytes.length - 1), { start: false, end: false }),
    ).toEqual({ idCount: 1 });
  });

  it("describes lines near the end without a number", () => {
    expect(() => check("x\na,b\n", { start: false })).toThrow(
      "A line near the end of the file has more than one column",
    );
  });

  it("agrees with the parser on PK-prefixed IDs and quoted fields", () => {
    expect(check("PK123\nPK_customer")).toEqual({ idCount: 2 });
    expect(() => check('"acct_1","acct_2"')).toThrow("more than one column");
  });
});
