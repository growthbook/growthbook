import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ReqContext } from "shared/types/organization";
import {
  VisualChangesetModel,
  updateVisualChange,
  updateVisualChangeset,
} from "back-end/src/models/VisualChangesetModel";
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
    describe("and incoming updates has empty visualChanges", () => {
      const updates = {
        editorUrl: "https://editor2.url",
        urlPatterns: [],
        visualChanges: [],
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

      it("should overwrite the existing visual changes with an empty list", async () => {
        (getCollection as jest.Mock).mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        });

        const res = await updateVisualChangeset({
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
              visualChanges: [],
            },
          },
        );
        expect(res.visualChanges).toEqual([]);
      });
    });
    describe("and incoming updates has partial visualChanges", () => {
      const updateFn = jest
        .spyOn(VisualChangesetModel, "updateOne")
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });

      it("should default required visual change fields", async () => {
        (getCollection as jest.Mock).mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        });

        const res = await updateVisualChangeset({
          visualChangeset,
          // @ts-expect-error TODO
          experiment,
          updates: {
            visualChanges: [{ variation: "var_123" }],
          },
          context,
        });

        expect(updateFn).toHaveBeenCalledWith(
          {
            id: visualChangeset.id,
            organization: context.org.id,
          },
          {
            $set: {
              visualChanges: [
                {
                  id: expect.stringMatching(/^vc_/),
                  description: "",
                  css: "",
                  variation: "var_123",
                  domMutations: [],
                },
              ],
            },
          },
        );
        expect(res.visualChanges).toEqual([
          {
            id: expect.stringMatching(/^vc_/),
            description: "",
            css: "",
            variation: "var_123",
            domMutations: [],
          },
        ]);
      });
    });
    describe("and incoming updates partially modify an existing visual change", () => {
      const existingChangeset: VisualChangesetInterface = {
        ...visualChangeset,
        visualChanges: [
          {
            id: "vch_123",
            css: "body { color: red; }",
            description: "old description",
            js: "console.log('old');",
            variation: "var_123",
            domMutations: [
              {
                selector: ".old",
                action: "set",
                attribute: "data-x",
                value: "1",
              },
            ],
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

      it("should preserve fields the caller did not supply", async () => {
        (getCollection as jest.Mock).mockReturnValue({
          findOne: jest.fn().mockResolvedValue(null),
        });

        const res = await updateVisualChangeset({
          visualChangeset: existingChangeset,
          // @ts-expect-error TODO
          experiment,
          updates: {
            visualChanges: [
              {
                id: "vch_123",
                variation: "var_123",
                css: "body { color: blue; }",
              },
            ],
          },
          context,
        });

        const expectedMerged = {
          id: "vch_123",
          css: "body { color: blue; }",
          description: "old description",
          js: "console.log('old');",
          variation: "var_123",
          domMutations: [
            {
              selector: ".old",
              action: "set",
              attribute: "data-x",
              value: "1",
            },
          ],
        };

        expect(updateFn).toHaveBeenCalledWith(
          {
            id: existingChangeset.id,
            organization: context.org.id,
          },
          {
            $set: {
              visualChanges: [expectedMerged],
            },
          },
        );
        expect(res.visualChanges).toEqual([expectedMerged]);
      });
    });
    describe("and incoming updates include a disallowed organization field", () => {
      const updateFn = jest
        .spyOn(VisualChangesetModel, "updateOne")
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });

      it("should not write disallowed fields to the visual changeset", async () => {
        const updates = {
          editorUrl: "https://editor2.url",
          organization: "org_attack",
        } as unknown as Parameters<typeof updateVisualChangeset>[0]["updates"];

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
              editorUrl: "https://editor2.url",
              visualChanges: visualChangeset.visualChanges,
            },
          },
        );
      });
    });
    describe("and incoming updates have undefined-valued fields", () => {
      const updateFn = jest
        .spyOn(VisualChangesetModel, "updateOne")
        .mockResolvedValue({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        });

      it("should not write undefined values into $set", async () => {
        await updateVisualChangeset({
          visualChangeset,
          // @ts-expect-error TODO
          experiment,
          updates: {
            editorUrl: "https://editor2.url",
            urlPatterns: undefined,
            visualChanges: undefined,
          },
          context,
        });

        expect(updateFn).toHaveBeenCalledWith(
          {
            id: visualChangeset.id,
            organization: context.org.id,
          },
          {
            $set: {
              editorUrl: "https://editor2.url",
              visualChanges: visualChangeset.visualChanges,
            },
          },
        );
      });
    });
  });
});

describe("updateVisualChange", () => {
  const visualChangeset: VisualChangesetInterface = {
    id: "vcs_123",
    editorUrl: "https://editor.url",
    experiment: "exp_123",
    organization: "org_123",
    urlPatterns: [],
    visualChanges: [
      {
        id: "vch_123",
        css: "body { color: red; }",
        description: "original",
        variation: "var_123",
        domMutations: [],
      },
      {
        id: "vch_456",
        css: "",
        description: "second",
        variation: "var_456",
        domMutations: [],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ignores attempts to rename a visual change via the payload id", async () => {
    jest.spyOn(VisualChangesetModel, "findOne").mockResolvedValue({
      toJSON: () => visualChangeset,
    } as never);
    const updateFn = jest
      .spyOn(VisualChangesetModel, "updateOne")
      .mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      });

    await updateVisualChange({
      changesetId: visualChangeset.id,
      visualChangeId: "vch_123",
      organization: "org_123",
      payload: {
        id: "vch_other",
        css: "body { color: blue; }",
      },
    });

    expect(updateFn).toHaveBeenCalledWith(
      { id: visualChangeset.id, organization: "org_123" },
      {
        $set: {
          visualChanges: [
            {
              id: "vch_123",
              css: "body { color: blue; }",
              description: "original",
              variation: "var_123",
              domMutations: [],
            },
            visualChangeset.visualChanges[1],
          ],
        },
      },
    );
  });
});
