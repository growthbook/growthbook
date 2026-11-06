import {
  LINK_CODE_ALPHABET,
  generateLinkCode,
  hashLinkCode,
  normalizeLinkCode,
  sandboxExpiry,
} from "back-end/src/util/agentSignup.util";

describe("generateLinkCode", () => {
  it("issues four-dash-four codes from the safe alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateLinkCode();
      expect(code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
      for (const c of code.replace("-", "")) {
        expect(LINK_CODE_ALPHABET).toContain(c);
      }
      seen.add(code);
    }
    expect(seen.size).toBe(200);
  });
});

describe("normalizeLinkCode", () => {
  it("accepts what a person is likely to type", () => {
    expect(
      normalizeLinkCode("kqbx-7q4m".replace("7", "T").replace("4", "W")),
    ).toBe("KQBX-TQWM");
    expect(normalizeLinkCode("  kqbxtqwm ")).toBe("KQBX-TQWM");
    expect(normalizeLinkCode("KQBX TQWM")).toBe("KQBX-TQWM");
  });

  it("rejects anything that cannot be a code", () => {
    expect(normalizeLinkCode("")).toBe("");
    expect(normalizeLinkCode("KQBX-TQW")).toBe("");
    expect(normalizeLinkCode("KQBX-TQWMM")).toBe("");
    // O and I are not in the alphabet, so a code with them was misread.
    expect(normalizeLinkCode("KQBO-TQWI")).toBe("");
  });
});

describe("hashLinkCode", () => {
  it("is stable and does not reveal the code", () => {
    const hash = hashLinkCode("KQBX-TQWM");
    expect(hash).toBe(hashLinkCode("KQBX-TQWM"));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("KQBX");
    expect(hashLinkCode("KQBX-TQWN")).not.toBe(hash);
  });
});

describe("sandboxExpiry", () => {
  it("adds whole days", () => {
    const from = new Date("2026-10-08T12:00:00Z");
    expect(sandboxExpiry(from, 7).toISOString()).toBe(
      "2026-10-15T12:00:00.000Z",
    );
  });
});
