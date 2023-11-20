import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";

// Various utilities to help migrate from another service to GrowthBook

// region LD

export type LDListProjectsResponse = {
  items: {
    key: string;
    name: string;
  }[];
};

/**
 * Transform responses from GET {{ base_url }}/api/v2/projects
 * @param data
 */
export const transformLDProjectsToGBProject = (
  data: LDListProjectsResponse
): Pick<ProjectInterface, "name" | "description">[] => {
  return data.items.map(({ key, name }) => ({
    name: key,
    description: name,
  }));
};

export type LDListEnvironmentsResponse = {
  items: {
    key: string;
    name: string;
  }[];
};

/**
 * Transforms responses from GET {{ base_url }}/api/v2/projects/{{ project_key }}/environments
 * @param data
 */
export const transformLDEnvironmentsToGBEnvironment = (
  data: LDListEnvironmentsResponse
): Environment[] => {
  return data.items.map(({ key, name }) => ({
    id: key,
    description: name,
  }));
};

export type LDListFeatureFlagsResponse = {
  _links: {
    self: {
      href: string; // "/api/v2/flags/default?summary=true"
    };
  };
  items: {
    key: string;
    name: string;
    description: string;
    kind: string;
    tags: string[];
    variations: {
      _id: string;
      value: unknown; // maps to `kind`
    }[];
    _maintainer?: {
      email: string;
      firstName: string;
      lastName: string;
      role: string;
    };
    environments: {
      [key: string]: {
        on: boolean;
        _environmentName: string;
        archived: boolean;
        _summary: {
          variations: {
            // key is a number as a string, e.g. '0', '1'
            [key: string]: {
              isFallthrough?: boolean;
              isOff?: boolean;
              nullRules: number;
              rules: number;
              targets: number;
            };
          };
        };
      };
    };
  }[];
};

export const transformLDFeatureFlagToGBFeature = (
  data: LDListFeatureFlagsResponse,
  project: string
): Omit<
  FeatureInterface,
  "dateCreated" | "dateUpdated" | "version" | "organization"
>[] => {
  return data.items.map(
    ({
      _maintainer,
      environments,
      key,
      kind,
      variations,
      name,
      description,
      tags,
    }) => {
      const envKeys = Object.keys(environments);

      const defaultValue = environments[envKeys[0]].on;

      const gbEnvironments: FeatureInterface["environmentSettings"] = {};
      envKeys.forEach((envKey) => {
        gbEnvironments[envKey] = {
          enabled: environments[envKey].on,
          // Note: Rules do not map 1-to-1 between GB and LD
          rules: [],
        };
      });

      const owner = _maintainer
        ? `${_maintainer.firstName} ${_maintainer.lastName} (${_maintainer.email})`
        : "(unknown - imported from LaunchDarkly)";

      return {
        environmentSettings: gbEnvironments,
        defaultValue:
          kind === "boolean"
            ? `${defaultValue}`
            : (variations["0"].value as string),
        project,
        id: key,
        description: description || name,
        owner,
        tags,
        // todo: get valueType a bit better
        valueType: kind === "boolean" ? "boolean" : "string",
      };
    }
  );
};

/**
 * Make a get request to LD with the provided API token
 * @param url
 * @param apiToken
 */
async function getFromLD<ResType>(
  url: string,
  apiToken: string
): Promise<ResType> {
  const response = await fetch(url, {
    headers: {
      Authorization: apiToken,
    },
  });
  if (!response.ok) {
    throw new Error(response.statusText);
  }

  return await response.json();
}

export const getLDProjects = async (
  apiToken: string
): Promise<LDListProjectsResponse> =>
  getFromLD("https://app.launchdarkly.com/api/v2/projects", apiToken);

export const getLDEnvironments = async (
  apiToken: string,
  project: string
): Promise<LDListEnvironmentsResponse> =>
  getFromLD(
    `https://app.launchdarkly.com/api/v2/projects/${project}/environments`,
    apiToken
  );

export const getLDFeatureFlags = async (
  apiToken: string,
  project: string
): Promise<LDListFeatureFlagsResponse> =>
  getFromLD(`https://app.launchdarkly.com/api/v2/flags/${project}`, apiToken);

// endregion LD
