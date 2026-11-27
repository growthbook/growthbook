import { backfillAutoExperimentSettings } from "back-end/src/services/autoExperimentsBackfill";
import { getCollection } from "back-end/src/util/mongo.util";
import { connectTestMongo, disconnectTestMongo } from "../test-helpers";

beforeAll(connectTestMongo, 30000);
afterAll(disconnectTestMongo);

const COLLECTIONS = [
  "organizations",
  "experiments",
  "contextualbandits",
  "visualchangesets",
  "urlredirects",
  "sdkconnections",
];
beforeEach(async () => {
  for (const name of COLLECTIONS) await getCollection(name).deleteMany({});
});

type Doc = Record<string, unknown>;

const DAY = 24 * 60 * 60 * 1000;
// Either side of the 30 days a draft keeps counting for.
const RECENT = new Date(Date.now() - 29 * DAY);
const OLD = new Date(Date.now() - 31 * DAY);

// One organization that holds every kind of change, each owned by `owner` and
// last saved at `edited`.
async function backfill({
  experiment,
  bandit,
  edited,
}: {
  experiment?: Doc;
  bandit?: Doc;
  edited?: Date;
}) {
  const organization = "org";
  await getCollection("organizations").insertOne({ id: organization });
  if (experiment) {
    await getCollection("experiments").insertOne({
      organization,
      id: "exp",
      ...experiment,
    });
  }
  if (bandit) {
    await getCollection("contextualbandits").insertOne({
      organization,
      id: "cb",
      ...bandit,
    });
  }
  await getCollection("visualchangesets").insertOne({
    organization,
    ...(bandit ? { contextualBandit: "cb" } : { experiment: "exp" }),
    visualChanges: [{ js: "alert(1)" }],
    ...(edited ? { dateUpdated: edited } : {}),
  });
  await getCollection("urlredirects").insertOne({
    organization,
    experiment: "exp",
    urlPattern: "https://example.com/a",
    destinationURLs: [{ url: "https://other.example.com/b" }],
    ...(edited ? { dateUpdated: edited } : {}),
  });
  await getCollection("sdkconnections").insertOne({
    organization,
    id: "sdk",
    includeVisualExperiments: true,
    includeRedirectExperiments: true,
  });
  await backfillAutoExperimentSettings();
  const org = await getCollection<{
    settings: { autoExperiments: Record<string, boolean> };
  }>("organizations").findOne({ id: organization });
  const connection = await getCollection<Record<string, boolean>>(
    "sdkconnections",
  ).findOne({ id: "sdk" });
  return {
    settings: org?.settings.autoExperiments,
    connection: {
      includeVisualExperiments: connection?.includeVisualExperiments,
      includeRedirectExperiments: connection?.includeRedirectExperiments,
      allowCustomJs: connection?.allowCustomJs,
      allowCrossOriginRedirects: connection?.allowCrossOriginRedirects,
    },
  };
}

const ALL = {
  visualEditor: true,
  urlRedirects: true,
  customJs: true,
  crossOriginRedirects: true,
};
const NONE = {
  visualEditor: false,
  urlRedirects: false,
  customJs: false,
  crossOriginRedirects: false,
};
const CONNECTION_ON = {
  includeVisualExperiments: true,
  includeRedirectExperiments: true,
  allowCustomJs: true,
  allowCrossOriginRedirects: true,
};
const CONNECTION_OFF = {
  includeVisualExperiments: false,
  includeRedirectExperiments: false,
  allowCustomJs: false,
  allowCrossOriginRedirects: false,
};

describe("backfillAutoExperimentSettings", () => {
  it.each([
    ["running", { status: "running" }],
    [
      "stopped with a temporary rollout",
      { status: "stopped", releasedVariationId: "v1" },
    ],
    ["a recent draft", { status: "draft", dateUpdated: RECENT }],
    [
      "an old draft scheduled to start",
      {
        status: "draft",
        dateUpdated: OLD,
        nextScheduledStatusUpdate: { type: "start", date: new Date() },
      },
    ],
  ])("counts an experiment that is %s", async (_, experiment) => {
    expect(await backfill({ experiment })).toEqual({
      settings: ALL,
      connection: CONNECTION_ON,
    });
  });

  it.each([
    ["deleted", undefined],
    // Starting it asks to enable the feature.
    ["an old draft", { status: "draft", dateUpdated: OLD }],
    ["a draft with no date", { status: "draft" }],
    [
      "a recent draft that is archived",
      { status: "draft", dateUpdated: RECENT, archived: true },
    ],
    ["archived", { status: "running", archived: true }],
    ["stopped", { status: "stopped", releasedVariationId: "" }],
    [
      "stopped and excluded from the payload",
      {
        status: "stopped",
        releasedVariationId: "v1",
        excludeFromPayload: true,
      },
    ],
  ])("ignores an experiment that is %s", async (_, experiment) => {
    expect(await backfill({ experiment })).toEqual({
      settings: NONE,
      connection: CONNECTION_OFF,
    });
  });

  // Saving a change doesn't move its experiment's date.
  it("counts an old draft whose changes were saved recently", async () => {
    expect(
      await backfill({
        experiment: { status: "draft", dateUpdated: OLD },
        edited: RECENT,
      }),
    ).toEqual({ settings: ALL, connection: CONNECTION_ON });
  });

  it("ignores an old draft whose changes are old too", async () => {
    const { settings } = await backfill({
      experiment: { status: "draft", dateUpdated: OLD },
      edited: OLD,
    });
    expect(settings).toEqual(NONE);
  });

  it("ignores recently saved changes of a stopped experiment", async () => {
    const { settings } = await backfill({
      experiment: { status: "stopped", releasedVariationId: "" },
      edited: RECENT,
    });
    expect(settings).toEqual(NONE);
  });

  it.each([
    ["running", { status: "running" }],
    ["a recent draft", { status: "draft", dateUpdated: RECENT }],
  ])("counts a contextual bandit that is %s", async (_, bandit) => {
    const { settings } = await backfill({ bandit });
    expect(settings).toEqual({ ...NONE, visualEditor: true, customJs: true });
  });

  it.each([
    ["an old draft", { status: "draft", dateUpdated: OLD }],
    ["stopped", { status: "stopped" }],
    ["archived", { status: "running", archived: true }],
  ])("ignores a contextual bandit that is %s", async (_, bandit) => {
    const { settings } = await backfill({ bandit });
    expect(settings).toEqual(NONE);
  });

  it("ignores an experiment in another organization", async () => {
    await getCollection("experiments").insertOne({
      organization: "other",
      id: "exp",
      status: "running",
    });
    expect((await backfill({})).settings).toEqual(NONE);
  });
});
