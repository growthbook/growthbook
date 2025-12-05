import { VisualChangesetInterface } from "shared/types/visual-changeset";
import {
  VisualChangesetModel,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
import { ReqContext } from "back-end/types/organization";
import { getCollection } from "back-end/src/util/mongo.util";

jest.mock("back-end/src/util/mongo.util");

describe("updateVisualChangeset", () => {
  const context: ReqContext = {
    // @ts-expect-error TODO
    org: {
      id: "org_123",
      name: "org_name",
    },
  };
  const experiment = {
    hasVisualChangesets: true,
    variations: [],
    toJSON: () => ({
      hasVisualChangesets: true,
      variations: [],
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("when a visual changeset has existing visual changes", () => {
    const visualChangeset: VisualChangesetInterface = {
      id: "vc_123",
      editorUrl: "https://editor.url",
      experiment: "exp_123",
      organization: "org_123",
      urlPatterns: [],
      visualChanges: [
        {
          id: "vch_123",
          css: "",
          description: "",
          variation: "var_123",
          domMutations: [],
        },
      ],
    };
    describe("and incoming updates has visualChanges undefined", () => {
      const updates = {
        editorUrl: "https://editor2.url",
        urlPatterns: [],
        visualChanges: undefined,
      };
      const updateFn = jest
        .spyOn(VisualChangesetModel, "updateOne")
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });
      it("should keep the existing visual changes", async () => {
        await updateVisualChangeset({
          visualChangeset,
          // @ts-expect-error TODO
          experiment,
          updates,
          context,
        });
        expect(updateFn).toHaveBeenCalledWith(
          {
            id: visualChangeset.id,
            organization: context.org.id,
          },
          {
            $set: {
              ...updates,
              visualChanges: visualChangeset.visualChanges,
            },
          },
        );
      });
    });
    describe("and incoming updates has new visualChanges", () => {
      const updates = {
        editorUrl: "https://editor2.url",
        urlPatterns: [],
        visualChanges: [
          {
            id: "vch_123",
            css: "",
            description: "",
            variation: "var_123",
            domMutations: [],
          },
          {
            id: "vch_456",
            css: "",
            description: "",
            variation: "var_456",
            domMutations: [],
          },
        ],
      };
      const updateFn = jest
        .spyOn(VisualChangesetModel, "updateOne")
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });

      it("should overwrite the existing visual changes with new changes", async () => {
        (getCollection as jest.Mock).mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        });

        await updateVisualChangeset({
          visualChangeset,
          // @ts-expect-error TODO
          experiment,
          updates,
          context,
        });
        expect(updateFn).toHaveBeenCalledWith(
          {
            id: visualChangeset.id,
            organization: context.org.id,
          },
          {
            $set: {
              ...updates,
            },
          },
        );
      });
    });
  });
});
