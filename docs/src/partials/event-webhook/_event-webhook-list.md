
  | Event name | Description |
  |------------|-------------|
  | **[feature.created](#featurecreated)** | Triggered when a feature is created |
| **[feature.updated](#featureupdated)** | Triggered when a feature is updated |
| **[feature.deleted](#featuredeleted)** | Triggered when a feature is deleted |
| **[feature.saferollout.ship](#featuresaferolloutship)** | Triggered when a safe rollout is completed and safe to rollout to 100%. |
| **[feature.saferollout.rollback](#featuresaferolloutrollback)** | Triggered when a safe rollout has a failing guardrail and should be reverted. |
| **[feature.saferollout.unhealthy](#featuresaferolloutunhealthy)** | Triggered when a safe rollout is failing a health check and may not be working as expected. |
| **[experiment.created](#experimentcreated)** | Triggered when an experiment is created |
| **[experiment.updated](#experimentupdated)** | Triggered when an experiment is updated |
| **[experiment.deleted](#experimentdeleted)** | Triggered when an experiment is deleted |
| **[experiment.warning](#experimentwarning)** | Triggered when a warning condition is detected on an experiment |
| **[experiment.info.significance](#experimentinfosignificance)** | Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems. |
| **[experiment.decision.ship](#experimentdecisionship)** | Triggered when an experiment is ready to ship a variation. |
| **[experiment.decision.rollback](#experimentdecisionrollback)** | Triggered when an experiment should be rolled back to the control. |
| **[experiment.decision.review](#experimentdecisionreview)** | Triggered when an experiment has reached the desired power point, but the results may be ambiguous. |
| **[user.login](#userlogin)** | Triggered when a user logs in |

  
### feature.created

Triggered when a feature is created

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.created";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            dateCreated: string;
            dateUpdated: string;
            archived: boolean;
            description: string;
            owner: string;
            project: string;
            valueType: "boolean" | "string" | "number" | "json";
            defaultValue: string;
            tags: string[];
            environments: {
                [x: string]: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "force";
                        value: string;
                    } | {
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "rollout";
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                    } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment";
                        trackingKey?: string | undefined;
                        hashAttribute?: string | undefined;
                        fallbackAttribute?: string | undefined;
                        disableStickyBucketing?: boolean | undefined;
                        bucketVersion?: number | undefined;
                        minBucketVersion?: number | undefined;
                        namespace?: {
                            enabled: boolean;
                            name: string;
                            range: number[];
                        } | undefined;
                        coverage?: number | undefined;
                        value?: {
                            value: string;
                            weight: number;
                            name?: string | undefined;
                        }[] | undefined;
                    } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment-ref";
                        condition?: string | undefined;
                        variations: {
                            value: string;
                            variationId: string;
                        }[];
                        experimentId: string;
                    } | {
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        trackingKey?: string | undefined;
                        enabled: boolean;
                        type: "safe-rollout";
                        controlValue: string;
                        variationValue: string;
                        seed?: string | undefined;
                        hashAttribute?: string | undefined;
                        safeRolloutId?: string | undefined;
                        status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                    })[];
                    /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string | undefined;
                    draft?: {
                        enabled: boolean;
                        defaultValue: string;
                        rules: ({
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "force";
                            value: string;
                        } | {
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "rollout";
                            value: string;
                            coverage: number;
                            hashAttribute: string;
                        } | {
                            description: string;
                            condition: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment";
                            trackingKey?: string | undefined;
                            hashAttribute?: string | undefined;
                            fallbackAttribute?: string | undefined;
                            disableStickyBucketing?: boolean | undefined;
                            bucketVersion?: number | undefined;
                            minBucketVersion?: number | undefined;
                            namespace?: {
                                enabled: boolean;
                                name: string;
                                range: number[];
                            } | undefined;
                            coverage?: number | undefined;
                            value?: {
                                value: string;
                                weight: number;
                                name?: string | undefined;
                            }[] | undefined;
                        } | {
                            description: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment-ref";
                            condition?: string | undefined;
                            variations: {
                                value: string;
                                variationId: string;
                            }[];
                            experimentId: string;
                        } | {
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            trackingKey?: string | undefined;
                            enabled: boolean;
                            type: "safe-rollout";
                            controlValue: string;
                            variationValue: string;
                            seed?: string | undefined;
                            hashAttribute?: string | undefined;
                            safeRolloutId?: string | undefined;
                            status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                        })[];
                        /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                        definition?: string | undefined;
                    } | undefined;
                };
            };
            /** Feature IDs. Each feature must evaluate to `true` */
            prerequisites?: string[] | undefined;
            revision: {
                version: number;
                comment: string;
                date: string;
                publishedBy: string;
            };
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### feature.updated

Triggered when a feature is updated

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.updated";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            dateCreated: string;
            dateUpdated: string;
            archived: boolean;
            description: string;
            owner: string;
            project: string;
            valueType: "boolean" | "string" | "number" | "json";
            defaultValue: string;
            tags: string[];
            environments: {
                [x: string]: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "force";
                        value: string;
                    } | {
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "rollout";
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                    } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment";
                        trackingKey?: string | undefined;
                        hashAttribute?: string | undefined;
                        fallbackAttribute?: string | undefined;
                        disableStickyBucketing?: boolean | undefined;
                        bucketVersion?: number | undefined;
                        minBucketVersion?: number | undefined;
                        namespace?: {
                            enabled: boolean;
                            name: string;
                            range: number[];
                        } | undefined;
                        coverage?: number | undefined;
                        value?: {
                            value: string;
                            weight: number;
                            name?: string | undefined;
                        }[] | undefined;
                    } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment-ref";
                        condition?: string | undefined;
                        variations: {
                            value: string;
                            variationId: string;
                        }[];
                        experimentId: string;
                    } | {
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        trackingKey?: string | undefined;
                        enabled: boolean;
                        type: "safe-rollout";
                        controlValue: string;
                        variationValue: string;
                        seed?: string | undefined;
                        hashAttribute?: string | undefined;
                        safeRolloutId?: string | undefined;
                        status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                    })[];
                    /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string | undefined;
                    draft?: {
                        enabled: boolean;
                        defaultValue: string;
                        rules: ({
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "force";
                            value: string;
                        } | {
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "rollout";
                            value: string;
                            coverage: number;
                            hashAttribute: string;
                        } | {
                            description: string;
                            condition: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment";
                            trackingKey?: string | undefined;
                            hashAttribute?: string | undefined;
                            fallbackAttribute?: string | undefined;
                            disableStickyBucketing?: boolean | undefined;
                            bucketVersion?: number | undefined;
                            minBucketVersion?: number | undefined;
                            namespace?: {
                                enabled: boolean;
                                name: string;
                                range: number[];
                            } | undefined;
                            coverage?: number | undefined;
                            value?: {
                                value: string;
                                weight: number;
                                name?: string | undefined;
                            }[] | undefined;
                        } | {
                            description: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment-ref";
                            condition?: string | undefined;
                            variations: {
                                value: string;
                                variationId: string;
                            }[];
                            experimentId: string;
                        } | {
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            trackingKey?: string | undefined;
                            enabled: boolean;
                            type: "safe-rollout";
                            controlValue: string;
                            variationValue: string;
                            seed?: string | undefined;
                            hashAttribute?: string | undefined;
                            safeRolloutId?: string | undefined;
                            status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                        })[];
                        /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                        definition?: string | undefined;
                    } | undefined;
                };
            };
            /** Feature IDs. Each feature must evaluate to `true` */
            prerequisites?: string[] | undefined;
            revision: {
                version: number;
                comment: string;
                date: string;
                publishedBy: string;
            };
        };
        previous_attributes: {
            id?: string | undefined;
            dateCreated?: string | undefined;
            dateUpdated?: string | undefined;
            archived?: boolean | undefined;
            description?: string | undefined;
            owner?: string | undefined;
            project?: string | undefined;
            valueType?: ("boolean" | "string" | "number" | "json") | undefined;
            defaultValue?: string | undefined;
            tags?: string[] | undefined;
            environments?: {
                [x: string]: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "force";
                        value: string;
                    } | {
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "rollout";
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                    } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment";
                        trackingKey?: string | undefined;
                        hashAttribute?: string | undefined;
                        fallbackAttribute?: string | undefined;
                        disableStickyBucketing?: boolean | undefined;
                        bucketVersion?: number | undefined;
                        minBucketVersion?: number | undefined;
                        namespace?: {
                            enabled: boolean;
                            name: string;
                            range: number[];
                        } | undefined;
                        coverage?: number | undefined;
                        value?: {
                            value: string;
                            weight: number;
                            name?: string | undefined;
                        }[] | undefined;
                    } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment-ref";
                        condition?: string | undefined;
                        variations: {
                            value: string;
                            variationId: string;
                        }[];
                        experimentId: string;
                    } | {
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        trackingKey?: string | undefined;
                        enabled: boolean;
                        type: "safe-rollout";
                        controlValue: string;
                        variationValue: string;
                        seed?: string | undefined;
                        hashAttribute?: string | undefined;
                        safeRolloutId?: string | undefined;
                        status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                    })[];
                    /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string | undefined;
                    draft?: {
                        enabled: boolean;
                        defaultValue: string;
                        rules: ({
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "force";
                            value: string;
                        } | {
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "rollout";
                            value: string;
                            coverage: number;
                            hashAttribute: string;
                        } | {
                            description: string;
                            condition: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment";
                            trackingKey?: string | undefined;
                            hashAttribute?: string | undefined;
                            fallbackAttribute?: string | undefined;
                            disableStickyBucketing?: boolean | undefined;
                            bucketVersion?: number | undefined;
                            minBucketVersion?: number | undefined;
                            namespace?: {
                                enabled: boolean;
                                name: string;
                                range: number[];
                            } | undefined;
                            coverage?: number | undefined;
                            value?: {
                                value: string;
                                weight: number;
                                name?: string | undefined;
                            }[] | undefined;
                        } | {
                            description: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment-ref";
                            condition?: string | undefined;
                            variations: {
                                value: string;
                                variationId: string;
                            }[];
                            experimentId: string;
                        } | {
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            trackingKey?: string | undefined;
                            enabled: boolean;
                            type: "safe-rollout";
                            controlValue: string;
                            variationValue: string;
                            seed?: string | undefined;
                            hashAttribute?: string | undefined;
                            safeRolloutId?: string | undefined;
                            status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                        })[];
                        /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                        definition?: string | undefined;
                    } | undefined;
                };
            } | undefined;
            /** Feature IDs. Each feature must evaluate to `true` */
            prerequisites?: (string[] | undefined) | undefined;
            revision?: {
                version: number;
                comment: string;
                date: string;
                publishedBy: string;
            } | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### feature.deleted

