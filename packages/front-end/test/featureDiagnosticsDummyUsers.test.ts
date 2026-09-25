import { dummyUserForRow } from "@/components/Features/featureDiagnosticsDummyUsers";
import {
  managedStreamColumnLabel,
  streamColumnLabel,
} from "@/components/Features/featureDiagnosticsStream";

const rows = Array.from({ length: 60 }, (_, i) => dummyUserForRow(i));

describe("dummyUserForRow", () => {
  it("is deterministic", () => {
    expect(dummyUserForRow(7)).toEqual(dummyUserForRow(7));
  });

  it("repeats users across the set", () => {
    const counts = new Map<string, number>();
    rows.forEach((r) =>
      counts.set(r.unit_id, (counts.get(r.unit_id) ?? 0) + 1),
    );
    expect(counts.size).toBeLessThan(rows.length);
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(4);
  });

  it("includes rows with no attributes, and 6–20 keys otherwise", () => {
    const sizes = rows.map((r) => Object.keys(r.attributes).length);
    expect(sizes).toContain(0);
    sizes
      .filter((n) => n > 0)
      .forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(6);
        expect(n).toBeLessThanOrEqual(20);
      });
  });

  it("keeps a user's attributes identical between rows", () => {
    const byUser = new Map<string, string>();
    rows.forEach((r) => {
      const json = JSON.stringify(r.attributes);
      expect(byUser.get(r.unit_id) ?? json).toBe(json);
      byUser.set(r.unit_id, json);
    });
  });
});

describe("managedStreamColumnLabel", () => {
  it("names the managed identity column, and leaves the generic label alone", () => {
    expect(managedStreamColumnLabel("unit_id")).toBe("User ID");
    expect(managedStreamColumnLabel("ruleId")).toBe("Rule");
    expect(streamColumnLabel("unit_id")).toBe("Unit Id");
  });
});
