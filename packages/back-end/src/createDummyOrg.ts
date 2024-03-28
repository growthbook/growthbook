import { Request } from "express";
import { LicenseModel } from "enterprise/src/models/licenseModel";
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
import { createInitialRevision } from "./models/FeatureRevisionModel";
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
  const user = await createUser(
    "alice",
    "alice@growthbook.io",
    "test1234",
    true
  );

  // create user2
  const user2 = await createUser("bob", "bob@growthbook.io", "test1234", false);

  // create org
  const org = await createOrganization({
    email: user.email,
    userId: user.id,
    name: "Test - Org1",
  });

  // create org2
  await createOrganization({
    email: user.email,
    userId: user.id,
    name: "Test - Org2",
  });

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
  await addMemberToOrg({
    organization: org,
    userId: user2.id,
    role: "engineer",
    limitAccessByEnvironment: false,
    environments: [],
  });

  // - aitokenusages
  await updateTokenUsage({
    organization: org,
    numTokensUsed: 0,
  });

  // - apikeys
  await createOrganizationApiKey({
    organizationId: org.id,
    description: "",
    role: "readonly",
  });

  // - archetypes
  await createArchetype({
    organization: org.id,
    name: "test",
    description: "",
    owner: user.id,
    isPublic: true,
    attributes: "",
  });

  // - audits
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
  await createDimension({
    organization: org.id,
    owner: "test",
    datasource: datasource.id,
    userIdType: "test",
    name: "dimension",
    sql: "test",
  });

  // - dimensionslices
  await createDimensionSlices({
    organization: org.id,
    dataSourceId: datasource.id,
    queryId: "test",
  });

  // - discussions
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
  const eventWebHook = await createEventWebHook({
    name: "test",
    url: "",
    organizationId: org.id,
    enabled: false,
    events: [],
    projects: [],
    tags: [],
    environments: [],
    payloadType: "slack",
    method: "POST",
    headers: {},
  });

  // - eventwebhooklogs
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
  await createExperimentLaunchChecklist(org.id, user.id, [], "");

  // - experiments
  const experiment = await createExperiment({
    data: {
      id: "exp_123",
      organization: org.id,
    },
    context,
  });

  // - experimentsnapshots
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

  // - factmetrics
  context.models.factMetrics.create({
    name: "",
    description: "",
    owner: "",
    projects: [],
    tags: [],
    datasource: datasource.id,
    userIdTypes: [],
    sql: "",
    eventName: "",
    columns: [],
  });

  // - facttables
  await createFactTable(context, {
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

  // - features
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
  await upsertFeatureCodeRefs({
    // @ts-expect-error we do not care
    feature,
    repo: "",
    branch: "",
    codeRefs: [],
    organization: org,
  });

  // - featurerevisions
  // @ts-expect-error we do not care
  await createInitialRevision(feature, user, []);

  // - forgotpasswords
  //     - related to users
  await createForgotPasswordToken(user.email);

  // - githubintegrations
  await createGithubIntegration({
    organization: org.id,
    tokenId: "",
    createdBy: user.id,
  });

  // - githubusertokens
  await createGithubUserToken({
    organization: org.id,
    token: "",
    expiresAt: new Date(),
    refreshToken: "",
    refreshTokenExpiresAt: new Date(),
  });

  // - ideas
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
  await createImpactEstimate({
    organization: org.id,
    metric: "",
    conversionsPerDay: 2,
    query: "",
    queryLanguage: "sql",
    dateCreated: new Date(),
  });

  // - informationschemas
  await createInformationSchema(
    [
      {
        databaseName: "test",
        schemas: [],
        dateCreated: new Date(),
        dateUpdated: new Date(),
      },
    ],
    org.id,
    datasource.id
  );

  // - informationschematables
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
  await createPastExperiments({
    organization: org.id,
    datasource: datasource.id,
    experiments: [],
    start: new Date(),
    queries: [],
  });

  // - presentations
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
        type: { type: "" },
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
  await createProject(org.id, {
    name: "t",
  });

  // - queries
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
  await RealtimeUsageModel.create({
    organization: org.id,
    hour: 0,
    features: {},
  });

  // - reports
  await createReport(org.id, {
    type: "experiment",
  });

  // - savedgroups
  await createSavedGroup(org.id, {
    groupName: "test",
    owner: user.id,
    type: "condition",
  });

  // - sdkconnections
  await createSDKConnection({
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
  await updateSDKPayload({
    organization: org.id,
    environment: "",
    featureDefinitions: {},
    experimentsDefinitions: [],
  });

  // - sdkwebhooklogs
  await createSdkWebhookLog({
    webhookId: "",
    organizationId: org.id,
    payload: {},
    result: {
      state: "success",
      responseCode: 0,
      responseBody: "",
    },
    webhookReduestId: "",
  });

  // - segments
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
  await createSlackIntegration({
    organizationId: org.id,
    name: "",
    description: "",
    projects: [],
    environments: [],
    events: [],
    tags: [],
    slackAppId: "",
    slackIncomingWebHook: "",
    slackSigningKey: "",
    linkedByUserId: "",
  });

  // - ssoconnections
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
  await addTag(org.id, "test", "blue", "");

  // - teams
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
  await createURLRedirect({
    experiment: experiment,
    context,
    urlPattern: "",
    destinationURLs: [],
    persistQueryString: false,
  });

  // - visualchangesets
  await createVisualChangeset({
    experiment,
    context,
    urlPatterns: [],
    editorUrl: "",
  });

  // - watches
  await upsertWatch({
    userId: user.id,
    organization: org.id,
    item: "",
    type: "experiments",
  });

  // - webhooks
  await WebhookModel.create({
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
}