Triggered when a feature is deleted

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.deleted";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            dateCreated: string;
            dateUpdated: string;
            archived: boolean;
            description: string;
            owner: string;
            project: string;
            valueType: "boolean" | "string" | "number" | "json";
            defaultValue: string;
            tags: string[];
            environments: {
                [x: string]: {
                    enabled: boolean;
                    defaultValue: string;
                    rules: ({
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "force";
                        value: string;
                    } | {
                        description: string;
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        id: string;
                        enabled: boolean;
                        type: "rollout";
                        value: string;
                        coverage: number;
                        hashAttribute: string;
                    } | {
                        description: string;
                        condition: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment";
                        trackingKey?: string | undefined;
                        hashAttribute?: string | undefined;
                        fallbackAttribute?: string | undefined;
                        disableStickyBucketing?: boolean | undefined;
                        bucketVersion?: number | undefined;
                        minBucketVersion?: number | undefined;
                        namespace?: {
                            enabled: boolean;
                            name: string;
                            range: number[];
                        } | undefined;
                        coverage?: number | undefined;
                        value?: {
                            value: string;
                            weight: number;
                            name?: string | undefined;
                        }[] | undefined;
                    } | {
                        description: string;
                        id: string;
                        enabled: boolean;
                        type: "experiment-ref";
                        condition?: string | undefined;
                        variations: {
                            value: string;
                            variationId: string;
                        }[];
                        experimentId: string;
                    } | {
                        condition: string;
                        savedGroupTargeting?: {
                            matchType: "all" | "any" | "none";
                            savedGroups: string[];
                        }[] | undefined;
                        prerequisites?: {
                            /** Feature ID */
                            id: string;
                            condition: string;
                        }[] | undefined;
                        id: string;
                        trackingKey?: string | undefined;
                        enabled: boolean;
                        type: "safe-rollout";
                        controlValue: string;
                        variationValue: string;
                        seed?: string | undefined;
                        hashAttribute?: string | undefined;
                        safeRolloutId?: string | undefined;
                        status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                    })[];
                    /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                    definition?: string | undefined;
                    draft?: {
                        enabled: boolean;
                        defaultValue: string;
                        rules: ({
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "force";
                            value: string;
                        } | {
                            description: string;
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            id: string;
                            enabled: boolean;
                            type: "rollout";
                            value: string;
                            coverage: number;
                            hashAttribute: string;
                        } | {
                            description: string;
                            condition: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment";
                            trackingKey?: string | undefined;
                            hashAttribute?: string | undefined;
                            fallbackAttribute?: string | undefined;
                            disableStickyBucketing?: boolean | undefined;
                            bucketVersion?: number | undefined;
                            minBucketVersion?: number | undefined;
                            namespace?: {
                                enabled: boolean;
                                name: string;
                                range: number[];
                            } | undefined;
                            coverage?: number | undefined;
                            value?: {
                                value: string;
                                weight: number;
                                name?: string | undefined;
                            }[] | undefined;
                        } | {
                            description: string;
                            id: string;
                            enabled: boolean;
                            type: "experiment-ref";
                            condition?: string | undefined;
                            variations: {
                                value: string;
                                variationId: string;
                            }[];
                            experimentId: string;
                        } | {
                            condition: string;
                            savedGroupTargeting?: {
                                matchType: "all" | "any" | "none";
                                savedGroups: string[];
                            }[] | undefined;
                            prerequisites?: {
                                /** Feature ID */
                                id: string;
                                condition: string;
                            }[] | undefined;
                            id: string;
                            trackingKey?: string | undefined;
                            enabled: boolean;
                            type: "safe-rollout";
                            controlValue: string;
                            variationValue: string;
                            seed?: string | undefined;
                            hashAttribute?: string | undefined;
                            safeRolloutId?: string | undefined;
                            status?: ("running" | "released" | "rolled-back" | "stopped") | undefined;
                        })[];
                        /** A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model) */
                        definition?: string | undefined;
                    } | undefined;
                };
            };
            /** Feature IDs. Each feature must evaluate to `true` */
            prerequisites?: string[] | undefined;
            revision: {
                version: number;
                comment: string;
                date: string;
                publishedBy: string;
            };
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### feature.saferollout.ship

