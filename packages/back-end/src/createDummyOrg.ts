import { Request } from "express";
import { LicenseModel } from "enterprise";
import { createOrganization } from "./models/OrganizationModel";
import { createUser } from "./services/users";
import { addMemberToOrg } from "./services/organizations";
import { updateTokenUsage } from "./models/AITokenUsageModel";
import { createOrganizationApiKey } from "./models/ApiKeyModel";
import { createArchetype } from "./models/ArchetypeModel";
import { insertAudit } from "./models/AuditModel";
import { createRefreshToken } from "./models/AuthRefreshModel";
import { createDataSource } from "./models/DataSourceModel";
import { createDimension } from "./models/DimensionModel";
import { createDimensionSlices } from "./models/DimensionSlicesModel";
import { DiscussionModel } from "./models/DiscussionModel";
import { createEvent } from "./models/EventModel";
import { createEventWebHook } from "./models/EventWebhookModel";
import { createEventWebHookLog } from "./models/EventWebHookLogModel";
import { createExperimentLaunchChecklist } from "./models/ExperimentLaunchChecklistModel";
import { ReqContextClass } from "./services/context";
import { createExperiment } from "./models/ExperimentModel";
import { createExperimentSnapshotModel } from "./models/ExperimentSnapshotModel";
import { createFactTable } from "./models/FactTableModel";
import { createFeature, getFeature } from "./models/FeatureModel";
import { upsertFeatureCodeRefs } from "./models/FeatureCodeRefs";
import {
  createInitialRevision,
  getFeatureRevisionsByFeatureIds,
} from "./models/FeatureRevisionModel";
import { createForgotPasswordToken } from "./models/ForgotPasswordModel";
import { createGithubIntegration } from "./models/GithubIntegration";
import { createGithubUserToken } from "./models/GithubUserTokenModel";
import { IdeaModel } from "./models/IdeasModel";
import { createImpactEstimate } from "./models/ImpactEstimateModel";
import { createInformationSchema } from "./models/InformationSchemaModel";
import { createInformationSchemaTable } from "./models/InformationSchemaTablesModel";
import { insertMetric } from "./models/MetricModel";
import { createPastExperiments } from "./models/PastExperimentsModel";
import { PresentationModel } from "./models/PresentationModel";
import { createProject } from "./models/ProjectModel";
import { createNewQuery } from "./models/QueryModel";
import { RealtimeUsageModel } from "./models/RealtimeModel";
import { createReport } from "./models/ReportModel";
import { createSavedGroup } from "./models/SavedGroupModel";
import { createSDKConnection } from "./models/SdkConnectionModel";
import { updateSDKPayload } from "./models/SdkPayloadModel";
import { createSdkWebhookLog } from "./models/SdkWebhookLogModel";
import { createSegment } from "./models/SegmentModel";
import { createSlackIntegration } from "./models/SlackIntegrationModel";
import { SSOConnectionModel } from "./models/SSOConnectionModel";
import { addTag } from "./models/TagModel";
import { createTeam } from "./models/TeamModel";
import { createURLRedirect } from "./models/UrlRedirectModel";
import { createVisualChangeset } from "./models/VisualChangesetModel";
import { upsertWatch } from "./models/WatchModel";
import { WebhookModel } from "./models/WebhookModel";

