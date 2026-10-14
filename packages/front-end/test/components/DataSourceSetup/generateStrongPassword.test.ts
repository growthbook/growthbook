import { generateStrongPassword } from "@/components/DataSourceSetup/generateStrongPassword";

describe("generateStrongPassword", () => {
  it("defaults to 24 characters", () => {
    expect(generateStrongPassword()).toHaveLength(24);
  });

  it("honors a custom length", () => {
    expect(generateStrongPassword(8)).toHaveLength(8);
    expect(generateStrongPassword(40)).toHaveLength(40);
  });

  it("only uses letters and digits so it is safe inside quoted SQL", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateStrongPassword()).toMatch(/^[A-Za-z0-9]+$/);
    }
  });

  it("produces different values on each call", () => {
    const values = new Set(
      Array.from({ length: 20 }, () => generateStrongPassword()),
    );
    expect(values.size).toBe(20);
  });
});
