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
});
