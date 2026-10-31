import { touchDefinitionsVersion } from "back-end/src/models/DefinitionsVersionModel";
import {
  addTag,
  addTags,
  addTagsDiff,
  getAllTags,
  removeTag,
} from "back-end/src/models/TagModel";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

jest.mock("back-end/src/models/DefinitionsVersionModel", () => ({
  touchDefinitionsVersion: jest.fn(),
}));

const mockedTouch = jest.mocked(touchDefinitionsVersion);

const tagIds = async (org: string) =>
  (await getAllTags(org)).map((t) => t.id).sort();

describe("TagModel", () => {
  beforeAll(async () => {
    await connectTestMongo();
  });

  afterAll(async () => {
    await disconnectTestMongo();
  });

  beforeEach(() => {
    mockedTouch.mockClear();
  });

  describe("addTags", () => {
    it("bumps the version when creating the org's tag document", async () => {
      await addTags("org_new", ["alpha", "beta"]);
      expect(await tagIds("org_new")).toEqual(["alpha", "beta"]);
      expect(mockedTouch).toHaveBeenCalledTimes(1);
      expect(mockedTouch).toHaveBeenCalledWith("org_new");
    });

    it("bumps the version when at least one tag is new", async () => {
      await addTags("org_partial", ["alpha"]);
      mockedTouch.mockClear();

      await addTags("org_partial", ["alpha", "gamma"]);
      expect(await tagIds("org_partial")).toEqual(["alpha", "gamma"]);
      expect(mockedTouch).toHaveBeenCalledTimes(1);
    });

    it("does not bump the version when every tag already exists", async () => {
      await addTags("org_existing", ["alpha", "beta"]);
      mockedTouch.mockClear();

      await addTags("org_existing", ["beta", "alpha"]);
      await addTagsDiff("org_existing", [], ["alpha"]);
      expect(await tagIds("org_existing")).toEqual(["alpha", "beta"]);
      expect(mockedTouch).not.toHaveBeenCalled();
    });

    it("does nothing when every tag is filtered out by length", async () => {
      await addTags("org_short", ["a"]);
      expect(await tagIds("org_short")).toEqual([]);
      expect(mockedTouch).not.toHaveBeenCalled();
    });
  });

  describe("addTag and removeTag", () => {
    it("still bump the version every time", async () => {
      await addTag("org_single", "alpha", "#000000", "");
      await addTag("org_single", "alpha", "#ffffff", "updated");
      await removeTag("org_single", "missing");
      expect(mockedTouch).toHaveBeenCalledTimes(3);
    });
  });
});