Triggered when a safe rollout is completed and safe to rollout to 100%.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.saferollout.ship";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            featureId: string;
            safeRolloutId: string;
            environment: string;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### feature.saferollout.rollback

Triggered when a safe rollout has a failing guardrail and should be reverted.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.saferollout.rollback";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            featureId: string;
            safeRolloutId: string;
            environment: string;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### feature.saferollout.unhealthy

Triggered when a safe rollout is failing a health check and may not be working as expected.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "feature.saferollout.unhealthy";
    object: "feature";
    api_version: string;
    created: number;
    data: {
        object: {
            featureId: string;
            safeRolloutId: string;
            environment: string;
            unhealthyReason: ("srm" | "multipleExposures")[];
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.created

Triggered when an experiment is created

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.created";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            trackingKey: string;
            dateCreated: string;
            dateUpdated: string;
            name: string;
            type: "standard" | "multi-armed-bandit";
            project: string;
            hypothesis: string;
            description: string;
            tags: string[];
            owner: string;
            archived: boolean;
            status: string;
            autoRefresh: boolean;
            hashAttribute: string;
            fallbackAttribute?: string | undefined;
            hashVersion: 1 | 2;
            disableStickyBucketing?: boolean | undefined;
            bucketVersion?: number | undefined;
            minBucketVersion?: number | undefined;
            variations: {
                variationId: string;
                key: string;
                name: string;
                description: string;
                screenshots: string[];
            }[];
            phases: {
                name: string;
                dateStarted: string;
                dateEnded: string;
                reasonForStopping: string;
                seed: string;
                coverage: number;
                trafficSplit: {
                    variationId: string;
                    weight: number;
                }[];
                namespace?: {
                    namespaceId: string;
                    range: any[];
                } | undefined;
                targetingCondition: string;
                prerequisites?: {
                    id: string;
                    condition: string;
                }[] | undefined;
                savedGroupTargeting?: {
                    matchType: "all" | "any" | "none";
                    savedGroups: string[];
                }[] | undefined;
            }[];
            settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                inProgressConversions: "include" | "exclude";
                /** Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. */
                attributionModel: "firstExposure" | "experimentDuration";
                statsEngine: "bayesian" | "frequentist";
                regressionAdjustmentEnabled?: boolean | undefined;
                sequentialTestingEnabled?: boolean | undefined;
                sequentialTestingTuningParameter?: number | undefined;
                goals: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                secondaryMetrics: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                guardrails: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                activationMetric?: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                } | undefined;
            };
            resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
            } | undefined;
            shareLevel?: ("public" | "organization") | undefined;
            publicUrl?: string | undefined;
            banditScheduleValue?: number | undefined;
            banditScheduleUnit?: ("days" | "hours") | undefined;
            banditBurnInValue?: number | undefined;
            banditBurnInUnit?: ("days" | "hours") | undefined;
            linkedFeatures?: string[] | undefined;
            hasVisualChangesets?: boolean | undefined;
            hasURLRedirects?: boolean | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.updated

