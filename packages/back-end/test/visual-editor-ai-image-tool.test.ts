import { imageFilePath } from "back-end/src/api/visual-editor-ai/aiTools/generateImage";

// Inverting `quarantine` fails silently: the experiment renders, then its
// image 404s a week later when the gen/ prefix expires.
it("only writes under gen/ when quarantining", () => {
  expect(imageFilePath("org_1", "webp", true)).toMatch(
    /^gen\/org_1\/visual-editor\/img_.+\.webp$/,
  );
  expect(imageFilePath("org_1", "webp", false)).toMatch(
    /^org_1\/visual-editor\/img_.+\.webp$/,
  );
});
