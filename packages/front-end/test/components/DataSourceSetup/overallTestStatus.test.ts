import { overallTestStatus } from "@/components/DataSourceSetup/overallTestStatus";

describe("overallTestStatus", () => {
  describe("when write access is required", () => {
    it("is running while either check is running", () => {
      expect(overallTestStatus("running", "idle", true)).toBe("running");
      expect(overallTestStatus("passed", "running", true)).toBe("running");
      expect(overallTestStatus("running", "failed", true)).toBe("running");
    });

    it("is failed when a finished check failed", () => {
      expect(overallTestStatus("failed", "idle", true)).toBe("failed");
      expect(overallTestStatus("passed", "failed", true)).toBe("failed");
      expect(overallTestStatus("failed", "passed", true)).toBe("failed");
    });

    it("is passed only when both checks passed", () => {
      expect(overallTestStatus("passed", "passed", true)).toBe("passed");
    });

    it("stays idle until both checks have a result", () => {
      expect(overallTestStatus("idle", "idle", true)).toBe("idle");
      expect(overallTestStatus("passed", "idle", true)).toBe("idle");
      expect(overallTestStatus("idle", "passed", true)).toBe("idle");
    });
  });

  describe("when write access is not required", () => {
    it("follows the read check", () => {
      expect(overallTestStatus("idle", "idle", false)).toBe("idle");
      expect(overallTestStatus("running", "idle", false)).toBe("running");
      expect(overallTestStatus("failed", "idle", false)).toBe("failed");
      expect(overallTestStatus("passed", "idle", false)).toBe("passed");
    });
  });
});
