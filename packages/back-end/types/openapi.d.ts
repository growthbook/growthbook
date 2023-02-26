/* eslint-disable */
/**
 * This file was auto-generated. DO NOT MODIFY DIRECTLY
 * Instead, modify the source OpenAPI schema in back-end/src/api/openapi
 * and run `yarn generate-api-types` to re-generate this file.
 */
/** OneOf type helpers */
type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };
type XOR<T, U> = (T | U) extends object ? (Without<T, U> & U) | (Without<U, T> & T) : T | U;
type OneOf<T extends any[]> = T extends [infer Only] ? Only : T extends [infer A, infer B, ...infer Rest] ? OneOf<[XOR<A, B>, ...Rest]> : never;

export interface paths {
  "/features": {
    /** Get all features */
    get: operations["listFeatures"];
  };
  "/features/{id}": {
    /** Get a single feature */
    get: operations["getFeature"];
    
  };
  "/features/{id}/toggle": {
    /** Toggle a feature in one or more environments */
    post: operations["toggleFeature"];
    
  };
  "/projects": {
    /** Get all projects */
    get: operations["listProjects"];
  };
  "/projects/{id}": {
    /** Get a single project */
    get: operations["getProject"];
    
  };
  "/dimensions": {
    /** Get all dimensions */
    get: operations["listDimensions"];
  };
  "/dimensions/{id}": {
    /** Get a single dimension */
    get: operations["getDimension"];
    
  };
  "/segments": {
    /** Get all segments */
    get: operations["listSegments"];
  };
  "/segments/{id}": {
    /** Get a single segment */
    get: operations["getSegment"];
    
  };
  "/metrics": {
    /** Get all metrics */
    get: operations["listMetrics"];
  };
  "/metrics/{id}": {
    /** Get a single metric */
    get: operations["getMetric"];
    
  };
  "/sdk-connections": {
    /** Get all sdk connections */
    get: operations["listSdkConnections"];
  };
  "/sdk-connections/{id}": {
    /** Get a single sdk connection */
    get: operations["getSdkConnection"];
    
  };
}

export type webhooks = Record<string, never>;

