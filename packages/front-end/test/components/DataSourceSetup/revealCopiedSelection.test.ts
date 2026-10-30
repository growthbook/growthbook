import { revealCopiedSelection } from "@/components/DataSourceSetup/revealCopiedSelection";

const displayed = "RSA_PUBLIC_KEY = '••••••••';";
const full = "RSA_PUBLIC_KEY = 'MIIBIjANBgkq';";

describe("revealCopiedSelection", () => {
  it("replaces the mask when the selection includes it", () => {
    expect(revealCopiedSelection(displayed, full, displayed)).toBe(full);
    expect(revealCopiedSelection(displayed, full, "KEY = '••••••••'")).toBe(
      "KEY = 'MIIBIjANBgkq'",
    );
  });

  it("leaves a selection that misses the mask alone", () => {
    expect(revealCopiedSelection(displayed, full, "RSA_PUBLIC_KEY =")).toBe(
      null,
    );
  });

  describe("a mask repeated more than once", () => {
    const createThenAlter =
      "CREATE LOGIN ro WITH PASSWORD = '••••••••';\nALTER LOGIN ro WITH PASSWORD = '••••••••';";
    const realCreateThenAlter =
      "CREATE LOGIN ro WITH PASSWORD = 'N3wPass';\nALTER LOGIN ro WITH PASSWORD = 'N3wPass';";

    it("replaces every occurrence when the whole block is copied", () => {
      expect(
        revealCopiedSelection(
          createThenAlter,
          realCreateThenAlter,
          createThenAlter,
        ),
      ).toBe(realCreateThenAlter);
    });

    it("replaces just the one occurrence in a selection covering only the ALTER statement", () => {
      const alterOnly = "ALTER LOGIN ro WITH PASSWORD = '••••••••';";
      expect(
        revealCopiedSelection(createThenAlter, realCreateThenAlter, alterOnly),
      ).toBe("ALTER LOGIN ro WITH PASSWORD = 'N3wPass';");
    });
  });

  it("keeps an apostrophe inside the password", () => {
    const shown = `ALTER USER "ro" WITH PASSWORD '••••••••';`;
    const copy = `ALTER USER "ro" WITH PASSWORD 'O''Brien123!';`;
    expect(revealCopiedSelection(shown, copy, shown)).toBe(copy);
  });

  it("keeps a semicolon inside the password", () => {
    const shown = `ALTER USER "ro" WITH PASSWORD '••••••••';`;
    const copy = `ALTER USER "ro" WITH PASSWORD 'a;b';`;
    expect(revealCopiedSelection(shown, copy, shown)).toBe(copy);
  });
});