Triggered when an experiment is updated

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.updated";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            trackingKey: string;
            dateCreated: string;
            dateUpdated: string;
            name: string;
            type: "standard" | "multi-armed-bandit";
            project: string;
            hypothesis: string;
            description: string;
            tags: string[];
            owner: string;
            archived: boolean;
            status: string;
            autoRefresh: boolean;
            hashAttribute: string;
            fallbackAttribute?: string | undefined;
            hashVersion: 1 | 2;
            disableStickyBucketing?: boolean | undefined;
            bucketVersion?: number | undefined;
            minBucketVersion?: number | undefined;
            variations: {
                variationId: string;
                key: string;
                name: string;
                description: string;
                screenshots: string[];
            }[];
            phases: {
                name: string;
                dateStarted: string;
                dateEnded: string;
                reasonForStopping: string;
                seed: string;
                coverage: number;
                trafficSplit: {
                    variationId: string;
                    weight: number;
                }[];
                namespace?: {
                    namespaceId: string;
                    range: any[];
                } | undefined;
                targetingCondition: string;
                prerequisites?: {
                    id: string;
                    condition: string;
                }[] | undefined;
                savedGroupTargeting?: {
                    matchType: "all" | "any" | "none";
                    savedGroups: string[];
                }[] | undefined;
            }[];
            settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                inProgressConversions: "include" | "exclude";
                /** Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. */
                attributionModel: "firstExposure" | "experimentDuration";
                statsEngine: "bayesian" | "frequentist";
                regressionAdjustmentEnabled?: boolean | undefined;
                sequentialTestingEnabled?: boolean | undefined;
                sequentialTestingTuningParameter?: number | undefined;
                goals: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                secondaryMetrics: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                guardrails: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                activationMetric?: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                } | undefined;
            };
            resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
            } | undefined;
            shareLevel?: ("public" | "organization") | undefined;
            publicUrl?: string | undefined;
            banditScheduleValue?: number | undefined;
            banditScheduleUnit?: ("days" | "hours") | undefined;
            banditBurnInValue?: number | undefined;
            banditBurnInUnit?: ("days" | "hours") | undefined;
            linkedFeatures?: string[] | undefined;
            hasVisualChangesets?: boolean | undefined;
            hasURLRedirects?: boolean | undefined;
        };
        previous_attributes: {
            id?: string | undefined;
            trackingKey?: string | undefined;
            dateCreated?: string | undefined;
            dateUpdated?: string | undefined;
            name?: string | undefined;
            type?: ("standard" | "multi-armed-bandit") | undefined;
            project?: string | undefined;
            hypothesis?: string | undefined;
            description?: string | undefined;
            tags?: string[] | undefined;
            owner?: string | undefined;
            archived?: boolean | undefined;
            status?: string | undefined;
            autoRefresh?: boolean | undefined;
            hashAttribute?: string | undefined;
            fallbackAttribute?: (string | undefined) | undefined;
            hashVersion?: (1 | 2) | undefined;
            disableStickyBucketing?: (boolean | undefined) | undefined;
            bucketVersion?: (number | undefined) | undefined;
            minBucketVersion?: (number | undefined) | undefined;
            variations?: {
                variationId: string;
                key: string;
                name: string;
                description: string;
                screenshots: string[];
            }[] | undefined;
            phases?: {
                name: string;
                dateStarted: string;
                dateEnded: string;
                reasonForStopping: string;
                seed: string;
                coverage: number;
                trafficSplit: {
                    variationId: string;
                    weight: number;
                }[];
                namespace?: {
                    namespaceId: string;
                    range: any[];
                } | undefined;
                targetingCondition: string;
                prerequisites?: {
                    id: string;
                    condition: string;
                }[] | undefined;
                savedGroupTargeting?: {
                    matchType: "all" | "any" | "none";
                    savedGroups: string[];
                }[] | undefined;
            }[] | undefined;
            settings?: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                inProgressConversions: "include" | "exclude";
                /** Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. */
                attributionModel: "firstExposure" | "experimentDuration";
                statsEngine: "bayesian" | "frequentist";
                regressionAdjustmentEnabled?: boolean | undefined;
                sequentialTestingEnabled?: boolean | undefined;
                sequentialTestingTuningParameter?: number | undefined;
                goals: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                secondaryMetrics: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                guardrails: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                activationMetric?: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                } | undefined;
            } | undefined;
            resultSummary?: ({
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
            } | undefined) | undefined;
            shareLevel?: (("public" | "organization") | undefined) | undefined;
            publicUrl?: (string | undefined) | undefined;
            banditScheduleValue?: (number | undefined) | undefined;
            banditScheduleUnit?: (("days" | "hours") | undefined) | undefined;
            banditBurnInValue?: (number | undefined) | undefined;
            banditBurnInUnit?: (("days" | "hours") | undefined) | undefined;
            linkedFeatures?: (string[] | undefined) | undefined;
            hasVisualChangesets?: (boolean | undefined) | undefined;
            hasURLRedirects?: (boolean | undefined) | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.deleted