export interface components {
  schemas: {
    PaginationFields: {
      limit: number;
      offset: number;
      count: number;
      total: number;
      hasMore: boolean;
      nextOffset: OneOf<[number, null]>;
    };
    Dimension: {
      id: string;
      dateCreated: string;
      dateUpdated: string;
      owner: string;
      datasourceId: string;
      identifierType: string;
      name: string;
      query: string;
    };
    Metric: {
      id: string;
      dateCreated: string;
      dateUpdated: string;
      owner: string;
      datasourceId: string;
      name: string;
      description: string;
      type: string;
      tags: (string)[];
      projects: (string)[];
      archived: boolean;
      behavior: {
        /** @enum {string} */
        goal: "increase" | "decrease";
        cap: number;
        conversionWindowStart: number;
        conversionWindowEnd: number;
        riskThresholdSuccess: number;
        riskThresholdDanger: number;
        minPercentChange: number;
        maxPercentChange: number;
        minSampleSize: number;
      };
      sql?: {
        identifierTypes: (string)[];
        conversionSQL: string;
        userAggregationSQL: string;
        denominatorMetricId: string;
        builder?: {
          identifierTypeColumns: ({
              identifierType: string;
              columnName: string;
            })[];
          tableName: string;
          valueColumnName: string;
          timestampColumnName: string;
          conditions: ({
              column: string;
              operator: string;
              value: string;
            })[];
        };
      };
      mixpanel?: {
        eventName: string;
        eventValue: string;
        userAggregation: string;
        conditions: ({
            property: string;
            operator: string;
            value: string;
          })[];
      };
    };
    Project: {
      id: string;
      name: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
    };
    Segment: {
      id: string;
      owner: string;
      datasourceId: string;
      identifierType: string;
      name: string;
      query: string;
      dateCreated: string;
      dateUpdated: string;
    };
    Feature: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      archived: boolean;
      description: string;
      owner: string;
      project: string;
      /** @enum {string} */
      valueType: "boolean" | "string" | "number" | "json";
      defaultValue: string;
      tags: (string)[];
      environments: {
        [key: string]: components["schemas"]["FeatureEnvironment"] | undefined;
      };
      revision: {
        version: number;
        comment: string;
        /** Format: date-time */
        date: string;
        publishedBy: string;
      };
    };
    FeatureEnvironment: {
      enabled: boolean;
      defaultValue: string;
      rules: (components["schemas"]["FeatureRule"])[];
      definition?: components["schemas"]["FeatureDefinition"];
      draft?: {
        enabled: boolean;
        defaultValue: string;
        rules: (components["schemas"]["FeatureRule"])[];
        definition?: components["schemas"]["FeatureDefinition"];
      };
    };
    FeatureRule: components["schemas"]["FeatureForceRule"] | components["schemas"]["FeatureRolloutRule"] | components["schemas"]["FeatureExperimentRule"];
    FeatureDefinition: {
      defaultValue: any;
      rules?: ({
          force?: any;
          weights?: (number)[];
          variations?: (any)[];
          hashAttribute?: string;
          namespace?: (unknown)[];
          key?: string;
          coverage?: number;
          condition?: {
            [key: string]: unknown | undefined;
          };
        })[];
    };
    FeatureForceRule: {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      value: string;
    };
    FeatureRolloutRule: {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      value: string;
      coverage: number;
      hashAttribute: string;
    };
    FeatureExperimentRule: {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      trackingKey?: string;
      hashAttribute?: string;
      namespace?: {
        enabled: boolean;
        name: string;
        range: (unknown)[];
      };
      coverage?: number;
      value?: ({
          value: string;
          weight: number;
          name?: string;
        })[];
    };
    SdkConnection: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      languages: (string)[];
      environment: string;
      project: string;
      encryptPayload: boolean;
      encryptionKey: string;
      key: string;
      proxyEnabled: boolean;
      proxyHost: string;
      proxySigningKey: string;
    };
  };
  responses: {
    Error: never;
  };
  parameters: {
    id: string;
    limit: number;
    offset: number;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type external = Record<string, never>;

export interface operations {

  listFeatures: {
    /** Get all features */
    responses: {
      200: {
        content: {
          "application/json": {
            features: (components["schemas"]["Feature"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getFeature: {
    /** Get a single feature */
    responses: {
      200: {
        content: {
          "application/json": {
            feature: components["schemas"]["Feature"];
          };
        };
      };
    };
  };
  toggleFeature: {
    /** Toggle a feature in one or more environments */
    responses: {
      200: {
        content: {
          "application/json": {
            feature: components["schemas"]["Feature"];
          };
        };
      };
    };
  };
  listProjects: {
    /** Get all projects */
    responses: {
      200: {
        content: {
          "application/json": {
            projects: (components["schemas"]["Project"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getProject: {
    /** Get a single project */
    responses: {
      200: {
        content: {
          "application/json": {
            project: components["schemas"]["Project"];
          };
        };
      };
    };
  };
  listDimensions: {
    /** Get all dimensions */
    responses: {
      200: {
        content: {
          "application/json": {
            dimensions: (components["schemas"]["Dimension"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getDimension: {
    /** Get a single dimension */
    responses: {
      200: {
        content: {
          "application/json": {
            dimension: components["schemas"]["Dimension"];
          };
        };
      };
    };
  };
  listSegments: {
    /** Get all segments */
    responses: {
      200: {
        content: {
          "application/json": {
            segments: (components["schemas"]["Segment"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getSegment: {
    /** Get a single segment */
    responses: {
      200: {
        content: {
          "application/json": {
            segment: components["schemas"]["Segment"];
          };
        };
      };
    };
  };
  listMetrics: {
    /** Get all metrics */
    responses: {
      200: {
        content: {
          "application/json": {
            metrics: (components["schemas"]["Metric"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getMetric: {
    /** Get a single metric */
    responses: {
      200: {
        content: {
          "application/json": {
            metric: components["schemas"]["Metric"];
          };
        };
      };
    };
  };
  listSdkConnections: {
    /** Get all sdk connections */
    responses: {
      200: {
        content: {
          "application/json": {
            connections?: (components["schemas"]["SdkConnection"])[];
          } & components["schemas"]["PaginationFields"];
        };
      };
    };
  };
  getSdkConnection: {
    /** Get a single sdk connection */
    responses: {
      200: {
        content: {
          "application/json": {
            sdkConnection: components["schemas"]["SdkConnection"];
          };
        };
      };
    };
  };
}

// Schemas
export type ApiPaginationFields = components["schemas"]["PaginationFields"];
export type ApiDimension = components["schemas"]["Dimension"];
export type ApiMetric = components["schemas"]["Metric"];
export type ApiProject = components["schemas"]["Project"];
export type ApiSegment = components["schemas"]["Segment"];
export type ApiFeature = components["schemas"]["Feature"];
export type ApiFeatureEnvironment = components["schemas"]["FeatureEnvironment"];
export type ApiFeatureRule = components["schemas"]["FeatureRule"];
export type ApiFeatureDefinition = components["schemas"]["FeatureDefinition"];
export type ApiFeatureForceRule = components["schemas"]["FeatureForceRule"];
export type ApiFeatureRolloutRule = components["schemas"]["FeatureRolloutRule"];
export type ApiFeatureExperimentRule = components["schemas"]["FeatureExperimentRule"];
export type ApiSdkConnection = components["schemas"]["SdkConnection"];

// Operations
export type ListFeaturesResponse = operations["listFeatures"]["responses"]["200"]["content"]["application/json"];
export type GetFeatureResponse = operations["getFeature"]["responses"]["200"]["content"]["application/json"];
export type ToggleFeatureResponse = operations["toggleFeature"]["responses"]["200"]["content"]["application/json"];
export type ListProjectsResponse = operations["listProjects"]["responses"]["200"]["content"]["application/json"];
export type GetProjectResponse = operations["getProject"]["responses"]["200"]["content"]["application/json"];
export type ListDimensionsResponse = operations["listDimensions"]["responses"]["200"]["content"]["application/json"];
export type GetDimensionResponse = operations["getDimension"]["responses"]["200"]["content"]["application/json"];
export type ListSegmentsResponse = operations["listSegments"]["responses"]["200"]["content"]["application/json"];
export type GetSegmentResponse = operations["getSegment"]["responses"]["200"]["content"]["application/json"];
export type ListMetricsResponse = operations["listMetrics"]["responses"]["200"]["content"]["application/json"];
export type GetMetricResponse = operations["getMetric"]["responses"]["200"]["content"]["application/json"];
export type ListSdkConnectionsResponse = operations["listSdkConnections"]["responses"]["200"]["content"]["application/json"];
export type GetSdkConnectionResponse = operations["getSdkConnection"]["responses"]["200"]["content"]["application/json"];
