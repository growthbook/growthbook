import { ProjectInterface } from "back-end/types/project";
import { Environment } from "back-end/types/organization";
import { FeatureInterface } from "back-end/types/feature";

// Various utilities to help migrate from another service to GrowthBook

// region LD

type LDListProjectsResponse = {
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

type LDListEnvironmentsResponse = {
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

type LDListFeatureFlagsResponse = {
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
    _maintainer: {
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

export const transformLDFeatureFlagToGBEnvironment = (
  data: LDListFeatureFlagsResponse,
  project: string
): Omit<
  FeatureInterface,
  "dateCreated" | "dateUpdated" | "revision" | "organization"
>[] => {
  return data.items.map(
    ({
      _maintainer: { email, firstName, lastName },
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

      return {
        // todo:
        environmentSettings: {},
        defaultValue:
          kind === "boolean"
            ? `${defaultValue}`
            : (variations["0"].value as string),
        project,
        id: key,
        description: description || name,
        owner: `${firstName} ${lastName} (${email})`,
        tags,
        // todo: get valueType a bit better
        valueType: kind === "boolean" ? "boolean" : "string",
      };
    }
  );
};

// endregion LD