Triggered when an experiment is deleted

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.deleted";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            id: string;
            trackingKey: string;
            dateCreated: string;
            dateUpdated: string;
            name: string;
            type: "standard" | "multi-armed-bandit";
            project: string;
            hypothesis: string;
            description: string;
            tags: string[];
            owner: string;
            archived: boolean;
            status: string;
            autoRefresh: boolean;
            hashAttribute: string;
            fallbackAttribute?: string | undefined;
            hashVersion: 1 | 2;
            disableStickyBucketing?: boolean | undefined;
            bucketVersion?: number | undefined;
            minBucketVersion?: number | undefined;
            variations: {
                variationId: string;
                key: string;
                name: string;
                description: string;
                screenshots: string[];
            }[];
            phases: {
                name: string;
                dateStarted: string;
                dateEnded: string;
                reasonForStopping: string;
                seed: string;
                coverage: number;
                trafficSplit: {
                    variationId: string;
                    weight: number;
                }[];
                namespace?: {
                    namespaceId: string;
                    range: any[];
                } | undefined;
                targetingCondition: string;
                prerequisites?: {
                    id: string;
                    condition: string;
                }[] | undefined;
                savedGroupTargeting?: {
                    matchType: "all" | "any" | "none";
                    savedGroups: string[];
                }[] | undefined;
            }[];
            settings: {
                datasourceId: string;
                assignmentQueryId: string;
                experimentId: string;
                segmentId: string;
                queryFilter: string;
                inProgressConversions: "include" | "exclude";
                /** Setting attribution model to `"experimentDuration"` is the same as selecting "Ignore Conversion Windows" for the Conversion Window Override. */
                attributionModel: "firstExposure" | "experimentDuration";
                statsEngine: "bayesian" | "frequentist";
                regressionAdjustmentEnabled?: boolean | undefined;
                sequentialTestingEnabled?: boolean | undefined;
                sequentialTestingTuningParameter?: number | undefined;
                goals: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                secondaryMetrics: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                guardrails: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                }[];
                activationMetric?: {
                    metricId: string;
                    overrides: {
                        delayHours?: number | undefined;
                        windowHours?: number | undefined;
                        window?: ("conversion" | "lookback" | "") | undefined;
                        winRiskThreshold?: number | undefined;
                        loseRiskThreshold?: number | undefined;
                    };
                } | undefined;
            };
            resultSummary?: {
                status: string;
                winner: string;
                conclusions: string;
                releasedVariationId: string;
                excludeFromPayload: boolean;
            } | undefined;
            shareLevel?: ("public" | "organization") | undefined;
            publicUrl?: string | undefined;
            banditScheduleValue?: number | undefined;
            banditScheduleUnit?: ("days" | "hours") | undefined;
            banditBurnInValue?: number | undefined;
            banditBurnInUnit?: ("days" | "hours") | undefined;
            linkedFeatures?: string[] | undefined;
            hasVisualChangesets?: boolean | undefined;
            hasURLRedirects?: boolean | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.warning

