import {
  experimentChangesBody,
  type ExperimentChangesBody,
} from "shared/validators";
import { mergeChanges } from "@/components/Experiment/TabbedPage/mergeChanges";

const redirect = {
  urlPattern: "https://shop.example.com/",
  destinationURLs: [{ variation: "v1", url: "https://shop.example.com/b" }],
  persistQueryString: true,
  checkCircularDependencies: true,
};

// Required, so a key added to the body doesn't compile until it's here.
const part: Required<Omit<ExperimentChangesBody, "dryRun">> = {
  experiment: { changes: { name: "New" }, base: { name: "Old" } },
  flagValues: [
    {
      featureId: "flag",
      variations: [],
      revision: { version: 1, dateUpdated: null },
    },
  ],
  linkFeatures: [{ featureId: "flag", variations: [] }],
  unlinkFeatures: ["flag"],
  keepFeatures: ["flag"],
  deleteManagedFlag: true,
  managedFlag: { valueType: "boolean", variations: [] },
  renameManagedFlag: { to: "renamed" },
  addUrlRedirects: [redirect],
  editUrlRedirects: [
    { ...redirect, id: "url_1", dateUpdated: "2026-01-01T00:00:00.000Z" },
  ],
  removeUrlRedirects: ["url_2"],
  editVisualChangesets: [
    {
      id: "vc_1",
      changes: { editorUrl: "https://shop.example.com/b" },
      base: { editorUrl: "https://shop.example.com/" },
    },
  ],
  removeVisualChangesets: ["vc_2"],
};

const listLengths = (body: ExperimentChangesBody) =>
  Object.fromEntries(
    Object.entries(body).flatMap(([key, value]) =>
      Array.isArray(value) ? [[key, value.length]] : [],
    ),
  );

describe("mergeChanges", () => {
  it("keeps every key an edit can send", () => {
    // `dryRun` is the caller's to add, not an edit's.
    const editKeys = Object.keys(experimentChangesBody.shape).filter(
      (key) => key !== "dryRun",
    );
    expect(Object.keys(part).sort()).toEqual(editKeys.sort());
    expect(mergeChanges([{}, part])).toEqual(part);
  });

  it("adds up the edits' entries and merges their experiment fields", () => {
    const twice = mergeChanges([
      part,
      {
        ...part,
        experiment: { changes: { hypothesis: "h" }, base: { hypothesis: "" } },
      },
    ]);
    expect(listLengths(twice)).toEqual(
      Object.fromEntries(
        Object.entries(listLengths(part)).map(([key, n]) => [key, n * 2]),
      ),
    );
    expect(twice.experiment).toEqual({
      changes: { name: "New", hypothesis: "h" },
      base: { name: "Old", hypothesis: "" },
    });
  });
});
