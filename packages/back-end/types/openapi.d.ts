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
  "/metrics": {
    /** Get all metrics */
    get: operations["listMetrics"];
  };
  "/metrics/{id}": {
    /** Get a single metric */
    get: operations["getMetric"];
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
  };
  "/experiments/{id}": {
    /** Get a single experiment */
    get: operations["getExperiment"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
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
  "/visual-changesets": {
    /** Get all visual changeset */
    get: operations["listVisualChangesets"];
  };
  "/visual-changesets/{id}": {
    /** Get a single visual changeset */
    get: operations["getVisualChangeset"];
    parameters: {
        /** @description The id of the requested resource */
      path: {
        id: string;
      };
    };
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
          definition?: {
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
            definition?: {
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
      definition?: {
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
        definition?: {
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
      key: string;
      proxyEnabled: boolean;
      proxyHost: string;
      proxySigningKey: string;
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
        multipleVariations: "include" | "exclude";
        /** @enum {unknown} */
        attributionModel: "firstExposure" | "allExposures";
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
      multipleVariations: "include" | "exclude";
      /** @enum {unknown} */
      attributionModel: "firstExposure" | "allExposures";
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
        multipleVariations: "include" | "exclude";
        /** @enum {unknown} */
        attributionModel: "firstExposure" | "allExposures";
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
      urlPattern: string;
      editorUrl: string;
      experiment: string;
      visualChanges: ({
          description?: string;
          css?: string;
          variation: string;
          domMutations: ({
              selector: string;
              /** @enum {string} */
              action: "append" | "set" | "remove";
              attribute: string;
              value?: string;
            })[];
        })[];
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
                    definition?: {
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
                      definition?: {
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
                  definition?: {
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
                    definition?: {
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
                  definition?: {
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
                    definition?: {
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
  getMetric: {
    /** Get a single metric */
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
                key: string;
                proxyEnabled: boolean;
                proxyHost: string;
                proxySigningKey: string;
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
              key: string;
              proxyEnabled: boolean;
              proxyHost: string;
              proxySigningKey: string;
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
                  multipleVariations: "include" | "exclude";
                  /** @enum {unknown} */
                  attributionModel: "firstExposure" | "allExposures";
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
  getExperiment: {
    /** Get a single experiment */
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
                multipleVariations: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "allExposures";
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
                multipleVariations: "include" | "exclude";
                /** @enum {unknown} */
                attributionModel: "firstExposure" | "allExposures";
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
  listVisualChangesets: {
    /** Get all visual changeset */
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
            visualChangesets: ({
                id?: string;
                urlPattern: string;
                editorUrl: string;
                experiment: string;
                visualChanges: ({
                    description?: string;
                    css?: string;
                    variation: string;
                    domMutations: ({
                        selector: string;
                        /** @enum {string} */
                        action: "append" | "set" | "remove";
                        attribute: string;
                        value?: string;
                      })[];
                  })[];
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
  getVisualChangeset: {
    /** Get a single visual changeset */
    responses: {
      200: {
        content: {
          "application/json": {
            visualChangeset: {
              id?: string;
              urlPattern: string;
              editorUrl: string;
              experiment: string;
              visualChanges: ({
                  description?: string;
                  css?: string;
                  variation: string;
                  domMutations: ({
                      selector: string;
                      /** @enum {string} */
                      action: "append" | "set" | "remove";
                      attribute: string;
                      value?: string;
                    })[];
                })[];
            };
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
export type ListDataSourcesResponse = operations["listDataSources"]["responses"]["200"]["content"]["application/json"];
export type GetDataSourceResponse = operations["getDataSource"]["responses"]["200"]["content"]["application/json"];
export type ListExperimentsResponse = operations["listExperiments"]["responses"]["200"]["content"]["application/json"];
export type GetExperimentResponse = operations["getExperiment"]["responses"]["200"]["content"]["application/json"];
export type GetExperimentResultsResponse = operations["getExperimentResults"]["responses"]["200"]["content"]["application/json"];
export type ListVisualChangesetsResponse = operations["listVisualChangesets"]["responses"]["200"]["content"]["application/json"];
export type GetVisualChangesetResponse = operations["getVisualChangeset"]["responses"]["200"]["content"]["application/json"];
