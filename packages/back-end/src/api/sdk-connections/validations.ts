import {
  getLatestSDKVersion,
  getSDKCapabilities,
  getSDKVersions,
} from "shared/sdk-versioning";
import { sdkLanguages } from "shared/constants";
import {
  CreateSDKConnectionParams,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import { ApiReqContext } from "back-end/types/api";
import { getEnvironments } from "back-end/src/services/organizations";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { OrganizationInterface } from "back-end/types/organization";

const capabilityParams = [
  ["encryption", "encryptPayload"],
  ["remoteEval", "remoteEvalEnabled"],
  ["visualEditor", "includeVisualExperiments"],
  ["redirects", "includeRedirectExperiments"],
] as const;

type CapabilitiesParamKey = (typeof capabilityParams)[number][1];
type CapabilitiesParams = { [k in CapabilitiesParamKey]?: boolean };

// Redirects and Visual Editor are premium features, but they are blocked
// When starting experiments, not when creating the SDK connection.
// This way, free users can still preview the features in a draft.
const premiumFeatures = [
  ["encrypt-features-endpoint", "encryptPayload"],
  ["hash-secure-attributes", "hashSecureAttributes"],
  ["remote-evaluation", "remoteEvalEnabled"],
  ["cloud-proxy", "proxyEnabled"],
] as const;

type PremiumFeatureName = (typeof premiumFeatures)[number][0];
type PremiumFeatureParam = (typeof premiumFeatures)[number][1];
type PremiumFeatures = { [k in PremiumFeatureParam]?: boolean };
type CreateSdkConnectionPayload = Omit<
  CreateSDKConnectionParams,
  "organization"
>;
type UpdateSdkConnectionPayload = Partial<CreateSdkConnectionPayload>;

interface CreateSdkConnectionRequestBody
  extends CapabilitiesParams,
    PremiumFeatures {
  name: string;
  environment: string;
  sdkVersion?: string;
  language?: string;
  projects?: string[];
  encryptPayload?: boolean;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  includeRuleIds?: boolean;
  includeProjectPublicId?: boolean;
  includeCustomFields?: string[];
  includeTags?: boolean;
  proxyHost?: string;
  hashSecureAttributes?: boolean;
}

const premiumOverrides: {
  [k in PremiumFeatureName]?: boolean;
} = {
  "cloud-proxy": !IS_CLOUD,
} as const;

export function validateName(name: string) {
  if (name.length < 3) {
    throw Error("Name length must be at least 3 characters");
  }
}

export function validateEnvironment(
  org: OrganizationInterface,
  environment: string,
) {
  if (
    !getEnvironments(org)
      .map(({ id }) => id)
      .includes(environment)
  )
    throw new Error(`Environment ${environment} does not exist!`);
}

export async function validateProjects(
  context: ApiReqContext,
  projects: string[],
) {
  const allProjects = await context.models.projects.getAll();
  const nonexistentProjects = projects.filter(
    (p) => !allProjects.some(({ id }) => p === id),
  );
  if (nonexistentProjects.length)
    throw new Error(
      `The following projects do not exist: ${nonexistentProjects.join(", ")}`,
    );
}

export function validateLanguage(reqLanguage: string): SDKLanguage {
  const language = sdkLanguages.find((l) => l === reqLanguage);
  if (!language) throw new Error(`Language ${reqLanguage} is not supported!`);
  return language;
}

export function validateSdkCapabilities(
  payload: CreateSdkConnectionPayload | UpdateSdkConnectionPayload,
  language: SDKLanguage,
  sdkVersion: string | undefined,
  latestSdkVersion: string,
) {
  const latestCapabilities = getSDKCapabilities(language, latestSdkVersion);
  const capabilities = getSDKCapabilities(language, sdkVersion);

  capabilityParams.forEach(([capability, param]) => {
    if (payload[param] && !capabilities.includes(capability))
      if (latestCapabilities.includes(capability))
        throw new Error(
          `You need to ugrade to version ${latestSdkVersion} to support ${capability}`,
        );
      else
        throw new Error(
          `SDK version ${sdkVersion} does not support ${capability}`,
        );
  });
}

export function validatePremiumFeatures(
  context: ApiReqContext,
  payload: CreateSdkConnectionPayload | UpdateSdkConnectionPayload,
) {
  premiumFeatures.forEach(([feature, param]) => {
    if (!payload[param]) return;

    if (premiumOverrides[feature]) return;

    if (!context.hasPremiumFeature(feature))
      throw new Error(`Feature ${feature} requires premium subscription!`);
  });
}

export function validateSdkVersion(sdkVersion: string, language: SDKLanguage) {
  if (!getSDKVersions(language).includes(sdkVersion)) {
    throw Error(`SDK version ${sdkVersion} does not exist for ${language}`);
  }
}

export async function validatePostPayload(
  context: ApiReqContext,
  {
    name,
    environment,
    sdkVersion: reqSdkVersion,
    language: reqLanguage,
    projects = [],
    encryptPayload = false,
    includeVisualExperiments = false,
    includeDraftExperiments = false,
    includeExperimentNames = false,
    includeRedirectExperiments = false,
    includeRuleIds = false,
    includeProjectPublicId = false,
    includeCustomFields = [],
    includeTags = false,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes = false,
    ...otherParams
  }: CreateSdkConnectionRequestBody,
) {
  validateName(name);

  validateEnvironment(context.org, environment);

  if (projects && projects.length) {
    await validateProjects(context, projects);
  }

  if (!reqLanguage) throw new Error("SDK connection requires a language!");

  const language = validateLanguage(reqLanguage);
  const latestSdkVersion = getLatestSDKVersion(language);
  const sdkVersion = reqSdkVersion || latestSdkVersion;
  validateSdkVersion(sdkVersion, language);

  const payload: CreateSdkConnectionPayload = {
    name,
    environment,
    sdkVersion,
    languages: [language],
    projects,
    encryptPayload,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    includeProjectPublicId,
    includeCustomFields,
    includeTags,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes,
    ...otherParams,
  };

  validateSdkCapabilities(payload, language, sdkVersion, latestSdkVersion);
  validatePremiumFeatures(context, payload);

  return payload;
}

export async function validatePutPayload(
  context: ApiReqContext,
  {
    name,
    environment,
    sdkVersion: reqSdkVersion,
    language: reqLanguage,
    projects,
    encryptPayload,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    includeProjectPublicId,
    includeCustomFields,
    includeTags,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes,
    ...otherParams
  }: Partial<CreateSdkConnectionRequestBody>,
  sdkConnection: SDKConnectionInterface,
) {
  if (name) validateName(name);

  if (environment) validateEnvironment(context.org, environment);

  if (projects && projects.length) {
    await validateProjects(context, projects);
  }

  const language = reqLanguage
    ? validateLanguage(reqLanguage)
    : sdkConnection.languages[0];

  const latestSdkVersion = getLatestSDKVersion(language);
  const sdkVersion =
    reqSdkVersion || sdkConnection.sdkVersion || latestSdkVersion;
  validateSdkVersion(sdkVersion, language);

  const payload: UpdateSdkConnectionPayload = {
    name,
    environment,
    sdkVersion,
    encryptPayload,
    includeVisualExperiments,
    includeDraftExperiments,
    includeExperimentNames,
    includeRedirectExperiments,
    includeRuleIds,
    includeProjectPublicId,
    includeCustomFields,
    includeTags,
    proxyEnabled,
    proxyHost,
    hashSecureAttributes,
    ...otherParams,
  };
  // Only apply these updates if they're being changed
  if (reqLanguage) {
    payload.languages = [language];
  }
  if (projects) {
    payload.projects = projects;
  }

  validateSdkCapabilities(payload, language, sdkVersion, latestSdkVersion);

  validatePremiumFeatures(context, payload);

  return payload;
}