export default async function createDummyOrg() {
  // create user
  console.log("creating user - alice");
  const user = await createUser(
    "alice",
    "alice@growthbook.io",
    "test1234",
    true
  );

  // create user2
  console.log("creating user - bob");
  const user2 = await createUser("bob", "bob@growthbook.io", "test1234", false);

  // create org
  console.log("creating org 1");
  const org = await createOrganization({
    email: user.email,
    userId: user.id,
    name: "Test - Org1",
  });

  // create org2
  console.log("creating org 2");
  await createOrganization({
    email: user.email,
    userId: user.id,
    name: "Test - Org2",
  });

  console.log("creating context");
  const context = new ReqContextClass({
    org,
    auditUser: {
      type: "dashboard",
      id: user.id,
      email: user.email,
      name: user.name || "test",
    },
    user,
    teams: [],
    req: {} as Request,
  });

  // add user2 to org
  console.log("adding user2 to org");
  await addMemberToOrg({
    organization: org,
    userId: user2.id,
    role: "engineer",
    limitAccessByEnvironment: false,
    environments: [],
  });

  // - aitokenusages
  console.log("updating token usage");
  await updateTokenUsage({
    organization: org,
    numTokensUsed: 0,
  });

  // - apikeys
  console.log("creating api key");
  await createOrganizationApiKey({
    organizationId: org.id,
    description: "",
    role: "readonly",
  });

  // - archetypes
  console.log("creating archetype");
  await createArchetype({
    organization: org.id,
    name: "test",
    description: "",
    owner: user.id,
    isPublic: true,
    attributes: "",
  });

  // - audits
  console.log("inserting audit");
  await insertAudit({
    organization: org.id,
    user: {
      id: user.id,
      email: user.email,
      name: "test",
    },
    event: "attribute.create",
    entity: {
      object: "experiment",
      id: "123",
      name: "test",
    },
    dateCreated: new Date(),
  });

  // - authrefreshes
  //     - related to users
  console.log("creating refresh token");
  await createRefreshToken(
    // @ts-expect-error we do not care
    {
      ip: "123.123.123.123",
      headers: {
        "user-agent": "test",
      },
    },
    user
  );

  // - datasources
  console.log("creating data source");
  const datasource = await createDataSource(
    org.id,
    "test",
    "redshift",
    {
      user: "",
      host: "",
      database: "",
      password: "",
      port: 1234,
      ssl: false,
      defaultSchema: "",
    },
    {}
  );

  // - dimensions
  console.log("creating dimension");
  await createDimension({
    organization: org.id,
    owner: "test",
    datasource: datasource.id,
    userIdType: "test",
    name: "dimension",
    sql: "test",
  });

  // - dimensionslices
  console.log("creating dimension slices");
  await createDimensionSlices({
    organization: org.id,
    dataSourceId: datasource.id,
    queryId: "test",
  });

  // - discussions
  console.log("creating discussion");
  await DiscussionModel.create({
    id: "com_123",
    organization: org.id,
    parentType: "experiment",
    parentId: "123",
    comments: [
      {
        content: "test",
        datt: new Date(),
        userEmail: user.email,
        userId: user.id,
        userName: user.name,
      },
    ],
    dateUpdated: new Date(),
  });

  // - events
  console.log("creating event");
  await createEvent(org.id, {
    event: "user.login",
    object: "user",
    data: {
      current: {
        id: "",
        device: "",
        email: "",
        ip: "",
        name: "",
        os: "",
        userAgent: "",
      },
    },
    user: {
      type: "dashboard",
      id: user.id,
      email: user.email,
      name: user.name || "test",
    },
  });

  // - eventwebhooks
  console.log("creating event webhook");
  const eventWebHook = await createEventWebHook({
    name: "test",
    url: "https://blah.com",
    organizationId: org.id,
    enabled: false,
    events: ["experiment.updated", "experiment.deleted"],
    projects: [],
    tags: [],
    environments: [],
    payloadType: "slack",
    method: "POST",
    headers: {},
  });

  // - eventwebhooklogs
  console.log("creating event webhook log");
  await createEventWebHookLog({
    eventWebHookId: eventWebHook.id,
    organizationId: org.id,
    payload: {},
    result: {
      state: "success",
      responseCode: 0,
      responseBody: "",
    },
  });

  // - experimentlaunchchecklists
  console.log("creating experiment launch checklist");
  await createExperimentLaunchChecklist(org.id, user.id, [], "");

  // - experiments
  console.log("creating experiment");
  const experiment = await createExperiment({
    data: {
      id: "exp_123",
      organization: org.id,
    },
    context,
  });

  // - experimentsnapshots
  console.log("creating experiment snapshot");
  await createExperimentSnapshotModel({
    id: "expsnap_123",
    organization: org.id,
    experiment: experiment.id,
    phase: 0,
    dimension: null,
    dateCreated: new Date(),
    runStarted: null,
    status: "running",
    // @ts-expect-error blah
    settings: {},
    queries: [],
    unknownVariations: [],
    multipleExposures: 0,
    analyses: [],
  });

  // - facttables
  console.log("creating fact table");
  const factTable = await createFactTable(context, {
    name: "",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: "",
    userIdTypes: [],
    sql: "",
    eventName: "",
    columns: [],
  });

  // - factmetrics
  console.log("creating fact metric");
  await context.models.factMetrics.create({
    id: "fact__1234",
    owner: user.id,
    datasource: datasource.id,
    name: "test",
    description: "",
    tags: [],
    projects: [],
    inverse: false,
    metricType: "mean",
    numerator: {
      factTableId: factTable.id,
      column: "",
      filters: [],
    },
    denominator: null,

    cappingSettings: {
      type: "absolute",
      value: 0,
    },
    windowSettings: {
      type: "conversion",
      delayHours: 0,
      windowValue: 0,
      windowUnit: "weeks",
    },

    maxPercentChange: 1,
    minPercentChange: 0,
    minSampleSize: 2,
    winRisk: 0,
    loseRisk: 0,

    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 0,

    quantileSettings: null,
  });

  // - features
  console.log("creating feature");
  await createFeature(context, {
    id: "feature_123",
    organization: org.id,
    owner: "test",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: "boolean",
    defaultValue: "",
    version: 0,
    environmentSettings: {},
  });

  const feature = await getFeature(context, "feature_123");

  // - featurecoderefs
  console.log("upserting feature code refs");
  await upsertFeatureCodeRefs({
    // @ts-expect-error we do not care
    feature: feature.id,
    repo: "",
    branch: "",
    codeRefs: [],
    organization: org,
  });

  // - featurerevisions
  // assert that it was automatically created
  const revision = await getFeatureRevisionsByFeatureIds(org.id, [feature.id]);
  if (!revision) {
    throw new Error("Feature revision not found");
  }

  // - forgotpasswords
  //     - related to users
  console.log("creating forgot password token");
  await createForgotPasswordToken(user.email);
  // - githubusertokens
  console.log("creating github user token");
  const ghtoken = await createGithubUserToken({
    organization: org.id,
    token: "",
    expiresAt: new Date(),
    refreshToken: "",
    refreshTokenExpiresAt: new Date(),
  });

  // - githubintegrations
  console.log("creating github integration");
  await createGithubIntegration({
    organization: org.id,
    tokenId: ghtoken.id,
    createdBy: user.id,
  });

  // - ideas
  console.log("creating idea");
  await IdeaModel.create({
    id: "idea_123",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    text: "",
    archived: false,
    userId: user.id,
    organization: org.id,
    tags: [],
    impactScore: 0,
    experimentLength: 0,
    estimateParams: {
      estimate: "",
      improvement: 0,
      numVariations: 0,
      userAdjustment: 0,
    },
  });

  // - impactestimates
  console.log("creating impact estimate");
  await createImpactEstimate({
    organization: org.id,
    metric: "",
    conversionsPerDay: 2,
    query: "",
    queryLanguage: "sql",
    dateCreated: new Date(),
  });

  // - informationschemas
  console.log("creating information schema");
  await createInformationSchema(
    [
      {
        databaseName: "test",
        path: "test",
        dateCreated: new Date(),
        dateUpdated: new Date(),
        schemas: [
          {
            schemaName: "test",
            path: "test",
            dateCreated: new Date(),
            dateUpdated: new Date(),
            tables: [
              {
                tableName: "test",
                path: "test",
                id: "test",
                numOfColumns: 0,
                dateCreated: new Date(),
                dateUpdated: new Date(),
              },
            ],
          },
        ],
      },
    ],
    org.id,
    datasource.id
  );

  // - informationschematables
  console.log("creating information schema table");
  await createInformationSchemaTable({
    id: "infoschema_123",
    datasourceId: datasource.id,
    organization: org.id,
    tableName: "test",
    tableSchema: "",
    databaseName: "",
    columns: [],
    refreshMS: 0,
    informationSchemaId: "",
  });

  // - licenses
  console.log("creating license");
  await LicenseModel.create({
    id: "license_123",
    companyName: "test",
    organizationId: org.id,
    seats: 0,
    hardCap: false,
    dateCreated: "",
    dateExpires: "",
    name: "",
    email: "",
    emailVerified: false,
    isTrial: false,
    plan: "oss",
    seatsInUse: 0,
    remoteDowngrade: false,
    installationUsers: {
      ["123"]: { date: "", userHashes: [] },
    },
    archived: false,
    dateUpdated: "",
    usingMongoCache: false,
    signedChecksum: "",
  });

  // - metrics
  console.log("creating metric");
  await insertMetric({
    id: "metric_123",
    organization: org.id,
    owner: user.id,
    datasource: datasource.id,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "metricc",
    description: "",
    type: "count",
    inverse: false,
    ignoreNulls: false,
    cappingSettings: {
      type: "absolute",
      value: 0,
      ignoreZeros: false,
    },
    windowSettings: {
      type: "conversion",
      delayHours: 0,
      windowValue: 0,
      windowUnit: "weeks",
    },
    queries: [],
    runStarted: null,
  });

  // - pastExperiments
  console.log("creating past experiments");
  await createPastExperiments({
    organization: org.id,
    datasource: datasource.id,
    experiments: [],
    start: new Date(),
    queries: [],
  });

  // - presentations
  console.log("creating presentation");
  await PresentationModel.create({
    id: "presentation_123",
    userId: user.id,
    organization: org.id,
    title: "test",
    description: "",
    options: {
      showScreenShots: false,
      showGraphs: false,
      graphType: "",
      hideMetric: [],
      hideRisk: false,
    },
    slides: [
      {
        _id: false,
        type: "",
        id: "",
        options: {
          showScreenShots: false,
          showGraphs: false,
          graphType: "",
          hideMetric: [],
          hideRisk: false,
        },
      },
    ],
    theme: "",
    customTheme: {
      backgroundColor: "",
      textColor: "",
      headingFont: "",
      bodyFont: "",
    },
    sharable: false,
    voting: false,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  // - projects
  console.log("creating project");
  await createProject(org.id, {
    name: "t",
  });

  // - queries
  console.log("creating query");
  await createNewQuery({
    organization: org.id,
    datasource: datasource.id,
    language: "sql",
    query: "",
    dependencies: [],
    running: false,
    queryType: "",
  });

  // - realtimeusages
  console.log("creating realtime usage");
  await RealtimeUsageModel.create({
    organization: org.id,
    hour: 0,
    features: {},
  });

  // - reports
  console.log("creating report");
  await createReport(org.id, {
    type: "experiment",
  });

  // - savedgroups
  console.log("creating saved group");
  await createSavedGroup(org.id, {
    groupName: "test",
    owner: user.id,
    type: "condition",
  });

  // - sdkconnections
  console.log("creating sdk connection");
  await createSDKConnection({
    name: "test",
    languages: [],
    organization: org.id,
    environment: "",
    projects: [],
    encryptPayload: false,
    hashSecureAttributes: false,
    includeVisualExperiments: false,
    includeDraftExperiments: false,
    includeExperimentNames: false,
    includeRedirectExperiments: false,
  });

  // - sdkpayloadcaches
  console.log("updating sdk payload");
  await updateSDKPayload({
    organization: org.id,
    environment: "",
    featureDefinitions: {},
    experimentsDefinitions: [],
  });
  //
  // - webhooks
  console.log("creating webhook");
  const webhook = await WebhookModel.create({
    id: "webhook_123",
    organization: org.id,
    name: "",
    endpoint: "",
    project: "",
    environment: "",
    featuresOnly: false,
    signingKey: "",
    lastSuccess: new Date(),
    error: "",
    created: new Date(),
    useSdkMode: false,
    sdks: [],
    sendPayload: false,
    headers: "",
    httpMethod: "",
  });

  // - sdkwebhooklogs
  console.log("creating sdk webhook log");
  await createSdkWebhookLog({
    webhookId: webhook.id,
    organizationId: org.id,
    payload: {},
    result: {
      state: "success",
      responseCode: 0,
      responseBody: "",
    },
    webhookReduestId: "test-123",
  });

  // - segments
  console.log("creating segment");
  await createSegment({
    id: "segment_123",
    organization: org.id,
    owner: user.id,
    datasource: "",
    userIdType: "",
    name: "",
    sql: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  // - slackintegrations
  console.log("creating slack integration");
  await createSlackIntegration({
    organizationId: org.id,
    id: "slack_123",
    name: "test",
    description: "",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    projects: [],
    environments: [],
    events: [],
    tags: [],
    slackAppId: "slackid",
    slackIncomingWebHook: "id",
    slackSigningKey: "key",
    linkedByUserId: user.id,
  });

  // - ssoconnections
  console.log("creating sso connection");
  await SSOConnectionModel.create({
    id: "ssoid_123",
    emailDomains: [],
    organization: org.id,
    dateCreated: new Date(),
    idpType: "",
    clientId: "",
    clientSecret: "",
    extraQueryParameters: {},
    additionalScope: "",
    metadata: {},
  });

  // - tags
  console.log("adding tag");
  await addTag(org.id, "test", "blue", "");

  // - teams
  console.log("creating team");
  await createTeam({
    name: "",
    organization: org.id,
    createdBy: "",
    description: "",
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    managedByIdp: false,
  });

  // - urlredirects
  console.log("creating url redirect");
  await createURLRedirect({
    experiment: experiment,
    context,
    urlPattern: "pattern",
    destinationURLs: [],
    persistQueryString: false,
  });

  // - visualchangesets
  console.log("creating visual changeset");
  await createVisualChangeset({
    experiment,
    context,
    urlPatterns: [],
    editorUrl: "someurl",
  });

  // - watches
  console.log("upserting watch");
  await upsertWatch({
    userId: user.id,
    organization: org.id,
    item: "test",
    type: "experiments",
  });
}
