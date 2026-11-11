import md5 from "md5";
import { entityTrackingHash } from "@/services/track";

vi.mock("@/services/UserContext", () => ({
  getCurrentUser: () => ({ org: "org_1" }),
}));

describe("entityTrackingHash", () => {
  it("hashes the org and entity the way the back end does", () => {
    expect(entityTrackingHash("my-flag")).toBe(md5("org_1:my-flag"));
  });
});