Triggered when a warning condition is detected on an experiment

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.warning";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            type: "auto-update";
            success: boolean;
            experimentName: string;
            experimentId: string;
        } | {
            type: "multiple-exposures";
            experimentName: string;
            experimentId: string;
            usersCount: number;
            percent: number;
        } | {
            type: "srm";
            experimentName: string;
            experimentId: string;
            threshold: number;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.info.significance

Triggered when a goal or guardrail metric reaches significance in an experiment (e.g. either above 95% or below 5% chance to win). Be careful using this without Sequential Testing as it can lead to peeking problems.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.info.significance";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            experimentName: string;
            experimentId: string;
            variationId: string;
            variationName: string;
            metricName: string;
            metricId: string;
            statsEngine: string;
            criticalValue: number;
            winning: boolean;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.decision.ship

Triggered when an experiment is ready to ship a variation.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.decision.ship";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            experimentName: string;
            experimentId: string;
            decisionDescription?: string | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.decision.rollback

Triggered when an experiment should be rolled back to the control.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.decision.rollback";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            experimentName: string;
            experimentId: string;
            decisionDescription?: string | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### experiment.decision.review

Triggered when an experiment has reached the desired power point, but the results may be ambiguous.

<details>
  <summary>Payload</summary>

```typescript
{
    event: "experiment.decision.review";
    object: "experiment";
    api_version: string;
    created: number;
    data: {
        object: {
            experimentName: string;
            experimentId: string;
            decisionDescription?: string | undefined;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>


### user.login

Triggered when a user logs in

<details>
  <summary>Payload</summary>

```typescript
{
    event: "user.login";
    object: "user";
    api_version: string;
    created: number;
    data: {
        object: {
            email: string;
            id: string;
            name: string;
            ip: string;
            userAgent: string;
            os: string;
            device: string;
        };
    };
    user: {
        type: "dashboard";
        id: string;
        email: string;
        name: string;
    } | {
        type: "api_key";
        apiKey: string;
    } | null;
    tags: string[];
    environments: string[];
    containsSecrets: boolean;
}
```
</details>

