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
  items: {
    name: string;
    description: string;
    // tags: string[]
  }[];
};

export const transformLDFeatureFlagToGBEnvironment = (
  data: LDListFeatureFlagsResponse
): Omit<FeatureInterface, "dateCreated" | "dateUpdated">[] => {
  //
};

// endregion LD
