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
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
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
          rules: ({
              description: string;
              condition: string;
              id: string;
              enabled: boolean;
              type: string;
              value: string;
            } | {
              description: string;
              condition: string;
              id: string;
              enabled: boolean;
              type: string;
              value: string;
              coverage: number;
              hashAttribute: string;
            } | {
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
                range: (number)[];
              };
              coverage?: number;
              value?: ({
                  value: string;
                  weight: number;
                  name?: string;
                })[];
            })[];
          /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
          definition?: string;
          draft?: {
            enabled: boolean;
            defaultValue: string;
            rules: ({
                description: string;
                condition: string;
                id: string;
                enabled: boolean;
                type: string;
                value: string;
              } | {
                description: string;
                condition: string;
                id: string;
                enabled: boolean;
                type: string;
                value: string;
                coverage: number;
                hashAttribute: string;
              } | {
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
                  range: (number)[];
                };
                coverage?: number;
                value?: ({
                    value: string;
                    weight: number;
                    name?: string;
                  })[];
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
      rules: ({
          description: string;
          condition: string;
          id: string;
          enabled: boolean;
          type: string;
          value: string;
        } | {
          description: string;
          condition: string;
          id: string;
          enabled: boolean;
          type: string;
          value: string;
          coverage: number;
          hashAttribute: string;
        } | {
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
            range: (number)[];
          };
          coverage?: number;
          value?: ({
              value: string;
              weight: number;
              name?: string;
            })[];
        })[];
      /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
      definition?: string;
      draft?: {
        enabled: boolean;
        defaultValue: string;
        rules: ({
            description: string;
            condition: string;
            id: string;
            enabled: boolean;
            type: string;
            value: string;
          } | {
            description: string;
            condition: string;
            id: string;
            enabled: boolean;
            type: string;
            value: string;
            coverage: number;
            hashAttribute: string;
          } | {
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
              range: (number)[];
            };
            coverage?: number;
            value?: ({
                value: string;
                weight: number;
                name?: string;
              })[];
          })[];
        /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
        definition?: string;
      };
    };
    FeatureRule: {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      value: string;
    } | {
      description: string;
      condition: string;
      id: string;
      enabled: boolean;
      type: string;
      value: string;
      coverage: number;
      hashAttribute: string;
    } | {
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
        range: (number)[];
      };
      coverage?: number;
      value?: ({
          value: string;
          weight: number;
          name?: string;
        })[];
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
        range: (number)[];
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
      includeVisualExperiments?: boolean;
      includeDraftExperiments?: boolean;
      includeExperimentNames?: boolean;
      key: string;
      proxyEnabled: boolean;
      proxyHost: string;
      proxySigningKey: string;
      sseEnabled?: boolean;
      hashSecureAttributes?: boolean;
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
      /** Format: date-time */
      dateCreated: string;
      /** Format: date-time */
      dateUpdated: string;
      name: string;
      owner?: string;
      attributeKey: string;
      values: (string)[];
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
                    rules: ({
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      } | {
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
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
                      })[];
                    /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string;
                    draft?: {
                      enabled: boolean;
                      defaultValue: string;
                      rules: ({
                          description: string;
                          condition: string;
                          id: string;
                          enabled: boolean;
                          type: string;
                          value: string;
                        } | {
                          description: string;
                          condition: string;
                          id: string;
                          enabled: boolean;
                          type: string;
                          value: string;
                          coverage: number;
                          hashAttribute: string;
                        } | {
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
                            range: (number)[];
                          };
                          coverage?: number;
                          value?: ({
                              value: string;
                              weight: number;
                              name?: string;
                            })[];
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
  getFeature: {
    /** Get a single feature */
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
                  rules: ({
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    } | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    } | {
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
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      } | {
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
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
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
                  rules: ({
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                    } | {
                      description: string;
                      condition: string;
                      id: string;
                      enabled: boolean;
                      type: string;
                      value: string;
                      coverage: number;
                      hashAttribute: string;
                    } | {
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
                        range: (number)[];
                      };
                      coverage?: number;
                      value?: ({
                          value: string;
                          weight: number;
                          name?: string;
                        })[];
                    })[];
                  /** @description A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                  definition?: string;
                  draft?: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                      } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: string;
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                      } | {
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
                          range: (number)[];
                        };
                        coverage?: number;
                        value?: ({
                            value: string;
                            weight: number;
                            name?: string;
                          })[];
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
                languages: (string)[];
                environment: string;
                project: string;
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
              languages: (string)[];
              environment: string;
              project: string;
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
          /** @description Email of the person who owns this experiment */
          owner: string;
          archived?: boolean;
          /** @enum {string} */
          status?: "draft" | "running" | "stopped";
          autoRefresh?: boolean;
          hashAttribute?: string;
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
          /** @description Email of the person who owns this experiment */
          owner?: string;
          archived?: boolean;
          /** @enum {string} */
          status?: "draft" | "running" | "stopped";
          autoRefresh?: boolean;
          hashAttribute?: string;
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
          "application/json": {
            savedGroups: ({
                id: string;
                /** Format: date-time */
                dateCreated: string;
                /** Format: date-time */
                dateUpdated: string;
                name: string;
                owner?: string;
                attributeKey: string;
                values: (string)[];
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
  postSavedGroup: {
    /** Create a single saved group */
    requestBody: {
      content: {
        "application/json": {
          /** @description The display name of the Saved Group */
          name: string;
          /** @description An array of values to target (Ex: a list of userIds). */
          values: (string)[];
          /** @description The parameter you want to target users with. Ex: userId, orgId, ... */
          attributeKey: string;
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
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              attributeKey: string;
              values: (string)[];
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
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              attributeKey: string;
              values: (string)[];
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
          /** @description An array of values to target (Ex: a list of userIds). */
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
              /** Format: date-time */
              dateCreated: string;
              /** Format: date-time */
              dateUpdated: string;
              name: string;
              owner?: string;
              attributeKey: string;
              values: (string)[];
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
export type ApiExperiment = components["schemas"]["Experiment"];
export type ApiExperimentMetric = components["schemas"]["ExperimentMetric"];
export type ApiExperimentAnalysisSettings = components["schemas"]["ExperimentAnalysisSettings"];
export type ApiExperimentResults = components["schemas"]["ExperimentResults"];
export type ApiDataSource = components["schemas"]["DataSource"];
export type ApiVisualChangeset = components["schemas"]["VisualChangeset"];
export type ApiVisualChange = components["schemas"]["VisualChange"];
export type ApiSavedGroup = components["schemas"]["SavedGroup"];

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
