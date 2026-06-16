import { getOrgScopedPath } from "back-end/src/routers/upload/upload.util";

const ORG = "org_abc123";

describe("getOrgScopedPath", () => {
  it.each([
    // Legitimate paths resolve unchanged
    [`${ORG}/2025-06/img_uuid.jpeg`, `${ORG}/2025-06/img_uuid.jpeg`],
    [`/${ORG}/2025-06/img_uuid.jpeg`, `${ORG}/2025-06/img_uuid.jpeg`],
    // Multiple leading slashes are all stripped (else normalize stays absolute)
    [`//${ORG}/2025-06/img.jpeg`, `${ORG}/2025-06/img.jpeg`],
    // Harmless "." segments collapse but stay in-org
    [`${ORG}/./2025-06/img.jpeg`, `${ORG}/2025-06/img.jpeg`],
  ])("accepts %p", (input, expected) => {
    expect(getOrgScopedPath(input, ORG)).toBe(expected);
  });

  it.each([
    // The reported cross-tenant traversal attack
    [`${ORG}/../org_other/2025-06/img.jpeg`],
    [`/${ORG}/../org_other/2025-06/img.jpeg`],
    // Escaping the uploads dir entirely
    [`${ORG}/../../etc/passwd`],
    // A different org outright
    ["org_other/2025-06/img.jpeg"],
    // Prefix-collision: another org whose id starts with ours
    [`${ORG}_evil/2025-06/img.jpeg`],
  ])("rejects %p", (input) => {
    expect(getOrgScopedPath(input, ORG)).toBeNull();
  });
});
