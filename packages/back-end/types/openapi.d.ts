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
    /** Create a single feature */
    post: operations["postFeature"];
  };
  "/features/{id}": {
    /** Get a single feature */
    get: operations["getFeature"];
    /** Partially update a feature */
    post: operations["updateFeature"];
  };
  "/features/{id}/toggle": {
    /** Toggle a feature in one or more environments */
    post: operations["toggleFeature"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/feature-keys": {
    /** Get list of feature keys */
    get: operations["getFeatureKeys"];
  };
  "/projects": {
    /** Get all projects */
    get: operations["listProjects"];
  };
  "/projects/{id}": {
    /** Get a single project */
    get: operations["getProject"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/dimensions": {
    /** Get all dimensions */
    get: operations["listDimensions"];
  };
  "/dimensions/{id}": {
    /** Get a single dimension */
    get: operations["getDimension"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/segments": {
    /** Get all segments */
    get: operations["listSegments"];
  };
  "/segments/{id}": {
    /** Get a single segment */
    get: operations["getSegment"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/sdk-connections": {
    /** Get all sdk connections */
    get: operations["listSdkConnections"];
  };
  "/sdk-connections/{id}": {
    /** Get a single sdk connection */
    get: operations["getSdkConnection"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/data-sources": {
    /** Get all data sources */
    get: operations["listDataSources"];
  };
  "/data-sources/{id}": {
    /** Get a single data source */
    get: operations["getDataSource"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/experiments": {
    /** Get all experiments */
    get: operations["listExperiments"];
    /** Create a single experiment */
    post: operations["postExperiment"];
  };
  "/experiments/{id}": {
    /** Get a single experiment */
    get: operations["getExperiment"];
    /** Update a single experiment */
    post: operations["updateExperiment"];
  };
  "/experiments/{id}/results": {
    /** Get results for an experiment */
    get: operations["getExperimentResults"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/metrics": {
    /** Get all metrics */
    get: operations["listMetrics"];
    /** Create a single metric */
    post: operations["postMetric"];
  };
  "/metrics/{id}": {
    /** Get a single metric */
    get: operations["getMetric"];
    /** Update a metric */
    put: operations["putMetric"];
    /** Deletes a metric */
    delete: operations["deleteMetric"];
  };
  "/experiments/{id}/visual-changesets": {
    /** Get all visual changesets */
    get: operations["listVisualChangesets"];
  };
  "/visual-changesets/{id}": {
    /** Get a single visual changeset */
    get: operations["getVisualChangeset"];
    /** Update a visual changeset */
    put: operations["putVisualChangeset"];
  };
  "/visual-changesets/{id}/visual-change": {
    /** Create a visual change for a visual changeset */
    post: operations["postVisualChange"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
  };
  "/visual-changesets/{id}/visual-change/{visualChangeId}": {
    /** Update a visual change for a visual changeset */
    put: operations["putVisualChange"];
    parameters: {
        /** @description The id of the requested resource */
        /** @description Specify a specific visual change */
      path: {
        id: string;
        visualChangeId: string;
      };
    };
  };
  "/saved-groups": {
    /** Get all saved group */
    get: operations["listSavedGroups"];
    /** Create a single saved group */
    post: operations["postSavedGroup"];
  };
  "/saved-groups/{id}": {
    /** Get a single saved group */
    get: operations["getSavedGroup"];
    /** Partially update a single saved group */
    post: operations["updateSavedGroup"];
    /** Deletes a single saved group */
    delete: operations["deleteSavedGroup"];
  };
  "/organizations": {
    /** Get all organizations (only for super admins on multi-org Enterprise Plan only) */
    get: operations["listOrganizations"];
    /** Create a single organization (only for super admins on multi-org Enterprise Plan only) */
    post: operations["postOrganization"];
  };
  "/organizations/{id}": {
    /** Edit a single organization (only for super admins on multi-org Enterprise Plan only) */
    put: operations["putOrganization"];
  };
  "/fact-tables": {
    /** Get all fact tables */
    get: operations["listFactTables"];
    /** Create a single fact table */
    post: operations["postFactTable"];
  };
  "/fact-tables/{id}": {
    /** Get a single fact table */
    get: operations["getFactTable"];
    /** Update a single fact table */
    post: operations["updateFactTable"];
    /** Deletes a single fact table */
    delete: operations["deleteFactTable"];
  };
  "/fact-tables/{factTableId}/filters": {
    /** Get all filters for a fact table */
    get: operations["listFactTableFilters"];
    /** Create a single fact table filter */
    post: operations["postFactTableFilter"];
  };
  "/fact-tables/{factTableId}/filters/{id}": {
    /** Get a single fact filter */
    get: operations["getFactTableFilter"];
    /** Update a single fact table filter */
    post: operations["updateFactTableFilter"];
    /** Deletes a single fact table filter */
    delete: operations["deleteFactTableFilter"];
  };
  "/fact-metrics": {
    /** Get all fact metrics */
    get: operations["listFactMetrics"];
    /** Create a single fact metric */
    post: operations["postFactMetric"];
  };
  "/fact-metrics/{id}": {
    /** Get a single fact metric */
    get: operations["getFactMetric"];
    /** Update a single fact metric */
    post: operations["updateFactMetric"];
    /** Deletes a single fact metric */
    delete: operations["deleteFactMetric"];
  };
  "/bulk-import/facts": {
    /** Bulk import fact tables, filters, and metrics */
    post: operations["postBulkImportFacts"];
  };
  "/code-refs": {
    /** Submit list of code references */
    post: operations["postCodeRefs"];
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
      /** @enum {string} */
      type: "binomial" | "count" | "duration" | "revenue";
      tags: (string)[];
      projects: (string)[];
      archived: boolean;
      behavior: {
        /** @enum {string} */
        goal: "increase" | "decrease";
        cap?: number;
        /** @enum {string|null} */
        capping?: "absolute" | "percentile" | null;
        capValue?: number;
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
      };
      sqlBuilder?: {
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
      description?: string;
      settings?: {
        statsEngine?: string;
      };
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
        [key: string]: ({
          enabled: boolean;
          defaultValue: string;
          rules: (({
              description: string;
              condition: string;
              savedGroupTargeting?: ({
                  /** @enum {string} */
                  matchType: "all" | "any" | "none";
                  savedGroups: (string)[];
                })[];
              id: string;
              enabled: boolean;
              type: string;
              value: string;
            }) | ({
              description: string;
              condition: string;
              savedGroupTargeting?: ({
                  /** @enum {string} */
                  matchType: "all" | "any" | "none";
                  savedGroups: (string)[];
                })[];
              id: string;
              enabled: boolean;
              type: string;
              value: string;
              coverage: number;
              hashAttribute: string;
            }) | {
              description: string;
              condition: string;
              id: string;
              enabled: boolean;
              type: string;
              trackingKey?: string;
              hashAttribute?: string;
              fallbackAttribute?: string;
              disableStickyBucketing?: any;
              bucketVersion?: number;
              minBucketVersion?: number;
              excludeBlockedBucketUsers?: boolean;
              namespace?: {
                enabled: boolean;
                name: string;
                range: (number)[];
              };
              coverage?: number;
              value?: ({
                  value: string;
                  weight: number;
                  name?: string;
                })[];
            } | {
              description: string;
              id: string;
              enabled: boolean;
              type: string;
              condition?: string;
              variations: ({
                  value: string;
                  variationId: string;
                })[];
              experimentId: string;
            })[];
          /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
          definition?: string;
          draft?: {
            enabled: boolean;
            defaultValue: string;
            rules: (({
                description: string;
                condition: string;
                savedGroupTargeting?: ({
                    /** @enum {string} */
                    matchType: "all" | "any" | "none";
                    savedGroups: (string)[];
                  })[];
                id: string;
                enabled: boolean;
                type: string;
                value: string;
              }) | ({
                description: string;
                condition: string;
                savedGroupTargeting?: ({
                    /** @enum {string} */
                    matchType: "all" | "any" | "none";
                    savedGroups: (string)[];
                  })[];
                id: string;
                enabled: boolean;
                type: string;
                value: string;
                coverage: number;
                hashAttribute: string;
              }) | {
                description: string;
                condition: string;
                id: string;
                enabled: boolean;
                type: string;
                trackingKey?: string;
                hashAttribute?: string;
                fallbackAttribute?: string;
                disableStickyBucketing?: any;
                bucketVersion?: number;
                minBucketVersion?: number;
                excludeBlockedBucketUsers?: boolean;
                namespace?: {
                  enabled: boolean;
                  name: string;
                  range: (number)[];
                };
                coverage?: number;
                value?: ({
                    value: string;
                    weight: number;
                    name?: string;
                  })[];
              } | {
                description: string;
                id: string;
                enabled: boolean;
                type: string;
                condition?: string;
                variations: ({
                    value: string;
                    variationId: string;
                  })[];
                experimentId: string;
              })[];
            /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
            definition?: string;
          };
        }) | undefined;
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
      rules: (({
          description: string;
          condition: string;
          savedGroupTargeting?: ({
              /** @enum {string} */
              matchType: "all" | "any" | "none";
              savedGroups: (string)[];
            })[];
          id: string;
          enabled: boolean;
          type: string;
          value: string;
        }) | ({
          description: string;
          condition: string;
          savedGroupTargeting?: ({
              /** @enum {string} */
              matchType: "all" | "any" | "none";
              savedGroups: (string)[];
            })[];
          id: string;
          enabled: boolean;
          type: string;
          value: string;
          coverage: number;
          hashAttribute: string;
        }) | {
          description: string;
          condition: string;
          id: string;
          enabled: boolean;
          type: string;
          trackingKey?: string;
          hashAttribute?: string;
          fallbackAttribute?: string;
          disableStickyBucketing?: any;
          bucketVersion?: number;
          minBucketVersion?: number;
          excludeBlockedBucketUsers?: boolean;
          namespace?: {
            enabled: boolean;
            name: string;
            range: (number)[];
          };
          coverage?: number;
          value?: ({
              value: string;
              weight: number;
              name?: string;
            })[];
        } | {
          description: string;
          id: string;
          enabled: boolean;
          type: string;
          condition?: string;
          variations: ({
              value: string;
              variationId: string;
            })[];
          experimentId: string;
        })[];
      /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
      definition?: string;
      draft?: {
        enabled: boolean;
        defaultValue: string;
        rules: (({
            description: string;
            condition: string;
            savedGroupTargeting?: ({
                /** @enum {string} */
                matchType: "all" | "any" | "none";
                savedGroups: (string)[];
              })[];
            id: string;
            enabled: boolean;
            type: string;
            value: string;
          }) | ({
            description: string;
            condition: string;
            savedGroupTargeting?: ({
                /** @enum {string} */
                matchType: "all" | "any" | "none";
                savedGroups: (string)[];
              })[];
            id: string;
            enabled: boolean;
            type: string;
            value: string;
            coverage: number;
            hashAttribute: string;
          }) | {
            description: string;
            condition: string;
            id: string;
            enabled: boolean;
            type: string;
            trackingKey?: string;
            hashAttribute?: string;
            fallbackAttribute?: string;
            disableStickyBucketing?: any;
            bucketVersion?: number;
            minBucketVersion?: number;
            excludeBlockedBucketUsers?: boolean;
            namespace?: {
              enabled: boolean;
              name: string;
              range: (number)[];
            };
            coverage?: number;
            value?: ({
                value: string;
                weight: number;
                name?: string;
              })[];
          } | {
            description: string;
            id: string;
            enabled: boolean;
            type: string;
            condition?: string;
            variations: ({
                value: string;
                variationId: string;
              })[];
            experimentId: string;
          })[];
        /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
        definition?: string;
      };
    };
    FeatureRule: ({
      description: string;
      condition: string;
      savedGroupTargeting?: ({
          /** @enum {string} */
          matchType: "all" | "any" | "none";
          savedGroups: (string)[];
        })[];
      id: string;
      enabled: boolean;
      type: string;
      value: string;
    }) | ({
      description: string;
      condition: string;
      savedGroupTargeting?: ({
          /** @enum {string} */
          matchType: "all" | "any" | "none";
          savedGroups: (string)[];
        })[];
      id: string;
      enabled: boolean;
      type: string;
      value: string;
      coverage: number;
      hashAttribute: string;
    }) | {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      trackingKey?: string;
      hashAttribute?: string;
      fallbackAttribute?: string;
      disableStickyBucketing?: any;
      bucketVersion?: number;
      minBucketVersion?: number;
      excludeBlockedBucketUsers?: boolean;
      namespace?: {
        enabled: boolean;
        name: string;
        range: (number)[];
      };
      coverage?: number;
      value?: ({
          value: string;
          weight: number;
          name?: string;
        })[];
    } | {
      description: string;
      id: string;
      enabled: boolean;
      type: string;
      condition?: string;
      variations: ({
          value: string;
          variationId: string;
        })[];
      experimentId: string;
    };
    FeatureDefinition: {
      defaultValue: OneOf<[string, number, (unknown)[], any, null]>;
      rules?: ({
          force?: OneOf<[string, number, (unknown)[], any, null]>;
          weights?: (number)[];
          variations?: (OneOf<[string, number, (unknown)[], any, null]>)[];
          hashAttribute?: string;
          namespace?: (OneOf<[number, string]>)[];
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
      savedGroupTargeting?: ({
          /** @enum {string} */
          matchType: "all" | "any" | "none";
          savedGroups: (string)[];
        })[];
      id: string;
      enabled: boolean;
      type: string;
      value: string;
    };
    FeatureRolloutRule: {
      description: string;
      condition: string;
      savedGroupTargeting?: ({
          /** @enum {string} */
          matchType: "all" | "any" | "none";
          savedGroups: (string)[];
        })[];
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
      fallbackAttribute?: string;
      disableStickyBucketing?: any;
      bucketVersion?: number;
      minBucketVersion?: number;
      excludeBlockedBucketUsers?: boolean;
      namespace?: {
        enabled: boolean;
        name: string;
        range: (number)[];
      };
      coverage?: number;
      value?: ({
          value: string;
          weight: number;
          name?: string;
        })[];
    };
    FeatureExperimentRefRule: {
      description: string;
      id: string;
      enabled: boolean;
      type: string;
      condition?: string;
      variations: ({
          value: string;
          variationId: string;
        })[];
      experimentId: string;
    };
    SdkConnection: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      organization: string;
      languages: (string)[];
      sdkVersion?: string;
      environment: string;
      /** @description Use 'projects' instead. This is only for backwards compatibility and contains the first project only. */
      project: string;
      projects?: (string)[];
      encryptPayload: boolean;
      encryptionKey: string;
      includeVisualExperiments?: boolean;
      includeDraftExperiments?: boolean;
      includeExperimentNames?: boolean;
      key: string;
      proxyEnabled: boolean;
      proxyHost: string;
      proxySigningKey: string;
      sseEnabled?: boolean;
      hashSecureAttributes?: boolean;
      remoteEvalEnabled?: boolean;
    };
    Experiment: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      project: string;
      hypothesis: string;
      description: string;
      tags: (string)[];
      owner: string;
      archived: boolean;
      status: string;
      autoRefresh: boolean;
      hashAttribute: string;
      fallbackAttribute?: string;
      /** @enum {number} */
      hashVersion: 1 | 2;
      disableStickyBucketing?: any;
      bucketVersion?: number;
      minBucketVersion?: number;
      excludeBlockedBucketUsers?: boolean;
      variations: ({
          variationId: string;
          key: string;
          name: string;
          description: string;
          screenshots: (string)[];
        })[];
      phases: ({
          name: string;
          dateStarted: string;
          dateEnded: string;
          reasonForStopping: string;
          seed: string;
          coverage: number;
          trafficSplit: ({
              variationId: string;
              weight: number;
            })[];
          namespace?: {
            namespaceId: string;
            range: (unknown)[];
          };
          targetingCondition: string;
          savedGroupTargeting?: ({
              /** @enum {string} */
              matchType: "all" | "any" | "none";
              savedGroups: (string)[];
            })[];
        })[];
      settings: {
        datasourceId: string;
        assignmentQueryId: string;
        experimentId: string;
        segmentId: string;
        queryFilter: string;
        /** @enum {unknown} */
        inProgressConversions: "include" | "exclude";
        /** @enum {unknown} */
        attributionModel: "firstExposure" | "experimentDuration";
        /** @enum {unknown} */
        statsEngine: "bayesian" | "frequentist";
        goals: ({
            metricId: string;
            overrides: {
              conversionWindowStart?: number;
              conversionWindowEnd?: number;
              winRiskThreshold?: number;
              loseRiskThreshold?: number;
            };
          })[];
        guardrails: ({
            metricId: string;
            overrides: {
              conversionWindowStart?: number;
              conversionWindowEnd?: number;
              winRiskThreshold?: number;
              loseRiskThreshold?: number;
            };
          })[];
        activationMetric?: {
          metricId: string;
          overrides: {
            conversionWindowStart?: number;
            conversionWindowEnd?: number;
            winRiskThreshold?: number;
            loseRiskThreshold?: number;
          };
        };
      };
      resultSummary?: {
        status: string;
        winner: string;
        conclusions: string;
        releasedVariationId: string;
        excludeFromPayload: boolean;
      };
    };
    ExperimentMetric: {
      metricId: string;
      overrides: {
        conversionWindowStart?: number;
        conversionWindowEnd?: number;
        winRiskThreshold?: number;
        loseRiskThreshold?: number;
      };
    };
    ExperimentAnalysisSettings: {
      datasourceId: string;
      assignmentQueryId: string;
      experimentId: string;
      segmentId: string;
      queryFilter: string;
      /** @enum {unknown} */
      inProgressConversions: "include" | "exclude";
      /** @enum {unknown} */
      attributionModel: "firstExposure" | "experimentDuration";
      /** @enum {unknown} */
      statsEngine: "bayesian" | "frequentist";
      goals: ({
          metricId: string;
          overrides: {
            conversionWindowStart?: number;
            conversionWindowEnd?: number;
            winRiskThreshold?: number;
            loseRiskThreshold?: number;
          };
        })[];
      guardrails: ({
          metricId: string;
          overrides: {
            conversionWindowStart?: number;
            conversionWindowEnd?: number;
            winRiskThreshold?: number;
            loseRiskThreshold?: number;
          };
        })[];
      activationMetric?: {
        metricId: string;
        overrides: {
          conversionWindowStart?: number;
          conversionWindowEnd?: number;
          winRiskThreshold?: number;
          loseRiskThreshold?: number;
        };
      };
    };
    ExperimentResults: {
      id: string;
      dateUpdated: string;
      experimentId: string;
      phase: string;
      dateStart: string;
      dateEnd: string;
      dimension: {
        type: string;
        id?: string;
      };
      settings: {
        datasourceId: string;
        assignmentQueryId: string;
        experimentId: string;
        segmentId: string;
        queryFilter: string;
        /** @enum {unknown} */
        inProgressConversions: "include" | "exclude";
        /** @enum {unknown} */
        attributionModel: "firstExposure" | "experimentDuration";
        /** @enum {unknown} */
        statsEngine: "bayesian" | "frequentist";
        goals: ({
            metricId: string;
            overrides: {
              conversionWindowStart?: number;
              conversionWindowEnd?: number;
              winRiskThreshold?: number;
              loseRiskThreshold?: number;
            };
          })[];
        guardrails: ({
            metricId: string;
            overrides: {
              conversionWindowStart?: number;
              conversionWindowEnd?: number;
              winRiskThreshold?: number;
              loseRiskThreshold?: number;
            };
          })[];
        activationMetric?: {
          metricId: string;
          overrides: {
            conversionWindowStart?: number;
            conversionWindowEnd?: number;
            winRiskThreshold?: number;
            loseRiskThreshold?: number;
          };
        };
      };
      queryIds: (string)[];
      results: ({
          dimension: string;
          totalUsers: number;
          checks: {
            srm: number;
          };
          metrics: ({
              metricId: string;
              variations: ({
                  variationId: string;
                  analyses: ({
                      /** @enum {unknown} */
                      engine: "bayesian" | "frequentist";
                      numerator: number;
                      denominator: number;
                      mean: number;
                      stddev: number;
                      percentChange: number;
                      ciLow: number;
                      ciHigh: number;
                      pValue?: number;
                      risk?: number;
                      chanceToBeatControl?: number;
                    })[];
                })[];
            })[];
        })[];
    };
    DataSource: {
      id: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      type: string;
      name: string;
      description: string;
      projectIds: (string)[];
      eventTracker: string;
      identifierTypes: ({
          id: string;
          description: string;
        })[];
      assignmentQueries: ({
          id: string;
          name: string;
          description: string;
          identifierType: string;
          sql: string;
          includesNameColumns: boolean;
          dimensionColumns: (string)[];
        })[];
      identifierJoinQueries: ({
          identifierTypes: (string)[];
          sql: string;
        })[];
      mixpanelSettings?: {
        viewedExperimentEventName: string;
        experimentIdProperty: string;
        variationIdProperty: string;
        extraUserIdProperty: string;
      };
    };
    VisualChangeset: {
      id?: string;
      urlPatterns: ({
          include?: boolean;
          /** @enum {string} */
          type: "simple" | "regex";
          pattern: string;
        })[];
      editorUrl: string;
      experiment: string;
      visualChanges: ({
          description?: string;
          css?: string;
          js?: string;
          variation: string;
          domMutations: ({
              selector: string;
              /** @enum {string} */
              action: "append" | "set" | "remove";
              attribute: string;
              value?: string;
              parentSelector?: string;
              insertBeforeSelector?: string;
            })[];
        })[];
    };
    VisualChange: {
      description?: string;
      css?: string;
      js?: string;
      variation: string;
      domMutations?: ({
          selector: string;
          /** @enum {string} */
          action: "append" | "set" | "remove";
          attribute: string;
          value?: string;
          parentSelector?: string;
          insertBeforeSelector?: string;
        })[];
    };
    SavedGroup: {
      id: string;
      /** @enum {string} */
      type: "condition" | "list";
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      owner?: string;
      /** @description When type = 'condition', this is the JSON-encoded condition for the group */
      condition?: string;
      /** @description When type = 'list', this is the attribute key the group is based on */
      attributeKey?: string;
      /** @description When type = 'list', this is the list of values for the attribute key */
      values?: (string)[];
    };
    Organization: {
      /** @description The Growthbook unique identifier for the organization */
      id?: string;
      /** @description An optional identifier that you use within your company for the organization */
      externalId?: string;
      /**
       * Format: date-time 
       * @description The date the organization was created
       */
      dateCreated?: string;
      /** @description The name of the organization */
      name?: string;
      /** @description The email address of the organization owner */
      ownerEmail?: string;
    };
    FactTable: {
      id: string;
      name: string;
      description: string;
      owner: string;
      projects: (string)[];
      tags: (string)[];
      datasource: string;
      userIdTypes: (string)[];
      sql: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
    };
    FactTableFilter: {
      id: string;
      name: string;
      description: string;
      value: string;
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
    };
    FactMetric: {
      id: string;
      name: string;
      description: string;
      owner: string;
      projects: (string)[];
      tags: (string)[];
      datasource: string;
      /** @enum {string} */
      metricType: "proportion" | "mean" | "ratio";
      numerator: {
        factTableId: string;
        column: string;
        /** @description Array of Fact Table Filter Ids */
        filters: (string)[];
      };
      denominator?: {
        factTableId: string;
        column: string;
        /** @description Array of Fact Table Filter Ids */
        filters: (string)[];
      };
      /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
      inverse: boolean;
      /** @description Controls how outliers are handled */
      cappingSettings: {
        /** @enum {string} */
        type: "none" | "absolute" | "percentile";
        /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
        value?: number;
      };
      /** @description Controls the conversion window for the metric */
      windowSettings: {
        /** @enum {string} */
        type: "none" | "conversion";
        /** @description Wait this many hours after experiment exposure before counting conversions */
        delayHours: number;
        windowValue?: number;
        /** @enum {string} */
        windowUnit?: "hours" | "days" | "weeks";
      };
      /** @description Controls the regression adjustment (CUPED) settings for the metric */
      regressionAdjustmentSettings: {
        /** @description If false, the organization default settings will be used */
        override: boolean;
        /** @description Controls whether or not regresion adjustment is applied to the metric */
        enabled?: boolean;
        /** @description Number of pre-exposure days to use for the regression adjustment */
        days?: number;
      };
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
    };
  };
  responses: {
    Error: never;
  };
  parameters: {
    /** @description The id of the requested resource */
    id: string;
    /** @description The number of items to return */
    limit: number;
    /** @description How many items to skip (use in conjunction with limit for pagination) */
    offset: number;
    /** @description Filter by project id */
    projectId: string;
    /** @description Filter by Data Source */
    datasourceId: string;
    /** @description Specify a specific visual change */
    visualChangeId: string;
    /** @description Specify a specific fact table */
    factTableId: string;
  };
  requestBodies: never;
  headers: never;
  pathItems: never;
}

export type external = Record<string, never>;

export interface operations {

  listFeatures: {
    /** Get all features */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by project id */
      query: {
        limit?: number;
        offset?: number;
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
            features: ({
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
                  [key: string]: ({
                    enabled: boolean;
                    defaultValue: string;
                    rules: (({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      }) | ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      }) | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        trackingKey?: string;
                        hashAttribute?: string;
                        fallbackAttribute?: string;
                        disableStickyBucketing?: any;
                        bucketVersion?: number;
                        minBucketVersion?: number;
                        excludeBlockedBucketUsers?: boolean;
                        namespace?: {
                          enabled: boolean;
                          name: string;
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        condition?: string;
                        variations: ({
                            value: string;
                            variationId: string;
                          })[];
                        experimentId: string;
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                    draft?: {
                      enabled: boolean;
                      defaultValue: string;
                      rules: (({
                          description: string;
                          condition: string;
                          savedGroupTargeting?: ({
                              /** @enum {string} */
                              matchType: "all" | "any" | "none";
                              savedGroups: (string)[];
                            })[];
                          id: string;
                          enabled: boolean;
                          type: string;
                          value: string;
                        }) | ({
                          description: string;
                          condition: string;
                          savedGroupTargeting?: ({
                              /** @enum {string} */
                              matchType: "all" | "any" | "none";
                              savedGroups: (string)[];
                            })[];
                          id: string;
                          enabled: boolean;
                          type: string;
                          value: string;
                          coverage: number;
                          hashAttribute: string;
                        }) | {
                          description: string;
                          condition: string;
                          id: string;
                          enabled: boolean;
                          type: string;
                          trackingKey?: string;
                          hashAttribute?: string;
                          fallbackAttribute?: string;
                          disableStickyBucketing?: any;
                          bucketVersion?: number;
                          minBucketVersion?: number;
                          excludeBlockedBucketUsers?: boolean;
                          namespace?: {
                            enabled: boolean;
                            name: string;
                            range: (number)[];
                          };
                          coverage?: number;
                          value?: ({
                              value: string;
                              weight: number;
                              name?: string;
                            })[];
                        } | {
                          description: string;
                          id: string;
                          enabled: boolean;
                          type: string;
                          condition?: string;
                          variations: ({
                              value: string;
                              variationId: string;
                            })[];
                          experimentId: string;
                        })[];
                      /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                      definition?: string;
                    };
                  }) | undefined;
                };
                revision: {
                  version: number;
                  comment: string;
                  /** Format: date-time */
                  date: string;
                  publishedBy: string;
                };
              })[];
          }) & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postFeature: {
    /** Create a single feature */
    requestBody: {
      content: {
        "application/json": {
          /** @description A unique key name for the feature. Feature keys can only include letters, numbers, hyphens, and underscores. */
          id: string;
          archived?: boolean;
          /** @description Description of the feature */
          description?: string;
          /** @description Email of the person who owns this experiment */
          owner: string;
          /** @description An associated project ID */
          project?: string;
          /**
           * @description The data type of the feature payload. Boolean by default. 
           * @enum {string}
           */
          valueType: "boolean" | "string" | "number" | "json";
          /** @description Default value when feature is enabled. Type must match `valueType`. */
          defaultValue: string;
          /** @description List of associated tags */
          tags?: (string)[];
          /** @description A dictionary of environments that are enabled for this feature. Keys supply the names of environments. Environments belong to organization and are not specified will be disabled by default. */
          environments?: {
            [key: string]: ({
              enabled: boolean;
              rules: (({
                  description?: string;
                  /** @description Applied to everyone by default. */
                  condition?: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "force";
                  value: string;
                }) | ({
                  description?: string;
                  /** @description Applied to everyone by default. */
                  condition?: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "rollout";
                  value: string;
                  /** @description Percent of traffic included in this experiment. Users not included in the experiment will skip this rule. */
                  coverage: number;
                  hashAttribute: string;
                }) | {
                  description?: string;
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "experiment-ref";
                  condition?: string;
                  variations: ({
                      value: string;
                      variationId: string;
                    })[];
                  experimentId: string;
                })[];
              /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
              definition?: string;
              /** @description Use to write draft changes without publishing them. */
              draft?: {
                enabled?: boolean;
                rules: (({
                    description?: string;
                    /** @description Applied to everyone by default. */
                    condition?: string;
                    savedGroupTargeting?: ({
                        /** @enum {string} */
                        matchType: "all" | "any" | "none";
                        savedGroups: (string)[];
                      })[];
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "force";
                    value: string;
                  }) | ({
                    description?: string;
                    /** @description Applied to everyone by default. */
                    condition?: string;
                    savedGroupTargeting?: ({
                        /** @enum {string} */
                        matchType: "all" | "any" | "none";
                        savedGroups: (string)[];
                      })[];
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "rollout";
                    value: string;
                    /** @description Percent of traffic included in this experiment. Users not included in the experiment will skip this rule. */
                    coverage: number;
                    hashAttribute: string;
                  }) | {
                    description?: string;
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "experiment-ref";
                    condition?: string;
                    variations: ({
                        value: string;
                        variationId: string;
                      })[];
                    experimentId: string;
                  })[];
                /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                definition?: string;
              };
            }) | undefined;
          };
          /** @description Use JSON schema to validate the payload of a JSON-type feature value (enterprise only). */
          jsonSchema?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            feature: {
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
                [key: string]: ({
                  enabled: boolean;
                  defaultValue: string;
                  rules: (({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    }) | ({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    }) | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      trackingKey?: string;
                      hashAttribute?: string;
                      fallbackAttribute?: string;
                      disableStickyBucketing?: any;
                      bucketVersion?: number;
                      minBucketVersion?: number;
                      excludeBlockedBucketUsers?: boolean;
                      namespace?: {
                        enabled: boolean;
                        name: string;
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    } | {
                      description: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      condition?: string;
                      variations: ({
                          value: string;
                          variationId: string;
                        })[];
                      experimentId: string;
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: (({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      }) | ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      }) | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        trackingKey?: string;
                        hashAttribute?: string;
                        fallbackAttribute?: string;
                        disableStickyBucketing?: any;
                        bucketVersion?: number;
                        minBucketVersion?: number;
                        excludeBlockedBucketUsers?: boolean;
                        namespace?: {
                          enabled: boolean;
                          name: string;
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        condition?: string;
                        variations: ({
                            value: string;
                            variationId: string;
                          })[];
                        experimentId: string;
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                  };
                }) | undefined;
              };
              revision: {
                version: number;
                comment: string;
                /** Format: date-time */
                date: string;
                publishedBy: string;
              };
            };
          };
        };
      };
    };
  };
  getFeature: {
    /** Get a single feature */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            feature: {
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
                [key: string]: ({
                  enabled: boolean;
                  defaultValue: string;
                  rules: (({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    }) | ({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    }) | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      trackingKey?: string;
                      hashAttribute?: string;
                      fallbackAttribute?: string;
                      disableStickyBucketing?: any;
                      bucketVersion?: number;
                      minBucketVersion?: number;
                      excludeBlockedBucketUsers?: boolean;
                      namespace?: {
                        enabled: boolean;
                        name: string;
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    } | {
                      description: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      condition?: string;
                      variations: ({
                          value: string;
                          variationId: string;
                        })[];
                      experimentId: string;
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: (({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      }) | ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      }) | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        trackingKey?: string;
                        hashAttribute?: string;
                        fallbackAttribute?: string;
                        disableStickyBucketing?: any;
                        bucketVersion?: number;
                        minBucketVersion?: number;
                        excludeBlockedBucketUsers?: boolean;
                        namespace?: {
                          enabled: boolean;
                          name: string;
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        condition?: string;
                        variations: ({
                            value: string;
                            variationId: string;
                          })[];
                        experimentId: string;
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                  };
                }) | undefined;
              };
              revision: {
                version: number;
                comment: string;
                /** Format: date-time */
                date: string;
                publishedBy: string;
              };
            };
          };
        };
      };
    };
  };
  updateFeature: {
    /** Partially update a feature */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description Description of the feature */
          description?: string;
          archived?: boolean;
          /** @description An associated project ID */
          project?: string;
          owner?: string;
          defaultValue?: string;
          /** @description List of associated tags. Will override tags completely with submitted list */
          tags?: (string)[];
          environments?: {
            [key: string]: ({
              enabled: boolean;
              rules: (({
                  description?: string;
                  /** @description Applied to everyone by default. */
                  condition?: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "force";
                  value: string;
                }) | ({
                  description?: string;
                  /** @description Applied to everyone by default. */
                  condition?: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "rollout";
                  value: string;
                  /** @description Percent of traffic included in this experiment. Users not included in the experiment will skip this rule. */
                  coverage: number;
                  hashAttribute: string;
                }) | {
                  description?: string;
                  id?: string;
                  /** @description Enabled by default */
                  enabled?: boolean;
                  /** @enum {string} */
                  type: "experiment-ref";
                  condition?: string;
                  variations: ({
                      value: string;
                      variationId: string;
                    })[];
                  experimentId: string;
                })[];
              /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
              definition?: string;
              /** @description Use to write draft changes without publishing them. */
              draft?: {
                enabled?: boolean;
                rules: (({
                    description?: string;
                    /** @description Applied to everyone by default. */
                    condition?: string;
                    savedGroupTargeting?: ({
                        /** @enum {string} */
                        matchType: "all" | "any" | "none";
                        savedGroups: (string)[];
                      })[];
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "force";
                    value: string;
                  }) | ({
                    description?: string;
                    /** @description Applied to everyone by default. */
                    condition?: string;
                    savedGroupTargeting?: ({
                        /** @enum {string} */
                        matchType: "all" | "any" | "none";
                        savedGroups: (string)[];
                      })[];
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "rollout";
                    value: string;
                    /** @description Percent of traffic included in this experiment. Users not included in the experiment will skip this rule. */
                    coverage: number;
                    hashAttribute: string;
                  }) | {
                    description?: string;
                    id?: string;
                    /** @description Enabled by default */
                    enabled?: boolean;
                    /** @enum {string} */
                    type: "experiment-ref";
                    condition?: string;
                    variations: ({
                        value: string;
                        variationId: string;
                      })[];
                    experimentId: string;
                  })[];
                /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                definition?: string;
              };
            }) | undefined;
          };
          /** @description Use JSON schema to validate the payload of a JSON-type feature value (enterprise only). */
          jsonSchema?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            feature: {
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
                [key: string]: ({
                  enabled: boolean;
                  defaultValue: string;
                  rules: (({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    }) | ({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    }) | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      trackingKey?: string;
                      hashAttribute?: string;
                      fallbackAttribute?: string;
                      disableStickyBucketing?: any;
                      bucketVersion?: number;
                      minBucketVersion?: number;
                      excludeBlockedBucketUsers?: boolean;
                      namespace?: {
                        enabled: boolean;
                        name: string;
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    } | {
                      description: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      condition?: string;
                      variations: ({
                          value: string;
                          variationId: string;
                        })[];
                      experimentId: string;
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: (({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      }) | ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      }) | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        trackingKey?: string;
                        hashAttribute?: string;
                        fallbackAttribute?: string;
                        disableStickyBucketing?: any;
                        bucketVersion?: number;
                        minBucketVersion?: number;
                        excludeBlockedBucketUsers?: boolean;
                        namespace?: {
                          enabled: boolean;
                          name: string;
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        condition?: string;
                        variations: ({
                            value: string;
                            variationId: string;
                          })[];
                        experimentId: string;
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                  };
                }) | undefined;
              };
              revision: {
                version: number;
                comment: string;
                /** Format: date-time */
                date: string;
                publishedBy: string;
              };
            };
          };
        };
      };
    };
  };
  toggleFeature: {
    /** Toggle a feature in one or more environments */
    requestBody: {
      content: {
        "application/json": {
          reason?: string;
          environments: {
            [key: string]: (true | "" | "true" | "false" | "1" | "0" | 1 | "" | "") | undefined;
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            feature: {
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
                [key: string]: ({
                  enabled: boolean;
                  defaultValue: string;
                  rules: (({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    }) | ({
                      description: string;
                      condition: string;
                      savedGroupTargeting?: ({
                          /** @enum {string} */
                          matchType: "all" | "any" | "none";
                          savedGroups: (string)[];
                        })[];
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    }) | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      trackingKey?: string;
                      hashAttribute?: string;
                      fallbackAttribute?: string;
                      disableStickyBucketing?: any;
                      bucketVersion?: number;
                      minBucketVersion?: number;
                      excludeBlockedBucketUsers?: boolean;
                      namespace?: {
                        enabled: boolean;
                        name: string;
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    } | {
                      description: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      condition?: string;
                      variations: ({
                          value: string;
                          variationId: string;
                        })[];
                      experimentId: string;
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: (({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      }) | ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: ({
                            /** @enum {string} */
                            matchType: "all" | "any" | "none";
                            savedGroups: (string)[];
                          })[];
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      }) | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        trackingKey?: string;
                        hashAttribute?: string;
                        fallbackAttribute?: string;
                        disableStickyBucketing?: any;
                        bucketVersion?: number;
                        minBucketVersion?: number;
                        excludeBlockedBucketUsers?: boolean;
                        namespace?: {
                          enabled: boolean;
                          name: string;
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        condition?: string;
                        variations: ({
                            value: string;
                            variationId: string;
                          })[];
                        experimentId: string;
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                  };
                }) | undefined;
              };
              revision: {
                version: number;
                comment: string;
                /** Format: date-time */
                date: string;
                publishedBy: string;
              };
            };
          };
        };
      };
    };
  };
  getFeatureKeys: {
    /** Get list of feature keys */
    parameters: {
        /** @description Filter by project id */
      query: {
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": (string)[];
        };
      };
    };
  };
  listProjects: {
    /** Get all projects */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
      query: {
        limit?: number;
        offset?: number;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            projects: ({
                id: string;
                name: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                description?: string;
                settings?: {
                  statsEngine?: string;
                };
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
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
            project: {
              id: string;
              name: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              description?: string;
              settings?: {
                statsEngine?: string;
              };
            };
          };
        };
      };
    };
  };
  listDimensions: {
    /** Get all dimensions */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by Data Source */
      query: {
        limit?: number;
        offset?: number;
        datasourceId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dimensions: ({
                id: string;
                dateCreated: string;
                dateUpdated: string;
                owner: string;
                datasourceId: string;
                identifierType: string;
                name: string;
                query: string;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
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
            dimension: {
              id: string;
              dateCreated: string;
              dateUpdated: string;
              owner: string;
              datasourceId: string;
              identifierType: string;
              name: string;
              query: string;
            };
          };
        };
      };
    };
  };
  listSegments: {
    /** Get all segments */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by Data Source */
      query: {
        limit?: number;
        offset?: number;
        datasourceId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            segments: ({
                id: string;
                owner: string;
                datasourceId: string;
                identifierType: string;
                name: string;
                query: string;
                dateCreated: string;
                dateUpdated: string;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
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
            segment: {
              id: string;
              owner: string;
              datasourceId: string;
              identifierType: string;
              name: string;
              query: string;
              dateCreated: string;
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  listSdkConnections: {
    /** Get all sdk connections */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by project id */
      query: {
        limit?: number;
        offset?: number;
        projectId?: string;
        withProxy?: string;
        multiOrg?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            connections?: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                organization: string;
                languages: (string)[];
                sdkVersion?: string;
                environment: string;
                /** @description Use 'projects' instead. This is only for backwards compatibility and contains the first project only. */
                project: string;
                projects?: (string)[];
                encryptPayload: boolean;
                encryptionKey: string;
                includeVisualExperiments?: boolean;
                includeDraftExperiments?: boolean;
                includeExperimentNames?: boolean;
                key: string;
                proxyEnabled: boolean;
                proxyHost: string;
                proxySigningKey: string;
                sseEnabled?: boolean;
                hashSecureAttributes?: boolean;
                remoteEvalEnabled?: boolean;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
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
            sdkConnection: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              organization: string;
              languages: (string)[];
              sdkVersion?: string;
              environment: string;
              /** @description Use 'projects' instead. This is only for backwards compatibility and contains the first project only. */
              project: string;
              projects?: (string)[];
              encryptPayload: boolean;
              encryptionKey: string;
              includeVisualExperiments?: boolean;
              includeDraftExperiments?: boolean;
              includeExperimentNames?: boolean;
              key: string;
              proxyEnabled: boolean;
              proxyHost: string;
              proxySigningKey: string;
              sseEnabled?: boolean;
              hashSecureAttributes?: boolean;
              remoteEvalEnabled?: boolean;
            };
          };
        };
      };
    };
  };
  listDataSources: {
    /** Get all data sources */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by project id */
      query: {
        limit?: number;
        offset?: number;
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            dataSources: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                type: string;
                name: string;
                description: string;
                projectIds: (string)[];
                eventTracker: string;
                identifierTypes: ({
                    id: string;
                    description: string;
                  })[];
                assignmentQueries: ({
                    id: string;
                    name: string;
                    description: string;
                    identifierType: string;
                    sql: string;
                    includesNameColumns: boolean;
                    dimensionColumns: (string)[];
                  })[];
                identifierJoinQueries: ({
                    identifierTypes: (string)[];
                    sql: string;
                  })[];
                mixpanelSettings?: {
                  viewedExperimentEventName: string;
                  experimentIdProperty: string;
                  variationIdProperty: string;
                  extraUserIdProperty: string;
                };
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  getDataSource: {
    /** Get a single data source */
    responses: {
      200: {
        content: {
          "application/json": {
            dataSource: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              type: string;
              name: string;
              description: string;
              projectIds: (string)[];
              eventTracker: string;
              identifierTypes: ({
                  id: string;
                  description: string;
                })[];
              assignmentQueries: ({
                  id: string;
                  name: string;
                  description: string;
                  identifierType: string;
                  sql: string;
                  includesNameColumns: boolean;
                  dimensionColumns: (string)[];
                })[];
              identifierJoinQueries: ({
                  identifierTypes: (string)[];
                  sql: string;
                })[];
              mixpanelSettings?: {
                viewedExperimentEventName: string;
                experimentIdProperty: string;
                variationIdProperty: string;
                extraUserIdProperty: string;
              };
            };
          };
        };
      };
    };
  };
  listExperiments: {
    /** Get all experiments */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by project id */
        /** @description Filter by Data Source */
        /** @description Filter the returned list by the experiment tracking key (id) */
      query: {
        limit?: number;
        offset?: number;
        projectId?: string;
        datasourceId?: string;
        experimentId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
            experiments: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                project: string;
                hypothesis: string;
                description: string;
                tags: (string)[];
                owner: string;
                archived: boolean;
                status: string;
                autoRefresh: boolean;
                hashAttribute: string;
                fallbackAttribute?: string;
                /** @enum {number} */
                hashVersion: 1 | 2;
                disableStickyBucketing?: any;
                bucketVersion?: number;
                minBucketVersion?: number;
                excludeBlockedBucketUsers?: boolean;
                variations: ({
                    variationId: string;
                    key: string;
                    name: string;
                    description: string;
                    screenshots: (string)[];
                  })[];
                phases: ({
                    name: string;
                    dateStarted: string;
                    dateEnded: string;
                    reasonForStopping: string;
                    seed: string;
                    coverage: number;
                    trafficSplit: ({
                        variationId: string;
                        weight: number;
                      })[];
                    namespace?: {
                      namespaceId: string;
                      range: (unknown)[];
                    };
                    targetingCondition: string;
                    savedGroupTargeting?: ({
                        /** @enum {string} */
                        matchType: "all" | "any" | "none";
                        savedGroups: (string)[];
                      })[];
                  })[];
                settings: {
                  datasourceId: string;
                  assignmentQueryId: string;
                  experimentId: string;
                  segmentId: string;
                  queryFilter: string;
                  /** @enum {unknown} */
                  inProgressConversions: "include" | "exclude";
                  /** @enum {unknown} */
                  attributionModel: "firstExposure" | "experimentDuration";
                  /** @enum {unknown} */
                  statsEngine: "bayesian" | "frequentist";
                  goals: ({
                      metricId: string;
                      overrides: {
                        conversionWindowStart?: number;
                        conversionWindowEnd?: number;
                        winRiskThreshold?: number;
                        loseRiskThreshold?: number;
                      };
                    })[];
                  guardrails: ({
                      metricId: string;
                      overrides: {
                        conversionWindowStart?: number;
                        conversionWindowEnd?: number;
                        winRiskThreshold?: number;
                        loseRiskThreshold?: number;
                      };
                    })[];
                  activationMetric?: {
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  };
                };
                resultSummary?: {
                  status: string;
                  winner: string;
                  conclusions: string;
                  releasedVariationId: string;
                  excludeFromPayload: boolean;
                };
              })[];
          }) & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postExperiment: {
    /** Create a single experiment */
    requestBody: {
      content: {
        "application/json": {
          /** @description ID for the [DataSource](#tag/DataSource_model) */
          datasourceId: string;
          /** @description The ID property of one of the assignment query objects associated with the datasource */
          assignmentQueryId: string;
          trackingKey: string;
          /** @description Name of the experiment */
          name: string;
          /** @description Project ID which the experiment belongs to */
          project?: string;
          /** @description Hypothesis of the experiment */
          hypothesis?: string;
          /** @description Description of the experiment */
          description?: string;
          tags?: (string)[];
          metrics?: (string)[];
          guardrailMetrics?: (string)[];
          /** @description Email of the person who owns this experiment */
          owner: string;
          archived?: boolean;
          /** @enum {string} */
          status?: "draft" | "running" | "stopped";
          autoRefresh?: boolean;
          hashAttribute?: string;
          fallbackAttribute?: string;
          /** @enum {number} */
          hashVersion?: 1 | 2;
          disableStickyBucketing?: any;
          bucketVersion?: number;
          minBucketVersion?: number;
          excludeBlockedBucketUsers?: boolean;
          releasedVariationId?: string;
          excludeFromPayload?: boolean;
          variations: ({
              id?: string;
              key: string;
              name: string;
              description?: string;
              screenshots?: ({
                  path: string;
                  width?: number;
                  height?: number;
                  description?: string;
                })[];
            })[];
          phases?: ({
              name: string;
              /** Format: date */
              dateStarted: string;
              /** Format: date */
              dateEnded?: string;
              reasonForStopping?: string;
              seed?: string;
              coverage?: number;
              trafficSplit?: ({
                  variationId: string;
                  weight: number;
                })[];
              namespace?: {
                namespaceId: string;
                range: (number)[];
                enabled?: boolean;
              };
              targetingCondition?: string;
              reason?: string;
              condition?: string;
              savedGroupTargeting?: ({
                  /** @enum {string} */
                  matchType: "all" | "any" | "none";
                  savedGroups: (string)[];
                })[];
              variationWeights?: (number)[];
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experiment: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              project: string;
              hypothesis: string;
              description: string;
              tags: (string)[];
              owner: string;
              archived: boolean;
              status: string;
              autoRefresh: boolean;
              hashAttribute: string;
              fallbackAttribute?: string;
              /** @enum {number} */
              hashVersion: 1 | 2;
              disableStickyBucketing?: any;
              bucketVersion?: number;
              minBucketVersion?: number;
              excludeBlockedBucketUsers?: boolean;
              variations: ({
                  variationId: string;
                  key: string;
                  name: string;
                  description: string;
                  screenshots: (string)[];
                })[];
              phases: ({
                  name: string;
                  dateStarted: string;
                  dateEnded: string;
                  reasonForStopping: string;
                  seed: string;
                  coverage: number;
                  trafficSplit: ({
                      variationId: string;
                      weight: number;
                    })[];
                  namespace?: {
                    namespaceId: string;
                    range: (unknown)[];
                  };
                  targetingCondition: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                })[];
              settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                /** @enum {unknown} */
                inProgressConversions: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "experimentDuration";
                /** @enum {unknown} */
                statsEngine: "bayesian" | "frequentist";
                goals: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                guardrails: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                activationMetric?: {
                  metricId: string;
                  overrides: {
                    conversionWindowStart?: number;
                    conversionWindowEnd?: number;
                    winRiskThreshold?: number;
                    loseRiskThreshold?: number;
                  };
                };
              };
              resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
              };
            };
          };
        };
      };
    };
  };
  getExperiment: {
    /** Get a single experiment */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experiment: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              project: string;
              hypothesis: string;
              description: string;
              tags: (string)[];
              owner: string;
              archived: boolean;
              status: string;
              autoRefresh: boolean;
              hashAttribute: string;
              fallbackAttribute?: string;
              /** @enum {number} */
              hashVersion: 1 | 2;
              disableStickyBucketing?: any;
              bucketVersion?: number;
              minBucketVersion?: number;
              excludeBlockedBucketUsers?: boolean;
              variations: ({
                  variationId: string;
                  key: string;
                  name: string;
                  description: string;
                  screenshots: (string)[];
                })[];
              phases: ({
                  name: string;
                  dateStarted: string;
                  dateEnded: string;
                  reasonForStopping: string;
                  seed: string;
                  coverage: number;
                  trafficSplit: ({
                      variationId: string;
                      weight: number;
                    })[];
                  namespace?: {
                    namespaceId: string;
                    range: (unknown)[];
                  };
                  targetingCondition: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                })[];
              settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                /** @enum {unknown} */
                inProgressConversions: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "experimentDuration";
                /** @enum {unknown} */
                statsEngine: "bayesian" | "frequentist";
                goals: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                guardrails: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                activationMetric?: {
                  metricId: string;
                  overrides: {
                    conversionWindowStart?: number;
                    conversionWindowEnd?: number;
                    winRiskThreshold?: number;
                    loseRiskThreshold?: number;
                  };
                };
              };
              resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
              };
            };
          };
        };
      };
    };
  };
  updateExperiment: {
    /** Update a single experiment */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          assignmentQueryId?: string;
          trackingKey?: string;
          /** @description Name of the experiment */
          name?: string;
          /** @description Project ID which the experiment belongs to */
          project?: string;
          /** @description Hypothesis of the experiment */
          hypothesis?: string;
          /** @description Description of the experiment */
          description?: string;
          tags?: (string)[];
          metrics?: (string)[];
          guardrailMetrics?: (string)[];
          /** @description Email of the person who owns this experiment */
          owner?: string;
          archived?: boolean;
          /** @enum {string} */
          status?: "draft" | "running" | "stopped";
          autoRefresh?: boolean;
          hashAttribute?: string;
          fallbackAttribute?: string;
          /** @enum {number} */
          hashVersion?: 1 | 2;
          disableStickyBucketing?: any;
          bucketVersion?: number;
          minBucketVersion?: number;
          excludeBlockedBucketUsers?: boolean;
          releasedVariationId?: string;
          excludeFromPayload?: boolean;
          variations?: ({
              id?: string;
              key: string;
              name: string;
              description?: string;
              screenshots?: ({
                  path: string;
                  width?: number;
                  height?: number;
                  description?: string;
                })[];
            })[];
          phases?: ({
              name: string;
              /** Format: date */
              dateStarted: string;
              /** Format: date */
              dateEnded?: string;
              reasonForStopping?: string;
              seed?: string;
              coverage?: number;
              trafficSplit?: ({
                  variationId: string;
                  weight: number;
                })[];
              namespace?: {
                namespaceId: string;
                range: (number)[];
                enabled?: boolean;
              };
              targetingCondition?: string;
              reason?: string;
              condition?: string;
              savedGroupTargeting?: ({
                  /** @enum {string} */
                  matchType: "all" | "any" | "none";
                  savedGroups: (string)[];
                })[];
              variationWeights?: (number)[];
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            experiment: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              project: string;
              hypothesis: string;
              description: string;
              tags: (string)[];
              owner: string;
              archived: boolean;
              status: string;
              autoRefresh: boolean;
              hashAttribute: string;
              fallbackAttribute?: string;
              /** @enum {number} */
              hashVersion: 1 | 2;
              disableStickyBucketing?: any;
              bucketVersion?: number;
              minBucketVersion?: number;
              excludeBlockedBucketUsers?: boolean;
              variations: ({
                  variationId: string;
                  key: string;
                  name: string;
                  description: string;
                  screenshots: (string)[];
                })[];
              phases: ({
                  name: string;
                  dateStarted: string;
                  dateEnded: string;
                  reasonForStopping: string;
                  seed: string;
                  coverage: number;
                  trafficSplit: ({
                      variationId: string;
                      weight: number;
                    })[];
                  namespace?: {
                    namespaceId: string;
                    range: (unknown)[];
                  };
                  targetingCondition: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                })[];
              settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                /** @enum {unknown} */
                inProgressConversions: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "experimentDuration";
                /** @enum {unknown} */
                statsEngine: "bayesian" | "frequentist";
                goals: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                guardrails: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                activationMetric?: {
                  metricId: string;
                  overrides: {
                    conversionWindowStart?: number;
                    conversionWindowEnd?: number;
                    winRiskThreshold?: number;
                    loseRiskThreshold?: number;
                  };
                };
              };
              resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
              };
            };
          };
        };
      };
    };
  };
  getExperimentResults: {
    /** Get results for an experiment */
    parameters: {
      query: {
        phase?: string;
        dimension?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            result?: {
              id: string;
              dateUpdated: string;
              experimentId: string;
              phase: string;
              dateStart: string;
              dateEnd: string;
              dimension: {
                type: string;
                id?: string;
              };
              settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                /** @enum {unknown} */
                inProgressConversions: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "experimentDuration";
                /** @enum {unknown} */
                statsEngine: "bayesian" | "frequentist";
                goals: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                guardrails: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                activationMetric?: {
                  metricId: string;
                  overrides: {
                    conversionWindowStart?: number;
                    conversionWindowEnd?: number;
                    winRiskThreshold?: number;
                    loseRiskThreshold?: number;
                  };
                };
              };
              queryIds: (string)[];
              results: ({
                  dimension: string;
                  totalUsers: number;
                  checks: {
                    srm: number;
                  };
                  metrics: ({
                      metricId: string;
                      variations: ({
                          variationId: string;
                          analyses: ({
                              /** @enum {unknown} */
                              engine: "bayesian" | "frequentist";
                              numerator: number;
                              denominator: number;
                              mean: number;
                              stddev: number;
                              percentChange: number;
                              ciLow: number;
                              ciHigh: number;
                              pValue?: number;
                              risk?: number;
                              chanceToBeatControl?: number;
                            })[];
                        })[];
                    })[];
                })[];
            };
          };
        };
      };
    };
  };
  listMetrics: {
    /** Get all metrics */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by project id */
        /** @description Filter by Data Source */
      query: {
        limit?: number;
        offset?: number;
        projectId?: string;
        datasourceId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
            metrics: ({
                id: string;
                dateCreated: string;
                dateUpdated: string;
                owner: string;
                datasourceId: string;
                name: string;
                description: string;
                /** @enum {string} */
                type: "binomial" | "count" | "duration" | "revenue";
                tags: (string)[];
                projects: (string)[];
                archived: boolean;
                behavior: {
                  /** @enum {string} */
                  goal: "increase" | "decrease";
                  cap?: number;
                  /** @enum {string|null} */
                  capping?: "absolute" | "percentile" | null;
                  capValue?: number;
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
                };
                sqlBuilder?: {
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
              })[];
          }) & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postMetric: {
    /** Create a single metric */
    requestBody: {
      content: {
        "application/json": {
          /** @description ID for the [DataSource](#tag/DataSource_model) */
          datasourceId: string;
          /** @description Name of the person who owns this metric */
          owner?: string;
          /** @description Name of the metric */
          name: string;
          /** @description Description of the metric */
          description?: string;
          /**
           * @description Type of metric. See [Metrics documentation](/app/metrics) 
           * @enum {string}
           */
          type: "binomial" | "count" | "duration" | "revenue";
          /** @description List of tags */
          tags?: (string)[];
          /** @description List of project IDs for projects that can access this metric */
          projects?: (string)[];
          archived?: boolean;
          behavior?: {
            /** @enum {string} */
            goal?: "increase" | "decrease";
            /**
             * @deprecated 
             * @description (deprecated, use capping and capValue fields instead) This should be non-negative
             */
            cap?: number;
            /**
             * @description Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. "absolute" will cap user values at the `capValue` if it is greater than 0. "percentile" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`. 
             * @enum {string|null}
             */
            capping?: "absolute" | "percentile" | null;
            /** @description This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`. */
            capValue?: number;
            /** @description The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither. */
            conversionWindowStart?: number;
            /** @description The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither. */
            conversionWindowEnd?: number;
            /** @description Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`. */
            riskThresholdSuccess?: number;
            /** @description Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number. */
            riskThresholdDanger?: number;
            /** @description Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%) */
            minPercentChange?: number;
            /** @description Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%) */
            maxPercentChange?: number;
            minSampleSize?: number;
          };
          /** @description Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified. */
          sql?: {
            identifierTypes: (string)[];
            conversionSQL: string;
            /** @description Custom user level aggregation for your metric (default: `SUM(value)`) */
            userAggregationSQL?: string;
            /** @description The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics) */
            denominatorMetricId?: string;
          };
          /** @description An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified. */
          sqlBuilder?: {
            identifierTypeColumns: ({
                identifierType: string;
                columnName: string;
              })[];
            tableName: string;
            valueColumnName?: string;
            timestampColumnName: string;
            conditions?: ({
                column: string;
                operator: string;
                value: string;
              })[];
          };
          /** @description Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified. */
          mixpanel?: {
            eventName: string;
            eventValue?: string;
            userAggregation: string;
            conditions?: ({
                property: string;
                operator: string;
                value: string;
              })[];
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            metric: {
              id: string;
              dateCreated: string;
              dateUpdated: string;
              owner: string;
              datasourceId: string;
              name: string;
              description: string;
              /** @enum {string} */
              type: "binomial" | "count" | "duration" | "revenue";
              tags: (string)[];
              projects: (string)[];
              archived: boolean;
              behavior: {
                /** @enum {string} */
                goal: "increase" | "decrease";
                cap?: number;
                /** @enum {string|null} */
                capping?: "absolute" | "percentile" | null;
                capValue?: number;
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
              };
              sqlBuilder?: {
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
          };
        };
      };
    };
  };
  getMetric: {
    /** Get a single metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            metric: {
              id: string;
              dateCreated: string;
              dateUpdated: string;
              owner: string;
              datasourceId: string;
              name: string;
              description: string;
              /** @enum {string} */
              type: "binomial" | "count" | "duration" | "revenue";
              tags: (string)[];
              projects: (string)[];
              archived: boolean;
              behavior: {
                /** @enum {string} */
                goal: "increase" | "decrease";
                cap?: number;
                /** @enum {string|null} */
                capping?: "absolute" | "percentile" | null;
                capValue?: number;
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
              };
              sqlBuilder?: {
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
          };
        };
      };
    };
  };
  putMetric: {
    /** Update a metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description Name of the person who owns this metric */
          owner?: string;
          /** @description Name of the metric */
          name?: string;
          /** @description Description of the metric */
          description?: string;
          /**
           * @description Type of metric. See [Metrics documentation](/app/metrics) 
           * @enum {string}
           */
          type?: "binomial" | "count" | "duration" | "revenue";
          /** @description List of tags */
          tags?: (string)[];
          /** @description List of project IDs for projects that can access this metric */
          projects?: (string)[];
          archived?: boolean;
          behavior?: {
            /** @enum {string} */
            goal?: "increase" | "decrease";
            /**
             * @description Used in conjunction with `capValue` to set the capping (winsorization). Set to null to turn capping off. "absolute" will cap user values at the `capValue` if it is greater than 0. "percentile" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/> If `behavior.capping` is non-null, you must specify `behavior.capValue`. 
             * @enum {string|null}
             */
            capping?: "absolute" | "percentile" | null;
            /** @description This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`. */
            capValue?: number;
            /** @description The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither. */
            conversionWindowStart?: number;
            /** @description The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither. */
            conversionWindowEnd?: number;
            /** @description Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`. */
            riskThresholdSuccess?: number;
            /** @description Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number. */
            riskThresholdDanger?: number;
            /** @description Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%) */
            minPercentChange?: number;
            /** @description Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%) */
            maxPercentChange?: number;
            minSampleSize?: number;
          };
          /** @description Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed. */
          sql?: {
            identifierTypes?: (string)[];
            conversionSQL?: string;
            /** @description Custom user level aggregation for your metric (default: `SUM(value)`) */
            userAggregationSQL?: string;
            /** @description The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics) */
            denominatorMetricId?: string;
          };
          /** @description An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed */
          sqlBuilder?: {
            identifierTypeColumns?: ({
                identifierType: string;
                columnName: string;
              })[];
            tableName?: string;
            valueColumnName?: string;
            timestampColumnName?: string;
            conditions?: ({
                column: string;
                operator: string;
                value: string;
              })[];
          };
          /** @description Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed. */
          mixpanel?: {
            eventName?: string;
            eventValue?: string;
            userAggregation?: string;
            conditions?: ({
                property: string;
                operator: string;
                value: string;
              })[];
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            updatedId: string;
          };
        };
      };
    };
  };
  deleteMetric: {
    /** Deletes a metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listVisualChangesets: {
    /** Get all visual changesets */
    parameters: {
        /** @description The experiment id the visual changesets belong to */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            visualChangesets: ({
                id?: string;
                urlPatterns: ({
                    include?: boolean;
                    /** @enum {string} */
                    type: "simple" | "regex";
                    pattern: string;
                  })[];
                editorUrl: string;
                experiment: string;
                visualChanges: ({
                    description?: string;
                    css?: string;
                    js?: string;
                    variation: string;
                    domMutations: ({
                        selector: string;
                        /** @enum {string} */
                        action: "append" | "set" | "remove";
                        attribute: string;
                        value?: string;
                        parentSelector?: string;
                        insertBeforeSelector?: string;
                      })[];
                  })[];
              })[];
          };
        };
      };
    };
  };
  getVisualChangeset: {
    /** Get a single visual changeset */
    parameters: {
        /** @description Include the associated experiment in payload */
      query: {
        includeExperiment?: number;
      };
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            visualChangeset: {
              id?: string;
              urlPatterns: ({
                  include?: boolean;
                  /** @enum {string} */
                  type: "simple" | "regex";
                  pattern: string;
                })[];
              editorUrl: string;
              experiment: string;
              visualChanges: ({
                  description?: string;
                  css?: string;
                  js?: string;
                  variation: string;
                  domMutations: ({
                      selector: string;
                      /** @enum {string} */
                      action: "append" | "set" | "remove";
                      attribute: string;
                      value?: string;
                      parentSelector?: string;
                      insertBeforeSelector?: string;
                    })[];
                })[];
            };
            experiment?: {
              id: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              project: string;
              hypothesis: string;
              description: string;
              tags: (string)[];
              owner: string;
              archived: boolean;
              status: string;
              autoRefresh: boolean;
              hashAttribute: string;
              fallbackAttribute?: string;
              /** @enum {number} */
              hashVersion: 1 | 2;
              disableStickyBucketing?: any;
              bucketVersion?: number;
              minBucketVersion?: number;
              excludeBlockedBucketUsers?: boolean;
              variations: ({
                  variationId: string;
                  key: string;
                  name: string;
                  description: string;
                  screenshots: (string)[];
                })[];
              phases: ({
                  name: string;
                  dateStarted: string;
                  dateEnded: string;
                  reasonForStopping: string;
                  seed: string;
                  coverage: number;
                  trafficSplit: ({
                      variationId: string;
                      weight: number;
                    })[];
                  namespace?: {
                    namespaceId: string;
                    range: (unknown)[];
                  };
                  targetingCondition: string;
                  savedGroupTargeting?: ({
                      /** @enum {string} */
                      matchType: "all" | "any" | "none";
                      savedGroups: (string)[];
                    })[];
                })[];
              settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                /** @enum {unknown} */
                inProgressConversions: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "experimentDuration";
                /** @enum {unknown} */
                statsEngine: "bayesian" | "frequentist";
                goals: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                guardrails: ({
                    metricId: string;
                    overrides: {
                      conversionWindowStart?: number;
                      conversionWindowEnd?: number;
                      winRiskThreshold?: number;
                      loseRiskThreshold?: number;
                    };
                  })[];
                activationMetric?: {
                  metricId: string;
                  overrides: {
                    conversionWindowStart?: number;
                    conversionWindowEnd?: number;
                    winRiskThreshold?: number;
                    loseRiskThreshold?: number;
                  };
                };
              };
              resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
              };
            };
          };
        };
      };
    };
  };
  putVisualChangeset: {
    /** Update a visual changeset */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            nModified: number;
            visualChangeset: {
              id?: string;
              urlPatterns: ({
                  include?: boolean;
                  /** @enum {string} */
                  type: "simple" | "regex";
                  pattern: string;
                })[];
              editorUrl: string;
              experiment: string;
              visualChanges: ({
                  description?: string;
                  css?: string;
                  js?: string;
                  variation: string;
                  domMutations: ({
                      selector: string;
                      /** @enum {string} */
                      action: "append" | "set" | "remove";
                      attribute: string;
                      value?: string;
                      parentSelector?: string;
                      insertBeforeSelector?: string;
                    })[];
                })[];
            };
          };
        };
      };
    };
  };
  postVisualChange: {
    /** Create a visual change for a visual changeset */
    responses: {
      200: {
        content: {
          "application/json": {
            nModified: number;
          };
        };
      };
    };
  };
  putVisualChange: {
    /** Update a visual change for a visual changeset */
    responses: {
      200: {
        content: {
          "application/json": {
            nModified: number;
          };
        };
      };
    };
  };
  listSavedGroups: {
    /** Get all saved group */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
      query: {
        limit?: number;
        offset?: number;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
            savedGroups: ({
                id: string;
                /** @enum {string} */
                type: "condition" | "list";
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                owner?: string;
                /** @description When type = 'condition', this is the JSON-encoded condition for the group */
                condition?: string;
                /** @description When type = 'list', this is the attribute key the group is based on */
                attributeKey?: string;
                /** @description When type = 'list', this is the list of values for the attribute key */
                values?: (string)[];
              })[];
          }) & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postSavedGroup: {
    /** Create a single saved group */
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the Saved Group */
          name: string;
          /**
           * @description The type of Saved Group (inferred from other arguments if missing) 
           * @enum {string}
           */
          type?: "condition" | "list";
          /** @description When type = 'condition', this is the JSON-encoded condition for the group */
          condition?: string;
          /** @description When type = 'list', this is the attribute key the group is based on */
          attributeKey?: string;
          /** @description When type = 'list', this is the list of values for the attribute key */
          values?: (string)[];
          /** @description The person or team that owns this Saved Group. If no owner, you can pass an empty string. */
          owner?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            savedGroup: {
              id: string;
              /** @enum {string} */
              type: "condition" | "list";
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              /** @description When type = 'condition', this is the JSON-encoded condition for the group */
              condition?: string;
              /** @description When type = 'list', this is the attribute key the group is based on */
              attributeKey?: string;
              /** @description When type = 'list', this is the list of values for the attribute key */
              values?: (string)[];
            };
          };
        };
      };
    };
  };
  getSavedGroup: {
    /** Get a single saved group */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            savedGroup: {
              id: string;
              /** @enum {string} */
              type: "condition" | "list";
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              /** @description When type = 'condition', this is the JSON-encoded condition for the group */
              condition?: string;
              /** @description When type = 'list', this is the attribute key the group is based on */
              attributeKey?: string;
              /** @description When type = 'list', this is the list of values for the attribute key */
              values?: (string)[];
            };
          };
        };
      };
    };
  };
  updateSavedGroup: {
    /** Partially update a single saved group */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the Saved Group */
          name?: string;
          /** @description When type = 'condition', this is the JSON-encoded condition for the group */
          condition?: string;
          /** @description When type = 'list', this is the list of values for the attribute key */
          values?: (string)[];
          /** @description The person or team that owns this Saved Group. If no owner, you can pass an empty string. */
          owner?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            savedGroup: {
              id: string;
              /** @enum {string} */
              type: "condition" | "list";
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              /** @description When type = 'condition', this is the JSON-encoded condition for the group */
              condition?: string;
              /** @description When type = 'list', this is the attribute key the group is based on */
              attributeKey?: string;
              /** @description When type = 'list', this is the list of values for the attribute key */
              values?: (string)[];
            };
          };
        };
      };
    };
  };
  deleteSavedGroup: {
    /** Deletes a single saved group */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            deletedId: string;
          };
        };
      };
    };
  };
  listOrganizations: {
    /** Get all organizations (only for super admins on multi-org Enterprise Plan only) */
    parameters: {
        /** @description Search string to search organization names, owner emails, and external ids by */
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
      query: {
        search?: string;
        limit?: number;
        offset?: number;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            organizations: ({
                /** @description The Growthbook unique identifier for the organization */
                id?: string;
                /** @description An optional identifier that you use within your company for the organization */
                externalId?: string;
                /**
                 * Format: date-time 
                 * @description The date the organization was created
                 */
                dateCreated?: string;
                /** @description The name of the organization */
                name?: string;
                /** @description The email address of the organization owner */
                ownerEmail?: string;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postOrganization: {
    /** Create a single organization (only for super admins on multi-org Enterprise Plan only) */
    requestBody: {
      content: {
        "application/json": {
          /** @description The name of the organization */
          name: string;
          /** @description An optional identifier that you use within your company for the organization */
          externalId?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            organization: {
              /** @description The Growthbook unique identifier for the organization */
              id?: string;
              /** @description An optional identifier that you use within your company for the organization */
              externalId?: string;
              /**
               * Format: date-time 
               * @description The date the organization was created
               */
              dateCreated?: string;
              /** @description The name of the organization */
              name?: string;
              /** @description The email address of the organization owner */
              ownerEmail?: string;
            };
          };
        };
      };
    };
  };
  putOrganization: {
    /** Edit a single organization (only for super admins on multi-org Enterprise Plan only) */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          /** @description The name of the organization */
          name?: string;
          /** @description An optional identifier that you use within your company for the organization */
          externalId?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            organization: {
              /** @description The Growthbook unique identifier for the organization */
              id?: string;
              /** @description An optional identifier that you use within your company for the organization */
              externalId?: string;
              /**
               * Format: date-time 
               * @description The date the organization was created
               */
              dateCreated?: string;
              /** @description The name of the organization */
              name?: string;
              /** @description The email address of the organization owner */
              ownerEmail?: string;
            };
          };
        };
      };
    };
  };
  listFactTables: {
    /** Get all fact tables */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by Data Source */
        /** @description Filter by project id */
      query: {
        limit?: number;
        offset?: number;
        datasourceId?: string;
        projectId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTables: ({
                id: string;
                name: string;
                description: string;
                owner: string;
                projects: (string)[];
                tags: (string)[];
                datasource: string;
                userIdTypes: (string)[];
                sql: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postFactTable: {
    /** Create a single fact table */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          /** @description Description of the fact table */
          description?: string;
          /** @description The person who is responsible for this fact table */
          owner?: string;
          /** @description List of associated project ids */
          projects?: (string)[];
          /** @description List of associated tags */
          tags?: (string)[];
          /** @description The datasource id */
          datasource: string;
          /** @description List of identifier columns in this table. For example, "id" or "anonymous_id" */
          userIdTypes: (string)[];
          /** @description The SQL query for this fact table */
          sql: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTable: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              userIdTypes: (string)[];
              sql: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  getFactTable: {
    /** Get a single fact table */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTable: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              userIdTypes: (string)[];
              sql: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  updateFactTable: {
    /** Update a single fact table */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          /** @description Description of the fact table */
          description?: string;
          /** @description The person who is responsible for this fact table */
          owner?: string;
          /** @description List of associated project ids */
          projects?: (string)[];
          /** @description List of associated tags */
          tags?: (string)[];
          /** @description List of identifier columns in this table. For example, "id" or "anonymous_id" */
          userIdTypes?: (string)[];
          /** @description The SQL query for this fact table */
          sql?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTable: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              userIdTypes: (string)[];
              sql: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  deleteFactTable: {
    /** Deletes a single fact table */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            /**
             * @description The ID of the deleted fact table 
             * @example ftb_123abc
             */
            deletedId: string;
          };
        };
      };
    };
  };
  listFactTableFilters: {
    /** Get all filters for a fact table */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
      query: {
        limit?: number;
        offset?: number;
      };
        /** @description Specify a specific fact table */
      path: {
        factTableId: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTableFilters: ({
                id: string;
                name: string;
                description: string;
                value: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
              })[];
          } & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postFactTableFilter: {
    /** Create a single fact table filter */
    parameters: {
        /** @description Specify a specific fact table */
      path: {
        factTableId: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name: string;
          /** @description Description of the fact table filter */
          description?: string;
          /**
           * @description The SQL expression for this filter. 
           * @example country = 'US'
           */
          value: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTableFilter: {
              id: string;
              name: string;
              description: string;
              value: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  getFactTableFilter: {
    /** Get a single fact filter */
    parameters: {
        /** @description Specify a specific fact table */
        /** @description The id of the requested resource */
      path: {
        factTableId: string;
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTableFilter: {
              id: string;
              name: string;
              description: string;
              value: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  updateFactTableFilter: {
    /** Update a single fact table filter */
    parameters: {
        /** @description Specify a specific fact table */
        /** @description The id of the requested resource */
      path: {
        factTableId: string;
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          /** @description Description of the fact table filter */
          description?: string;
          /**
           * @description The SQL expression for this filter. 
           * @example country = 'US'
           */
          value?: string;
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factTableFilter: {
              id: string;
              name: string;
              description: string;
              value: string;
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  deleteFactTableFilter: {
    /** Deletes a single fact table filter */
    parameters: {
        /** @description Specify a specific fact table */
        /** @description The id of the requested resource */
      path: {
        factTableId: string;
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            /**
             * @description The ID of the deleted fact filter 
             * @example flt_123abc
             */
            deletedId: string;
          };
        };
      };
    };
  };
  listFactMetrics: {
    /** Get all fact metrics */
    parameters: {
        /** @description The number of items to return */
        /** @description How many items to skip (use in conjunction with limit for pagination) */
        /** @description Filter by Data Source */
        /** @description Filter by project id */
        /** @description Filter by Fact Table Id (for ratio metrics, we only look at the numerator) */
      query: {
        limit?: number;
        offset?: number;
        datasourceId?: string;
        projectId?: string;
        factTableId?: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": ({
            factMetrics: ({
                id: string;
                name: string;
                description: string;
                owner: string;
                projects: (string)[];
                tags: (string)[];
                datasource: string;
                /** @enum {string} */
                metricType: "proportion" | "mean" | "ratio";
                numerator: {
                  factTableId: string;
                  column: string;
                  /** @description Array of Fact Table Filter Ids */
                  filters: (string)[];
                };
                denominator?: {
                  factTableId: string;
                  column: string;
                  /** @description Array of Fact Table Filter Ids */
                  filters: (string)[];
                };
                /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
                inverse: boolean;
                /** @description Controls how outliers are handled */
                cappingSettings: {
                  /** @enum {string} */
                  type: "none" | "absolute" | "percentile";
                  /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
                  value?: number;
                };
                /** @description Controls the conversion window for the metric */
                windowSettings: {
                  /** @enum {string} */
                  type: "none" | "conversion";
                  /** @description Wait this many hours after experiment exposure before counting conversions */
                  delayHours: number;
                  windowValue?: number;
                  /** @enum {string} */
                  windowUnit?: "hours" | "days" | "weeks";
                };
                /** @description Controls the regression adjustment (CUPED) settings for the metric */
                regressionAdjustmentSettings: {
                  /** @description If false, the organization default settings will be used */
                  override: boolean;
                  /** @description Controls whether or not regresion adjustment is applied to the metric */
                  enabled?: boolean;
                  /** @description Number of pre-exposure days to use for the regression adjustment */
                  days?: number;
                };
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
              })[];
          }) & {
            limit: number;
            offset: number;
            count: number;
            total: number;
            hasMore: boolean;
            nextOffset: OneOf<[number, null]>;
          };
        };
      };
    };
  };
  postFactMetric: {
    /** Create a single fact metric */
    requestBody: {
      content: {
        "application/json": {
          name: string;
          description?: string;
          owner?: string;
          projects?: (string)[];
          tags?: (string)[];
          /** @enum {string} */
          metricType: "proportion" | "mean" | "ratio";
          numerator: {
            factTableId: string;
            /** @description Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count' */
            column?: string;
            /** @description Array of Fact Table Filter Ids */
            filters?: (string)[];
          };
          /** @description Only when metricType is 'ratio' */
          denominator?: {
            factTableId: string;
            /** @description The column name or one of the special values: '$$distinctUsers' or '$$count' */
            column: string;
            /** @description Array of Fact Table Filter Ids */
            filters?: (string)[];
          };
          /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
          inverse?: boolean;
          /** @description Controls how outliers are handled */
          cappingSettings?: {
            /** @enum {string} */
            type: "none" | "absolute" | "percentile";
            /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
            value?: number;
          };
          /** @description Controls the conversion window for the metric */
          windowSettings?: {
            /** @enum {string} */
            type: "none" | "conversion";
            /** @description Wait this many hours after experiment exposure before counting conversions */
            delayHours: number;
            windowValue?: number;
            /** @enum {string} */
            windowUnit?: "hours" | "days" | "weeks";
          };
          /** @description Controls the regression adjustment (CUPED) settings for the metric */
          regressionAdjustmentSettings?: {
            /** @description If false, the organization default settings will be used */
            override: boolean;
            /** @description Controls whether or not regresion adjustment is applied to the metric */
            enabled?: boolean;
            /** @description Number of pre-exposure days to use for the regression adjustment */
            days?: number;
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factMetric: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              /** @enum {string} */
              metricType: "proportion" | "mean" | "ratio";
              numerator: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              denominator?: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
              inverse: boolean;
              /** @description Controls how outliers are handled */
              cappingSettings: {
                /** @enum {string} */
                type: "none" | "absolute" | "percentile";
                /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
                value?: number;
              };
              /** @description Controls the conversion window for the metric */
              windowSettings: {
                /** @enum {string} */
                type: "none" | "conversion";
                /** @description Wait this many hours after experiment exposure before counting conversions */
                delayHours: number;
                windowValue?: number;
                /** @enum {string} */
                windowUnit?: "hours" | "days" | "weeks";
              };
              /** @description Controls the regression adjustment (CUPED) settings for the metric */
              regressionAdjustmentSettings: {
                /** @description If false, the organization default settings will be used */
                override: boolean;
                /** @description Controls whether or not regresion adjustment is applied to the metric */
                enabled?: boolean;
                /** @description Number of pre-exposure days to use for the regression adjustment */
                days?: number;
              };
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  getFactMetric: {
    /** Get a single fact metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factMetric: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              /** @enum {string} */
              metricType: "proportion" | "mean" | "ratio";
              numerator: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              denominator?: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
              inverse: boolean;
              /** @description Controls how outliers are handled */
              cappingSettings: {
                /** @enum {string} */
                type: "none" | "absolute" | "percentile";
                /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
                value?: number;
              };
              /** @description Controls the conversion window for the metric */
              windowSettings: {
                /** @enum {string} */
                type: "none" | "conversion";
                /** @description Wait this many hours after experiment exposure before counting conversions */
                delayHours: number;
                windowValue?: number;
                /** @enum {string} */
                windowUnit?: "hours" | "days" | "weeks";
              };
              /** @description Controls the regression adjustment (CUPED) settings for the metric */
              regressionAdjustmentSettings: {
                /** @description If false, the organization default settings will be used */
                override: boolean;
                /** @description Controls whether or not regresion adjustment is applied to the metric */
                enabled?: boolean;
                /** @description Number of pre-exposure days to use for the regression adjustment */
                days?: number;
              };
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  updateFactMetric: {
    /** Update a single fact metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    requestBody: {
      content: {
        "application/json": {
          name?: string;
          description?: string;
          owner?: string;
          projects?: (string)[];
          tags?: (string)[];
          /** @enum {string} */
          metricType?: "proportion" | "mean" | "ratio";
          numerator?: {
            factTableId: string;
            /** @description Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count' */
            column?: string;
            /** @description Array of Fact Table Filter Ids */
            filters?: (string)[];
          };
          /** @description Only when metricType is 'ratio' */
          denominator?: {
            factTableId: string;
            /** @description Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count' */
            column: string;
            /** @description Array of Fact Table Filter Ids */
            filters?: (string)[];
          };
          /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
          inverse?: boolean;
          /** @description Controls how outliers are handled */
          cappingSettings?: {
            /** @enum {string} */
            type: "none" | "absolute" | "percentile";
            /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
            value?: number;
          };
          /** @description Controls the conversion window for the metric */
          windowSettings?: {
            /** @enum {string} */
            type: "none" | "conversion";
            /** @description Wait this many hours after experiment exposure before counting conversions */
            delayHours: number;
            windowValue?: number;
            /** @enum {string} */
            windowUnit?: "hours" | "days" | "weeks";
          };
          /** @description Controls the regression adjustment (CUPED) settings for the metric */
          regressionAdjustmentSettings?: {
            /** @description If false, the organization default settings will be used */
            override: boolean;
            /** @description Controls whether or not regresion adjustment is applied to the metric */
            enabled?: boolean;
            /** @description Number of pre-exposure days to use for the regression adjustment */
            days?: number;
          };
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            factMetric: {
              id: string;
              name: string;
              description: string;
              owner: string;
              projects: (string)[];
              tags: (string)[];
              datasource: string;
              /** @enum {string} */
              metricType: "proportion" | "mean" | "ratio";
              numerator: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              denominator?: {
                factTableId: string;
                column: string;
                /** @description Array of Fact Table Filter Ids */
                filters: (string)[];
              };
              /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
              inverse: boolean;
              /** @description Controls how outliers are handled */
              cappingSettings: {
                /** @enum {string} */
                type: "none" | "absolute" | "percentile";
                /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
                value?: number;
              };
              /** @description Controls the conversion window for the metric */
              windowSettings: {
                /** @enum {string} */
                type: "none" | "conversion";
                /** @description Wait this many hours after experiment exposure before counting conversions */
                delayHours: number;
                windowValue?: number;
                /** @enum {string} */
                windowUnit?: "hours" | "days" | "weeks";
              };
              /** @description Controls the regression adjustment (CUPED) settings for the metric */
              regressionAdjustmentSettings: {
                /** @description If false, the organization default settings will be used */
                override: boolean;
                /** @description Controls whether or not regresion adjustment is applied to the metric */
                enabled?: boolean;
                /** @description Number of pre-exposure days to use for the regression adjustment */
                days?: number;
              };
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
            };
          };
        };
      };
    };
  };
  deleteFactMetric: {
    /** Deletes a single fact metric */
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            /**
             * @description The ID of the deleted fact metric 
             * @example fact__123abc
             */
            deletedId?: string;
          };
        };
      };
    };
  };
  postBulkImportFacts: {
    /** Bulk import fact tables, filters, and metrics */
    requestBody: {
      content: {
        "application/json": {
          factTables?: ({
              id: string;
              data: {
                name: string;
                /** @description Description of the fact table */
                description?: string;
                /** @description The person who is responsible for this fact table */
                owner?: string;
                /** @description List of associated project ids */
                projects?: (string)[];
                /** @description List of associated tags */
                tags?: (string)[];
                /** @description The datasource id */
                datasource: string;
                /** @description List of identifier columns in this table. For example, "id" or "anonymous_id" */
                userIdTypes: (string)[];
                /** @description The SQL query for this fact table */
                sql: string;
              };
            })[];
          factTableFilters?: ({
              factTableId: string;
              id: string;
              data: {
                name: string;
                /** @description Description of the fact table filter */
                description?: string;
                /**
                 * @description The SQL expression for this filter. 
                 * @example country = 'US'
                 */
                value: string;
              };
            })[];
          factMetrics?: ({
              id: string;
              data: {
                name: string;
                description?: string;
                owner?: string;
                projects?: (string)[];
                tags?: (string)[];
                /** @enum {string} */
                metricType: "proportion" | "mean" | "ratio";
                numerator: {
                  factTableId: string;
                  /** @description Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count' */
                  column?: string;
                  /** @description Array of Fact Table Filter Ids */
                  filters?: (string)[];
                };
                /** @description Only when metricType is 'ratio' */
                denominator?: {
                  factTableId: string;
                  /** @description The column name or one of the special values: '$$distinctUsers' or '$$count' */
                  column: string;
                  /** @description Array of Fact Table Filter Ids */
                  filters?: (string)[];
                };
                /** @description Set to true for things like Bounce Rate, where you want the metric to decrease */
                inverse?: boolean;
                /** @description Controls how outliers are handled */
                cappingSettings?: {
                  /** @enum {string} */
                  type: "none" | "absolute" | "percentile";
                  /** @description When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0). */
                  value?: number;
                };
                /** @description Controls the conversion window for the metric */
                windowSettings?: {
                  /** @enum {string} */
                  type: "none" | "conversion";
                  /** @description Wait this many hours after experiment exposure before counting conversions */
                  delayHours: number;
                  windowValue?: number;
                  /** @enum {string} */
                  windowUnit?: "hours" | "days" | "weeks";
                };
                /** @description Controls the regression adjustment (CUPED) settings for the metric */
                regressionAdjustmentSettings?: {
                  /** @description If false, the organization default settings will be used */
                  override: boolean;
                  /** @description Controls whether or not regresion adjustment is applied to the metric */
                  enabled?: boolean;
                  /** @description Number of pre-exposure days to use for the regression adjustment */
                  days?: number;
                };
              };
            })[];
        };
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            success: boolean;
          };
        };
      };
    };
  };
  postCodeRefs: {
    /** Submit list of code references */
    requestBody: {
      content: {
        "application/json": ({
            filePath?: string;
            startingLineNumber?: number;
            lines?: string;
            flagKey?: string;
            contentHash?: string;
          })[];
      };
    };
    responses: {
      200: {
        content: {
          "application/json": {
            featuresUpdated?: (string)[];
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
export type ApiFeatureExperimentRefRule = components["schemas"]["FeatureExperimentRefRule"];
export type ApiSdkConnection = components["schemas"]["SdkConnection"];
export type ApiExperiment = components["schemas"]["Experiment"];
export type ApiExperimentMetric = components["schemas"]["ExperimentMetric"];
export type ApiExperimentAnalysisSettings = components["schemas"]["ExperimentAnalysisSettings"];
export type ApiExperimentResults = components["schemas"]["ExperimentResults"];
export type ApiDataSource = components["schemas"]["DataSource"];
export type ApiVisualChangeset = components["schemas"]["VisualChangeset"];
export type ApiVisualChange = components["schemas"]["VisualChange"];
export type ApiSavedGroup = components["schemas"]["SavedGroup"];
export type ApiOrganization = components["schemas"]["Organization"];
export type ApiFactTable = components["schemas"]["FactTable"];
export type ApiFactTableFilter = components["schemas"]["FactTableFilter"];
export type ApiFactMetric = components["schemas"]["FactMetric"];

// Operations
export type ListFeaturesResponse = operations["listFeatures"]["responses"]["200"]["content"]["application/json"];
export type PostFeatureResponse = operations["postFeature"]["responses"]["200"]["content"]["application/json"];
export type GetFeatureResponse = operations["getFeature"]["responses"]["200"]["content"]["application/json"];
export type UpdateFeatureResponse = operations["updateFeature"]["responses"]["200"]["content"]["application/json"];
export type ToggleFeatureResponse = operations["toggleFeature"]["responses"]["200"]["content"]["application/json"];
export type GetFeatureKeysResponse = operations["getFeatureKeys"]["responses"]["200"]["content"]["application/json"];
export type ListProjectsResponse = operations["listProjects"]["responses"]["200"]["content"]["application/json"];
export type GetProjectResponse = operations["getProject"]["responses"]["200"]["content"]["application/json"];
export type ListDimensionsResponse = operations["listDimensions"]["responses"]["200"]["content"]["application/json"];
export type GetDimensionResponse = operations["getDimension"]["responses"]["200"]["content"]["application/json"];
export type ListSegmentsResponse = operations["listSegments"]["responses"]["200"]["content"]["application/json"];
export type GetSegmentResponse = operations["getSegment"]["responses"]["200"]["content"]["application/json"];
export type ListSdkConnectionsResponse = operations["listSdkConnections"]["responses"]["200"]["content"]["application/json"];
export type GetSdkConnectionResponse = operations["getSdkConnection"]["responses"]["200"]["content"]["application/json"];
export type ListDataSourcesResponse = operations["listDataSources"]["responses"]["200"]["content"]["application/json"];
export type GetDataSourceResponse = operations["getDataSource"]["responses"]["200"]["content"]["application/json"];
export type ListExperimentsResponse = operations["listExperiments"]["responses"]["200"]["content"]["application/json"];
export type PostExperimentResponse = operations["postExperiment"]["responses"]["200"]["content"]["application/json"];
export type GetExperimentResponse = operations["getExperiment"]["responses"]["200"]["content"]["application/json"];
export type UpdateExperimentResponse = operations["updateExperiment"]["responses"]["200"]["content"]["application/json"];
export type GetExperimentResultsResponse = operations["getExperimentResults"]["responses"]["200"]["content"]["application/json"];
export type ListMetricsResponse = operations["listMetrics"]["responses"]["200"]["content"]["application/json"];
export type PostMetricResponse = operations["postMetric"]["responses"]["200"]["content"]["application/json"];
export type GetMetricResponse = operations["getMetric"]["responses"]["200"]["content"]["application/json"];
export type PutMetricResponse = operations["putMetric"]["responses"]["200"]["content"]["application/json"];
export type DeleteMetricResponse = operations["deleteMetric"]["responses"]["200"]["content"]["application/json"];
export type ListVisualChangesetsResponse = operations["listVisualChangesets"]["responses"]["200"]["content"]["application/json"];
export type GetVisualChangesetResponse = operations["getVisualChangeset"]["responses"]["200"]["content"]["application/json"];
export type PutVisualChangesetResponse = operations["putVisualChangeset"]["responses"]["200"]["content"]["application/json"];
export type PostVisualChangeResponse = operations["postVisualChange"]["responses"]["200"]["content"]["application/json"];
export type PutVisualChangeResponse = operations["putVisualChange"]["responses"]["200"]["content"]["application/json"];
export type ListSavedGroupsResponse = operations["listSavedGroups"]["responses"]["200"]["content"]["application/json"];
export type PostSavedGroupResponse = operations["postSavedGroup"]["responses"]["200"]["content"]["application/json"];
export type GetSavedGroupResponse = operations["getSavedGroup"]["responses"]["200"]["content"]["application/json"];
export type UpdateSavedGroupResponse = operations["updateSavedGroup"]["responses"]["200"]["content"]["application/json"];
export type DeleteSavedGroupResponse = operations["deleteSavedGroup"]["responses"]["200"]["content"]["application/json"];
export type ListOrganizationsResponse = operations["listOrganizations"]["responses"]["200"]["content"]["application/json"];
export type PostOrganizationResponse = operations["postOrganization"]["responses"]["200"]["content"]["application/json"];
export type PutOrganizationResponse = operations["putOrganization"]["responses"]["200"]["content"]["application/json"];
export type ListFactTablesResponse = operations["listFactTables"]["responses"]["200"]["content"]["application/json"];
export type PostFactTableResponse = operations["postFactTable"]["responses"]["200"]["content"]["application/json"];
export type GetFactTableResponse = operations["getFactTable"]["responses"]["200"]["content"]["application/json"];
export type UpdateFactTableResponse = operations["updateFactTable"]["responses"]["200"]["content"]["application/json"];
export type DeleteFactTableResponse = operations["deleteFactTable"]["responses"]["200"]["content"]["application/json"];
export type ListFactTableFiltersResponse = operations["listFactTableFilters"]["responses"]["200"]["content"]["application/json"];
export type PostFactTableFilterResponse = operations["postFactTableFilter"]["responses"]["200"]["content"]["application/json"];
export type GetFactTableFilterResponse = operations["getFactTableFilter"]["responses"]["200"]["content"]["application/json"];
export type UpdateFactTableFilterResponse = operations["updateFactTableFilter"]["responses"]["200"]["content"]["application/json"];
export type DeleteFactTableFilterResponse = operations["deleteFactTableFilter"]["responses"]["200"]["content"]["application/json"];
export type ListFactMetricsResponse = operations["listFactMetrics"]["responses"]["200"]["content"]["application/json"];
export type PostFactMetricResponse = operations["postFactMetric"]["responses"]["200"]["content"]["application/json"];
export type GetFactMetricResponse = operations["getFactMetric"]["responses"]["200"]["content"]["application/json"];
export type UpdateFactMetricResponse = operations["updateFactMetric"]["responses"]["200"]["content"]["application/json"];
export type DeleteFactMetricResponse = operations["deleteFactMetric"]["responses"]["200"]["content"]["application/json"];
export type PostBulkImportFactsResponse = operations["postBulkImportFacts"]["responses"]["200"]["content"]["application/json"];
export type PostCodeRefsResponse = operations["postCodeRefs"]["responses"]["200"]["content"]["application/json"];
