import path from "path";
import { getUploadsDir, resolveUploadPath } from "back-end/src/services/files";

describe("resolveUploadPath", () => {
  const root = getUploadsDir();

  it("resolves a normal key under the uploads dir", () => {
    const key = "org_abc/2025-06/img_uuid.jpeg";
    expect(resolveUploadPath(key)).toBe(path.join(root, key));
  });

  it("returns the root dir for an empty key", () => {
    expect(resolveUploadPath("")).toBe(root);
  });

  it("allows in-bounds traversal that stays under the uploads dir", () => {
    // Cross-org containment is enforced at the controller layer, not here —
    // this only guarantees the path doesn't escape the uploads dir.
    expect(resolveUploadPath("org_a/../org_b/x")).toBe(
      path.join(root, "org_b/x"),
    );
  });

  it.each([
    ["../../etc/passwd"],
    ["../uploads-evil/key"], // sibling-prefix: must not pass a bare prefix match
    ["org_a/../../secrets"],
  ])("throws when %p escapes the uploads dir", (key) => {
    expect(() => resolveUploadPath(key)).toThrow(
      "Path must not escape out of the 'uploads' directory.",
    );
  });
});
