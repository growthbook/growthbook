import { generateStrongPassword } from "@/components/DataSourceSetup/generateStrongPassword";

describe("generateStrongPassword", () => {
  it("is 24 characters", () => {
    expect(generateStrongPassword()).toHaveLength(24);
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
