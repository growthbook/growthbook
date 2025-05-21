/* eslint-disable */
/**
* This file was auto-generated. DO NOT MODIFY DIRECTLY
* Instead, modify the source OpenAPI schema in back-end/src/api/openapi
* and run `yarn generate-api-types` to re-generate this file.
*/
import { z } from "zod";

export const apiPaginationFieldsValidator = z.object({ "limit": z.coerce.number().int(), "offset": z.coerce.number().int(), "count": z.coerce.number().int(), "total": z.coerce.number().int(), "hasMore": z.boolean(), "nextOffset": z.union([z.coerce.number().int(), z.null()]) }).strict()

export const apiDimensionValidator = z.object({ "id": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "owner": z.string(), "datasourceId": z.string(), "identifierType": z.string(), "name": z.string(), "query": z.string() }).strict()

export const apiMetricValidator = z.object({ "id": z.string(), "managedBy": z.enum(["","api","config"]).describe("Where this metric must be managed from. If not set (empty string), it can be managed from anywhere."), "dateCreated": z.string(), "dateUpdated": z.string(), "owner": z.string(), "datasourceId": z.string(), "name": z.string(), "description": z.string(), "type": z.enum(["binomial","count","duration","revenue"]), "tags": z.array(z.string()), "projects": z.array(z.string()), "archived": z.boolean(), "behavior": z.object({ "goal": z.enum(["increase","decrease"]), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]), "value": z.coerce.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "cap": z.coerce.number().optional(), "capping": z.enum(["absolute","percentile"]).nullable().optional(), "capValue": z.coerce.number().optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.coerce.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.coerce.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric"), "priorSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used instead of the other settings in this object"), "proper": z.boolean().describe("If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior."), "mean": z.coerce.number().describe("The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)"), "stddev": z.coerce.number().describe("Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.") }).describe("Controls the bayesian prior for the metric.").optional(), "conversionWindowStart": z.coerce.number().optional(), "conversionWindowEnd": z.coerce.number().optional(), "riskThresholdSuccess": z.coerce.number(), "riskThresholdDanger": z.coerce.number(), "minPercentChange": z.coerce.number(), "maxPercentChange": z.coerce.number(), "minSampleSize": z.coerce.number() }), "sql": z.object({ "identifierTypes": z.array(z.string()), "conversionSQL": z.string(), "userAggregationSQL": z.string(), "denominatorMetricId": z.string() }).optional(), "sqlBuilder": z.object({ "identifierTypeColumns": z.array(z.object({ "identifierType": z.string(), "columnName": z.string() })), "tableName": z.string(), "valueColumnName": z.string(), "timestampColumnName": z.string(), "conditions": z.array(z.object({ "column": z.string(), "operator": z.string(), "value": z.string() })) }).optional(), "mixpanel": z.object({ "eventName": z.string(), "eventValue": z.string(), "userAggregation": z.string(), "conditions": z.array(z.object({ "property": z.string(), "operator": z.string(), "value": z.string() })) }).optional() }).strict()

export const apiProjectValidator = z.object({ "id": z.string(), "name": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "description": z.string().optional(), "settings": z.object({ "statsEngine": z.string().optional() }).optional() }).strict()

export const apiEnvironmentValidator = z.object({ "id": z.string(), "description": z.string(), "toggleOnList": z.boolean(), "defaultState": z.boolean(), "projects": z.array(z.string()) }).strict()

export const apiSegmentValidator = z.object({ "id": z.string(), "owner": z.string(), "datasourceId": z.string(), "identifierType": z.string(), "name": z.string(), "query": z.string().optional(), "dateCreated": z.string(), "dateUpdated": z.string(), "type": z.enum(["SQL","FACT"]).optional(), "factTableId": z.string().optional(), "filters": z.array(z.string()).optional() }).strict()

export const apiFeatureValidator = z.object({ "id": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "archived": z.boolean(), "description": z.string(), "owner": z.string(), "project": z.string(), "valueType": z.enum(["boolean","string","number","json"]), "defaultValue": z.string(), "tags": z.array(z.string()), "environments": z.record(z.object({ "enabled": z.boolean(), "defaultValue": z.string(), "rules": z.array(z.union([z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }), z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional(), "draft": z.object({ "enabled": z.boolean(), "defaultValue": z.string(), "rules": z.array(z.union([z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }), z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional() }).optional() })), "prerequisites": z.array(z.object({ "parentId": z.string(), "parentCondition": z.string() })).optional(), "revision": z.object({ "version": z.coerce.number().int(), "comment": z.string(), "date": z.string(), "publishedBy": z.string() }), "draftRevision": z.object({ "version": z.coerce.number().int(), "date": z.string(), "createdBy": z.string(), "createdByEmail": z.string() }).nullable().optional() }).strict()

export const apiFeatureEnvironmentValidator = z.object({ "enabled": z.boolean(), "defaultValue": z.string(), "rules": z.array(z.union([z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }), z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional(), "draft": z.object({ "enabled": z.boolean(), "defaultValue": z.string(), "rules": z.array(z.union([z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }), z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional() }).optional() }).strict()

export const apiFeatureRuleValidator = z.union([z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }), z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }), z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])

export const apiFeatureDefinitionValidator = z.object({ "defaultValue": z.union([z.string(), z.coerce.number(), z.array(z.any()), z.record(z.any()), z.null()]), "rules": z.array(z.object({ "force": z.union([z.string(), z.coerce.number(), z.array(z.any()), z.record(z.any()), z.null()]).optional(), "weights": z.array(z.any()).optional(), "variations": z.array(z.union([z.string(), z.coerce.number(), z.array(z.any()), z.record(z.any()), z.null()])).optional(), "hashAttribute": z.string().optional(), "namespace": z.array(z.union([z.coerce.number(), z.string()])).min(3).max(3).optional(), "key": z.string().optional(), "coverage": z.coerce.number().optional(), "condition": z.record(z.any()).optional() })).optional() }).strict()

export const apiFeatureForceRuleValidator = z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("force"), "value": z.string() }).strict()

export const apiFeatureRolloutRuleValidator = z.object({ "description": z.string(), "condition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.coerce.number(), "hashAttribute": z.string() }).strict()

export const apiFeatureExperimentRuleValidator = z.object({ "description": z.string(), "condition": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment"), "trackingKey": z.string().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "namespace": z.any().optional(), "coverage": z.coerce.number().optional(), "value": z.array(z.object({ "value": z.string(), "weight": z.coerce.number(), "name": z.string().optional() })).optional() }).strict()

export const apiFeatureExperimentRefRuleValidator = z.object({ "description": z.string(), "id": z.string(), "enabled": z.boolean(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() }).strict()

export const apiSdkConnectionValidator = z.object({ "id": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "name": z.string(), "organization": z.string(), "languages": z.array(z.string()), "sdkVersion": z.string().optional(), "environment": z.string(), "project": z.string().describe("Use 'projects' instead. This is only for backwards compatibility and contains the first project only."), "projects": z.array(z.string()).optional(), "encryptPayload": z.boolean(), "encryptionKey": z.string(), "includeVisualExperiments": z.boolean().optional(), "includeDraftExperiments": z.boolean().optional(), "includeExperimentNames": z.boolean().optional(), "includeRedirectExperiments": z.boolean().optional(), "key": z.string(), "proxyEnabled": z.boolean(), "proxyHost": z.string(), "proxySigningKey": z.string(), "sseEnabled": z.boolean().optional(), "hashSecureAttributes": z.boolean().optional(), "remoteEvalEnabled": z.boolean().optional(), "savedGroupReferencesEnabled": z.boolean().optional() }).strict()

export const apiExperimentValidator = z.object({ "id": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "name": z.string(), "project": z.string(), "hypothesis": z.string(), "description": z.string(), "tags": z.array(z.string()), "owner": z.string(), "archived": z.boolean(), "status": z.string(), "autoRefresh": z.boolean(), "hashAttribute": z.string(), "fallbackAttribute": z.string().optional(), "hashVersion": z.union([z.literal(1), z.literal(2)]), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.coerce.number().optional(), "minBucketVersion": z.coerce.number().optional(), "variations": z.array(z.object({ "variationId": z.string(), "key": z.string(), "name": z.string(), "description": z.string(), "screenshots": z.array(z.string()) })), "phases": z.array(z.object({ "name": z.string(), "dateStarted": z.string(), "dateEnded": z.string(), "reasonForStopping": z.string(), "seed": z.string(), "coverage": z.coerce.number(), "trafficSplit": z.array(z.object({ "variationId": z.string(), "weight": z.coerce.number() })), "namespace": z.object({ "namespaceId": z.string(), "range": z.array(z.any()) }).optional(), "targetingCondition": z.string(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional() })), "settings": z.object({ "datasourceId": z.string(), "assignmentQueryId": z.string(), "experimentId": z.string(), "segmentId": z.string(), "queryFilter": z.string(), "inProgressConversions": z.enum(["include","exclude"]), "attributionModel": z.enum(["firstExposure","experimentDuration"]), "statsEngine": z.enum(["bayesian","frequentist"]), "regressionAdjustmentEnabled": z.boolean().optional(), "goals": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "secondaryMetrics": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "guardrails": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "activationMetric": z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) }).optional() }), "resultSummary": z.object({ "status": z.string(), "winner": z.string(), "conclusions": z.string(), "releasedVariationId": z.string(), "excludeFromPayload": z.boolean() }).optional() }).strict()

export const apiExperimentMetricValidator = z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) }).strict()

export const apiExperimentAnalysisSettingsValidator = z.object({ "datasourceId": z.string(), "assignmentQueryId": z.string(), "experimentId": z.string(), "segmentId": z.string(), "queryFilter": z.string(), "inProgressConversions": z.enum(["include","exclude"]), "attributionModel": z.enum(["firstExposure","experimentDuration"]), "statsEngine": z.enum(["bayesian","frequentist"]), "regressionAdjustmentEnabled": z.boolean().optional(), "goals": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "secondaryMetrics": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "guardrails": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "activationMetric": z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) }).optional() }).strict()

export const apiExperimentResultsValidator = z.object({ "id": z.string(), "dateUpdated": z.string(), "experimentId": z.string(), "phase": z.string(), "dateStart": z.string(), "dateEnd": z.string(), "dimension": z.object({ "type": z.string(), "id": z.string().optional() }), "settings": z.object({ "datasourceId": z.string(), "assignmentQueryId": z.string(), "experimentId": z.string(), "segmentId": z.string(), "queryFilter": z.string(), "inProgressConversions": z.enum(["include","exclude"]), "attributionModel": z.enum(["firstExposure","experimentDuration"]), "statsEngine": z.enum(["bayesian","frequentist"]), "regressionAdjustmentEnabled": z.boolean().optional(), "goals": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "secondaryMetrics": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "guardrails": z.array(z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) })), "activationMetric": z.object({ "metricId": z.string(), "overrides": z.object({ "delayHours": z.coerce.number().optional(), "windowHours": z.coerce.number().optional(), "window": z.enum(["conversion","lookback",""]).optional(), "winRiskThreshold": z.coerce.number().optional(), "loseRiskThreshold": z.coerce.number().optional() }) }).optional() }), "queryIds": z.array(z.string()), "results": z.array(z.object({ "dimension": z.string(), "totalUsers": z.coerce.number(), "checks": z.object({ "srm": z.coerce.number() }), "metrics": z.array(z.object({ "metricId": z.string(), "variations": z.array(z.object({ "variationId": z.string(), "users": z.coerce.number().optional(), "analyses": z.array(z.object({ "engine": z.enum(["bayesian","frequentist"]), "numerator": z.coerce.number(), "denominator": z.coerce.number(), "mean": z.coerce.number(), "stddev": z.coerce.number(), "percentChange": z.coerce.number(), "ciLow": z.coerce.number(), "ciHigh": z.coerce.number(), "pValue": z.coerce.number().optional(), "risk": z.coerce.number().optional(), "chanceToBeatControl": z.coerce.number().optional() })) })) })) })) }).strict()

export const apiDataSourceValidator = z.object({ "id": z.string(), "dateCreated": z.string(), "dateUpdated": z.string(), "type": z.string(), "name": z.string(), "description": z.string(), "projectIds": z.array(z.string()), "eventTracker": z.string(), "identifierTypes": z.array(z.object({ "id": z.string(), "description": z.string() })), "assignmentQueries": z.array(z.object({ "id": z.string(), "name": z.string(), "description": z.string(), "identifierType": z.string(), "sql": z.string(), "includesNameColumns": z.boolean(), "dimensionColumns": z.array(z.string()) })), "identifierJoinQueries": z.array(z.object({ "identifierTypes": z.array(z.string()), "sql": z.string() })), "mixpanelSettings": z.object({ "viewedExperimentEventName": z.string(), "experimentIdProperty": z.string(), "variationIdProperty": z.string(), "extraUserIdProperty": z.string() }).optional() }).strict()

export const apiVisualChangesetValidator = z.object({ "id": z.string().optional(), "urlPatterns": z.array(z.object({ "include": z.boolean().optional(), "type": z.enum(["simple","regex"]), "pattern": z.string() })), "editorUrl": z.string(), "experiment": z.string(), "visualChanges": z.array(z.object({ "description": z.string().optional(), "css": z.string().optional(), "js": z.string().optional(), "variation": z.string(), "domMutations": z.array(z.object({ "selector": z.string(), "action": z.enum(["append","set","remove"]), "attribute": z.string(), "value": z.string().optional(), "parentSelector": z.string().optional(), "insertBeforeSelector": z.string().optional() })) })) }).strict()

export const apiVisualChangeValidator = z.object({ "description": z.string().optional(), "css": z.string().optional(), "js": z.string().optional(), "variation": z.string(), "domMutations": z.array(z.object({ "selector": z.string(), "action": z.enum(["append","set","remove"]), "attribute": z.string(), "value": z.string().optional(), "parentSelector": z.string().optional(), "insertBeforeSelector": z.string().optional() })).optional() }).strict()

export const apiSavedGroupValidator = z.object({ "id": z.string(), "type": z.enum(["condition","list"]), "dateCreated": z.string(), "dateUpdated": z.string(), "name": z.string(), "owner": z.string().optional(), "condition": z.string().describe("When type = 'condition', this is the JSON-encoded condition for the group").optional(), "attributeKey": z.string().describe("When type = 'list', this is the attribute key the group is based on").optional(), "values": z.array(z.string()).describe("When type = 'list', this is the list of values for the attribute key").optional(), "description": z.string().optional(), "passByReferenceOnly": z.boolean().describe("Whether the saved group must be referenced by ID rather than its list of items for performance reasons").optional() }).strict()

export const apiOrganizationValidator = z.object({ "id": z.string().describe("The Growthbook unique identifier for the organization").optional(), "externalId": z.string().describe("An optional identifier that you use within your company for the organization").optional(), "dateCreated": z.string().describe("The date the organization was created").optional(), "name": z.string().describe("The name of the organization").optional(), "ownerEmail": z.string().describe("The email address of the organization owner").optional() }).strict()

export const apiFactTableValidator = z.object({ "id": z.string(), "name": z.string(), "description": z.string(), "owner": z.string(), "projects": z.array(z.string()), "tags": z.array(z.string()), "datasource": z.string(), "userIdTypes": z.array(z.string()), "sql": z.string(), "managedBy": z.enum(["","api"]).describe("Where this fact table must be managed from. If not set (empty string), it can be managed from anywhere."), "dateCreated": z.string(), "dateUpdated": z.string() }).strict()

export const apiFactTableFilterValidator = z.object({ "id": z.string(), "name": z.string(), "description": z.string(), "value": z.string(), "managedBy": z.enum(["","api"]).describe("Where this fact table filter must be managed from. If not set (empty string), it can be managed from anywhere."), "dateCreated": z.string(), "dateUpdated": z.string() }).strict()

export const apiFactMetricValidator = z.object({ "id": z.string(), "name": z.string(), "description": z.string(), "owner": z.string(), "projects": z.array(z.string()), "tags": z.array(z.string()), "datasource": z.string(), "metricType": z.enum(["proportion","mean","quantile","ratio"]), "numerator": z.object({ "factTableId": z.string(), "column": z.string(), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids") }), "denominator": z.object({ "factTableId": z.string(), "column": z.string(), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids") }).optional(), "inverse": z.boolean().describe("Set to true for things like Bounce Rate, where you want the metric to decrease"), "quantileSettings": z.object({ "type": z.enum(["event","unit"]).describe("Whether the quantile is over unit aggregations or raw event values"), "ignoreZeros": z.boolean().describe("If true, zero values will be ignored when calculating the quantile"), "quantile": z.coerce.number().multipleOf(0.001).gte(0.001).lte(0.999).describe("The quantile value (from 0.001 to 0.999)") }).describe("Controls the settings for quantile metrics (mandatory if metricType is \"quantile\")").optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]), "value": z.coerce.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled"), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.coerce.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.coerce.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric"), "regressionAdjustmentSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used"), "enabled": z.boolean().describe("Controls whether or not regresion adjustment is applied to the metric").optional(), "days": z.coerce.number().describe("Number of pre-exposure days to use for the regression adjustment").optional() }).describe("Controls the regression adjustment (CUPED) settings for the metric"), "riskThresholdSuccess": z.coerce.number(), "riskThresholdDanger": z.coerce.number(), "minPercentChange": z.coerce.number(), "maxPercentChange": z.coerce.number(), "minSampleSize": z.coerce.number(), "managedBy": z.enum(["","api"]).describe("Where this fact metric must be managed from. If not set (empty string), it can be managed from anywhere."), "dateCreated": z.string(), "dateUpdated": z.string() }).strict()

export const apiMemberValidator = z.object({ "id": z.string(), "name": z.string().optional(), "email": z.string(), "globalRole": z.string(), "environments": z.array(z.string()).optional(), "limitAccessByEnvironment": z.boolean().optional(), "managedbyIdp": z.boolean().optional(), "teams": z.array(z.string()).optional(), "projectRoles": z.array(z.object({ "project": z.string(), "role": z.string(), "limitAccessByEnvironment": z.boolean(), "environments": z.array(z.string()) })).optional(), "lastLoginDate": z.string().optional(), "dateCreated": z.string().optional(), "dateUpdated": z.string().optional() }).strict()

export const listFeaturesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "projectId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postFeatureValidator = {
  bodySchema: z.object({ "id": z.string().min(1).describe("A unique key name for the feature. Feature keys can only include letters, numbers, hyphens, and underscores."), "archived": z.boolean().optional(), "description": z.string().describe("Description of the feature").optional(), "owner": z.string().describe("Email of the person who owns this experiment"), "project": z.string().describe("An associated project ID").optional(), "valueType": z.enum(["boolean","string","number","json"]).describe("The data type of the feature payload. Boolean by default."), "defaultValue": z.string().describe("Default value when feature is enabled. Type must match `valueType`."), "tags": z.array(z.string()).describe("List of associated tags").optional(), "environments": z.record(z.object({ "enabled": z.boolean(), "rules": z.array(z.union([z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.number().describe("Percent of traffic included in this experiment. Users not included in the experiment will skip this rule."), "hashAttribute": z.string() }), z.object({ "description": z.string().optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional(), "draft": z.object({ "enabled": z.boolean().optional(), "rules": z.array(z.union([z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.number().describe("Percent of traffic included in this experiment. Users not included in the experiment will skip this rule."), "hashAttribute": z.string() }), z.object({ "description": z.string().optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional() }).describe("Use to write draft changes without publishing them.").optional() })).describe("A dictionary of environments that are enabled for this feature. Keys supply the names of environments. Environments belong to organization and are not specified will be disabled by default.").optional(), "jsonSchema": z.string().describe("Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getFeatureValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateFeatureValidator = {
  bodySchema: z.object({ "description": z.string().describe("Description of the feature").optional(), "archived": z.boolean().optional(), "project": z.string().describe("An associated project ID").optional(), "owner": z.string().optional(), "defaultValue": z.string().optional(), "tags": z.array(z.string()).describe("List of associated tags. Will override tags completely with submitted list").optional(), "environments": z.record(z.object({ "enabled": z.boolean(), "rules": z.array(z.union([z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.number().describe("Percent of traffic included in this experiment. Users not included in the experiment will skip this rule."), "hashAttribute": z.string() }), z.object({ "description": z.string().optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional(), "draft": z.object({ "enabled": z.boolean().optional(), "rules": z.array(z.union([z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("force"), "value": z.string() }), z.object({ "description": z.string().optional(), "condition": z.string().describe("Applied to everyone by default.").optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("rollout"), "value": z.string(), "coverage": z.number().describe("Percent of traffic included in this experiment. Users not included in the experiment will skip this rule."), "hashAttribute": z.string() }), z.object({ "description": z.string().optional(), "id": z.string().optional(), "enabled": z.boolean().describe("Enabled by default").optional(), "type": z.literal("experiment-ref"), "condition": z.string().optional(), "variations": z.array(z.object({ "value": z.string(), "variationId": z.string() })), "experimentId": z.string() })])), "definition": z.string().describe("A JSON stringified [FeatureDefinition](#tag/FeatureDefinition_model)").optional() }).describe("Use to write draft changes without publishing them.").optional() })).optional(), "jsonSchema": z.string().describe("Use JSON schema to validate the payload of a JSON-type feature value (enterprise only).").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const toggleFeatureValidator = {
  bodySchema: z.object({ "reason": z.string().optional(), "environments": z.record(z.union([z.literal(true), z.literal(false), z.literal("true"), z.literal("false"), z.literal("1"), z.literal("0"), z.literal(1), z.literal(0), z.literal("")])) }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const getFeatureKeysValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "projectId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const listProjectsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0) }).strict(),
  paramsSchema: z.never(),
};

export const postProjectValidator = {
  bodySchema: z.object({ "name": z.string(), "description": z.string().optional(), "settings": z.object({ "statsEngine": z.string().describe("Stats engine.").optional() }).describe("Project settings.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getProjectValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const putProjectValidator = {
  bodySchema: z.object({ "name": z.string().describe("Project name.").optional(), "description": z.string().describe("Project description.").optional(), "settings": z.object({ "statsEngine": z.string().describe("Stats engine.").optional() }).describe("Project settings.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteProjectValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listDimensionsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "datasourceId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const getDimensionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listSegmentsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "datasourceId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const getSegmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listSdkConnectionsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "projectId": z.string().optional(), "withProxy": z.string().optional(), "multiOrg": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postSdkConnectionValidator = {
  bodySchema: z.object({ "name": z.string(), "language": z.string(), "sdkVersion": z.string().optional(), "environment": z.string(), "projects": z.array(z.string()).optional(), "encryptPayload": z.boolean().optional(), "includeVisualExperiments": z.boolean().optional(), "includeDraftExperiments": z.boolean().optional(), "includeExperimentNames": z.boolean().optional(), "includeRedirectExperiments": z.boolean().optional(), "proxyEnabled": z.boolean().optional(), "proxyHost": z.string().optional(), "hashSecureAttributes": z.boolean().optional(), "remoteEvalEnabled": z.boolean().optional(), "savedGroupReferencesEnabled": z.boolean().optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getSdkConnectionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const putSdkConnectionValidator = {
  bodySchema: z.object({ "name": z.string().optional(), "language": z.string().optional(), "sdkVersion": z.string().optional(), "environment": z.string().optional(), "projects": z.array(z.string()).optional(), "encryptPayload": z.boolean().optional(), "includeVisualExperiments": z.boolean().optional(), "includeDraftExperiments": z.boolean().optional(), "includeExperimentNames": z.boolean().optional(), "includeRedirectExperiments": z.boolean().optional(), "proxyEnabled": z.boolean().optional(), "proxyHost": z.string().optional(), "hashSecureAttributes": z.boolean().optional(), "remoteEvalEnabled": z.boolean().optional(), "savedGroupReferencesEnabled": z.boolean().optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteSdkConnectionValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listDataSourcesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "projectId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const getDataSourceValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listExperimentsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "projectId": z.string().optional(), "datasourceId": z.string().optional(), "experimentId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postExperimentValidator = {
  bodySchema: z.object({ "datasourceId": z.string().describe("ID for the [DataSource](#tag/DataSource_model)"), "assignmentQueryId": z.string().describe("The ID property of one of the assignment query objects associated with the datasource"), "trackingKey": z.string(), "name": z.string().describe("Name of the experiment"), "project": z.string().describe("Project ID which the experiment belongs to").optional(), "hypothesis": z.string().describe("Hypothesis of the experiment").optional(), "description": z.string().describe("Description of the experiment").optional(), "tags": z.array(z.string()).optional(), "metrics": z.array(z.string()).optional(), "secondaryMetrics": z.array(z.string()).optional(), "guardrailMetrics": z.array(z.string()).optional(), "owner": z.string().describe("Email of the person who owns this experiment").optional(), "archived": z.boolean().optional(), "status": z.enum(["draft","running","stopped"]).optional(), "autoRefresh": z.boolean().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "hashVersion": z.union([z.literal(1), z.literal(2)]).optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.number().optional(), "minBucketVersion": z.number().optional(), "releasedVariationId": z.string().optional(), "excludeFromPayload": z.boolean().optional(), "inProgressConversions": z.enum(["loose","strict"]).optional(), "attributionModel": z.enum(["firstExposure","experimentDuration"]).optional(), "statsEngine": z.enum(["bayesian","frequentist"]).optional(), "variations": z.array(z.object({ "id": z.string().optional(), "key": z.string(), "name": z.string(), "description": z.string().optional(), "screenshots": z.array(z.object({ "path": z.string(), "width": z.number().optional(), "height": z.number().optional(), "description": z.string().optional() })).optional() })).min(2), "phases": z.array(z.object({ "name": z.string(), "dateStarted": z.string(), "dateEnded": z.string().optional(), "reasonForStopping": z.string().optional(), "seed": z.string().optional(), "coverage": z.number().optional(), "trafficSplit": z.array(z.object({ "variationId": z.string(), "weight": z.number() })).optional(), "namespace": z.object({ "namespaceId": z.string(), "range": z.array(z.number()).min(2).max(2), "enabled": z.boolean().optional() }).optional(), "targetingCondition": z.string().optional(), "reason": z.string().optional(), "condition": z.string().optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "variationWeights": z.array(z.number()).optional() })).optional(), "regressionAdjustmentEnabled": z.boolean().describe("Controls whether regression adjustment (CUPED) is enabled for experiment analyses").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getExperimentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateExperimentValidator = {
  bodySchema: z.object({ "assignmentQueryId": z.string().optional(), "trackingKey": z.string().optional(), "name": z.string().describe("Name of the experiment").optional(), "project": z.string().describe("Project ID which the experiment belongs to").optional(), "hypothesis": z.string().describe("Hypothesis of the experiment").optional(), "description": z.string().describe("Description of the experiment").optional(), "tags": z.array(z.string()).optional(), "metrics": z.array(z.string()).optional(), "secondaryMetrics": z.array(z.string()).optional(), "guardrailMetrics": z.array(z.string()).optional(), "owner": z.string().describe("Email of the person who owns this experiment").optional(), "archived": z.boolean().optional(), "status": z.enum(["draft","running","stopped"]).optional(), "autoRefresh": z.boolean().optional(), "hashAttribute": z.string().optional(), "fallbackAttribute": z.string().optional(), "hashVersion": z.union([z.literal(1), z.literal(2)]).optional(), "disableStickyBucketing": z.any().optional(), "bucketVersion": z.number().optional(), "minBucketVersion": z.number().optional(), "releasedVariationId": z.string().optional(), "excludeFromPayload": z.boolean().optional(), "inProgressConversions": z.enum(["loose","strict"]).optional(), "attributionModel": z.enum(["firstExposure","experimentDuration"]).optional(), "statsEngine": z.enum(["bayesian","frequentist"]).optional(), "variations": z.array(z.object({ "id": z.string().optional(), "key": z.string(), "name": z.string(), "description": z.string().optional(), "screenshots": z.array(z.object({ "path": z.string(), "width": z.number().optional(), "height": z.number().optional(), "description": z.string().optional() })).optional() })).min(2).optional(), "phases": z.array(z.object({ "name": z.string(), "dateStarted": z.string(), "dateEnded": z.string().optional(), "reasonForStopping": z.string().optional(), "seed": z.string().optional(), "coverage": z.number().optional(), "trafficSplit": z.array(z.object({ "variationId": z.string(), "weight": z.number() })).optional(), "namespace": z.object({ "namespaceId": z.string(), "range": z.array(z.number()).min(2).max(2), "enabled": z.boolean().optional() }).optional(), "targetingCondition": z.string().optional(), "reason": z.string().optional(), "condition": z.string().optional(), "savedGroupTargeting": z.array(z.object({ "matchType": z.enum(["all","any","none"]), "savedGroups": z.array(z.string()) })).optional(), "variationWeights": z.array(z.number()).optional() })).optional(), "regressionAdjustmentEnabled": z.boolean().describe("Controls whether regression adjustment (CUPED) is enabled for experiment analyses").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const getExperimentResultsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "phase": z.string().optional(), "dimension": z.string().optional() }).strict(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "projectId": z.string().optional(), "datasourceId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postMetricValidator = {
  bodySchema: z.object({ "datasourceId": z.string().describe("ID for the [DataSource](#tag/DataSource_model)"), "managedBy": z.enum(["","api"]).describe("Where this metric must be managed from. If not set (empty string), it can be managed from anywhere.").optional(), "owner": z.string().describe("Name of the person who owns this metric").optional(), "name": z.string().describe("Name of the metric"), "description": z.string().describe("Description of the metric").optional(), "type": z.enum(["binomial","count","duration","revenue"]).describe("Type of metric. See [Metrics documentation](/app/metrics)"), "tags": z.array(z.string()).describe("List of tags").optional(), "projects": z.array(z.string()).describe("List of project IDs for projects that can access this metric").optional(), "archived": z.boolean().optional(), "behavior": z.object({ "goal": z.enum(["increase","decrease"]).optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]).nullable(), "value": z.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "cap": z.number().gte(0).describe("(deprecated, use cappingSettings instead) This should be non-negative").optional(), "capping": z.enum(["absolute","percentile"]).nullable().describe("(deprecated, use cappingSettings instead) Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.").optional(), "capValue": z.number().gte(0).describe("(deprecated, use cappingSettings instead) This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.").optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric").optional(), "conversionWindowStart": z.number().describe("The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(), "conversionWindowEnd": z.number().describe("The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(), "priorSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used instead of the other settings in this object"), "proper": z.boolean().describe("If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior."), "mean": z.number().describe("The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)"), "stddev": z.number().gt(0).describe("Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.") }).describe("Controls the bayesian prior for the metric. If omitted, organization defaults will be used.").optional(), "riskThresholdSuccess": z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(), "riskThresholdDanger": z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(), "minPercentChange": z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(), "maxPercentChange": z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(), "minSampleSize": z.number().gte(0).optional() }).optional(), "sql": z.object({ "identifierTypes": z.array(z.string()), "conversionSQL": z.string(), "userAggregationSQL": z.string().describe("Custom user level aggregation for your metric (default: `SUM(value)`)").optional(), "denominatorMetricId": z.string().describe("The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics)").optional() }).describe("Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional(), "sqlBuilder": z.object({ "identifierTypeColumns": z.array(z.object({ "identifierType": z.string(), "columnName": z.string() })), "tableName": z.string(), "valueColumnName": z.string().optional(), "timestampColumnName": z.string(), "conditions": z.array(z.object({ "column": z.string(), "operator": z.string(), "value": z.string() })).optional() }).describe("An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional(), "mixpanel": z.object({ "eventName": z.string(), "eventValue": z.string().optional(), "userAggregation": z.string(), "conditions": z.array(z.object({ "property": z.string(), "operator": z.string(), "value": z.string() })).optional() }).describe("Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed, and at least one must be specified.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const putMetricValidator = {
  bodySchema: z.object({ "managedBy": z.enum(["","api"]).describe("Where this metric must be managed from. If not set (empty string), it can be managed from anywhere.").optional(), "owner": z.string().describe("Name of the person who owns this metric").optional(), "name": z.string().describe("Name of the metric").optional(), "description": z.string().describe("Description of the metric").optional(), "type": z.enum(["binomial","count","duration","revenue"]).describe("Type of metric. See [Metrics documentation](/app/metrics)").optional(), "tags": z.array(z.string()).describe("List of tags").optional(), "projects": z.array(z.string()).describe("List of project IDs for projects that can access this metric").optional(), "archived": z.boolean().optional(), "behavior": z.object({ "goal": z.enum(["increase","decrease"]).optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]).nullable(), "value": z.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "cap": z.number().gte(0).describe("(deprecated, use cappingSettings instead) This should be non-negative").optional(), "capping": z.enum(["absolute","percentile"]).nullable().describe("(deprecated, use cappingSettings instead) Used in conjunction with `capValue` to set the capping (winsorization). Do not specify or set to null for no capping. \"absolute\" will cap user values at the `capValue` if it is greater than 0. \"percentile\" will cap user values at the percentile of user values in an experiment using the `capValue` for the percentile, if greater than 0. <br/>  If `behavior.capping` is non-null, you must specify `behavior.capValue`.").optional(), "capValue": z.number().gte(0).describe("(deprecated, use cappingSettings instead) This should be non-negative. <br/> Must specify `behavior.capping` when setting `behavior.capValue`.").optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric").optional(), "conversionWindowStart": z.number().describe("The start of a Conversion Window relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(), "conversionWindowEnd": z.number().describe("The end of a [Conversion Window](/app/metrics#conversion-window) relative to the exposure date, in hours. This is equivalent to the [Conversion Delay](/app/metrics#conversion-delay) + Conversion Window Hours settings in the UI. In other words, if you want a 48 hour window starting after 24 hours, you would set conversionWindowStart to 24 and conversionWindowEnd to 72 (24+48). <br/> Must specify both `behavior.conversionWindowStart` and `behavior.conversionWindowEnd` or neither.").optional(), "priorSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used instead of the other settings in this object"), "proper": z.boolean().describe("If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior."), "mean": z.number().describe("The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)"), "stddev": z.number().gt(0).describe("Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.") }).describe("Controls the bayesian prior for the metric. If omitted, organization defaults will be used.").optional(), "riskThresholdSuccess": z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(), "riskThresholdDanger": z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(), "minPercentChange": z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(), "maxPercentChange": z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(), "minSampleSize": z.number().gte(0).optional() }).optional(), "sql": z.object({ "identifierTypes": z.array(z.string()).optional(), "conversionSQL": z.string().optional(), "userAggregationSQL": z.string().describe("Custom user level aggregation for your metric (default: `SUM(value)`)").optional(), "denominatorMetricId": z.string().describe("The metric ID for a [denominator metric for funnel and ratio metrics](/app/metrics#denominator-ratio--funnel-metrics)").optional() }).describe("Preferred way to define SQL. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.").optional(), "sqlBuilder": z.object({ "identifierTypeColumns": z.array(z.object({ "identifierType": z.string(), "columnName": z.string() })).optional(), "tableName": z.string().optional(), "valueColumnName": z.string().optional(), "timestampColumnName": z.string().optional(), "conditions": z.array(z.object({ "column": z.string(), "operator": z.string(), "value": z.string() })).optional() }).describe("An alternative way to specify a SQL metric, rather than a full query. Using `sql` is preferred to `sqlBuilder`. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed").optional(), "mixpanel": z.object({ "eventName": z.string().optional(), "eventValue": z.string().optional(), "userAggregation": z.string().optional(), "conditions": z.array(z.object({ "property": z.string(), "operator": z.string(), "value": z.string() })).optional() }).describe("Only use for MixPanel (non-SQL) Data Sources. Only one of `sql`, `sqlBuilder` or `mixpanel` allowed.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listVisualChangesetsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const getVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "includeExperiment": z.coerce.number().int().optional() }).strict(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const putVisualChangesetValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const postVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const putVisualChangeValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string(), "visualChangeId": z.string() }).strict(),
};

export const listSavedGroupsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0) }).strict(),
  paramsSchema: z.never(),
};

export const postSavedGroupValidator = {
  bodySchema: z.object({ "name": z.string().describe("The display name of the Saved Group"), "type": z.enum(["condition","list"]).describe("The type of Saved Group (inferred from other arguments if missing)").optional(), "condition": z.string().describe("When type = 'condition', this is the JSON-encoded condition for the group").optional(), "attributeKey": z.string().describe("When type = 'list', this is the attribute key the group is based on").optional(), "values": z.array(z.string()).describe("When type = 'list', this is the list of values for the attribute key").optional(), "owner": z.string().describe("The person or team that owns this Saved Group. If no owner, you can pass an empty string.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateSavedGroupValidator = {
  bodySchema: z.object({ "name": z.string().describe("The display name of the Saved Group").optional(), "condition": z.string().describe("When type = 'condition', this is the JSON-encoded condition for the group").optional(), "values": z.array(z.string()).describe("When type = 'list', this is the list of values for the attribute key").optional(), "owner": z.string().describe("The person or team that owns this Saved Group. If no owner, you can pass an empty string.").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteSavedGroupValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listOrganizationsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "search": z.string().optional(), "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0) }).strict(),
  paramsSchema: z.never(),
};

export const postOrganizationValidator = {
  bodySchema: z.object({ "name": z.string().describe("The name of the organization"), "externalId": z.string().describe("An optional identifier that you use within your company for the organization").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const putOrganizationValidator = {
  bodySchema: z.object({ "name": z.string().describe("The name of the organization").optional(), "externalId": z.string().describe("An optional identifier that you use within your company for the organization").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listMembersValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "userName": z.string().optional(), "userEmail": z.string().optional(), "globalRole": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const deleteMemberValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateMemberRoleValidator = {
  bodySchema: z.object({ "member": z.object({ "role": z.string().optional(), "environments": z.array(z.string()).optional(), "projectRoles": z.array(z.object({ "project": z.string(), "role": z.string(), "environments": z.array(z.string()) })).optional() }) }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listEnvironmentsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const postEnvironmentValidator = {
  bodySchema: z.object({ "id": z.string().describe("The ID of the new environment"), "description": z.string().describe("The description of the new environment").optional(), "toggleOnList": z.any().describe("Show toggle on feature list").optional(), "defaultState": z.any().describe("Default state for new features").optional(), "projects": z.array(z.string()).optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const putEnvironmentValidator = {
  bodySchema: z.object({ "description": z.string().describe("The description of the new environment").optional(), "toggleOnList": z.boolean().describe("Show toggle on feature list").optional(), "defaultState": z.boolean().describe("Default state for new features").optional(), "projects": z.array(z.string()).optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteEnvironmentValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listFactTablesValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "datasourceId": z.string().optional(), "projectId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postFactTableValidator = {
  bodySchema: z.object({ "name": z.string(), "description": z.string().describe("Description of the fact table").optional(), "owner": z.string().describe("The person who is responsible for this fact table").optional(), "projects": z.array(z.string()).describe("List of associated project ids").optional(), "tags": z.array(z.string()).describe("List of associated tags").optional(), "datasource": z.string().describe("The datasource id"), "userIdTypes": z.array(z.string()).describe("List of identifier columns in this table. For example, \"id\" or \"anonymous_id\""), "sql": z.string().describe("The SQL query for this fact table"), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getFactTableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateFactTableValidator = {
  bodySchema: z.object({ "name": z.string().optional(), "description": z.string().describe("Description of the fact table").optional(), "owner": z.string().describe("The person who is responsible for this fact table").optional(), "projects": z.array(z.string()).describe("List of associated project ids").optional(), "tags": z.array(z.string()).describe("List of associated tags").optional(), "userIdTypes": z.array(z.string()).describe("List of identifier columns in this table. For example, \"id\" or \"anonymous_id\"").optional(), "sql": z.string().describe("The SQL query for this fact table").optional(), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteFactTableValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const listFactTableFiltersValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0) }).strict(),
  paramsSchema: z.object({ "factTableId": z.string() }).strict(),
};

export const postFactTableFilterValidator = {
  bodySchema: z.object({ "name": z.string(), "description": z.string().describe("Description of the fact table filter").optional(), "value": z.string().describe("The SQL expression for this filter."), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI. Before you do this, the Fact Table itself must also be marked as \"api\"").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "factTableId": z.string() }).strict(),
};

export const getFactTableFilterValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "factTableId": z.string(), "id": z.string() }).strict(),
};

export const updateFactTableFilterValidator = {
  bodySchema: z.object({ "name": z.string().optional(), "description": z.string().describe("Description of the fact table filter").optional(), "value": z.string().describe("The SQL expression for this filter.").optional(), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI. Before you do this, the Fact Table itself must also be marked as \"api\"").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "factTableId": z.string(), "id": z.string() }).strict(),
};

export const deleteFactTableFilterValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "factTableId": z.string(), "id": z.string() }).strict(),
};

export const listFactMetricsValidator = {
  bodySchema: z.never(),
  querySchema: z.object({ "limit": z.coerce.number().int().default(10), "offset": z.coerce.number().int().default(0), "datasourceId": z.string().optional(), "projectId": z.string().optional(), "factTableId": z.string().optional() }).strict(),
  paramsSchema: z.never(),
};

export const postFactMetricValidator = {
  bodySchema: z.object({ "name": z.string(), "description": z.string().optional(), "owner": z.string().optional(), "projects": z.array(z.string()).optional(), "tags": z.array(z.string()).optional(), "metricType": z.enum(["proportion","mean","quantile","ratio"]), "numerator": z.object({ "factTableId": z.string(), "column": z.string().describe("Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count'").optional(), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }), "denominator": z.object({ "factTableId": z.string(), "column": z.string().describe("The column name or one of the special values: '$$distinctUsers' or '$$count'"), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }).describe("Only when metricType is 'ratio'").optional(), "inverse": z.boolean().describe("Set to true for things like Bounce Rate, where you want the metric to decrease").optional(), "quantileSettings": z.object({ "type": z.enum(["event","unit"]).describe("Whether the quantile is over unit aggregations or raw event values"), "ignoreZeros": z.boolean().describe("If true, zero values will be ignored when calculating the quantile"), "quantile": z.number().multipleOf(0.001).gte(0.001).lte(0.999).describe("The quantile value (from 0.001 to 0.999)") }).describe("Controls the settings for quantile metrics (mandatory if metricType is \"quantile\")").optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]), "value": z.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric").optional(), "priorSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used instead of the other settings in this object"), "proper": z.boolean().describe("If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior."), "mean": z.number().describe("The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)"), "stddev": z.number().gt(0).describe("Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.") }).describe("Controls the bayesian prior for the metric. If omitted, organization defaults will be used.").optional(), "regressionAdjustmentSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used"), "enabled": z.boolean().describe("Controls whether or not regression adjustment is applied to the metric").optional(), "days": z.number().describe("Number of pre-exposure days to use for the regression adjustment").optional() }).describe("Controls the regression adjustment (CUPED) settings for the metric").optional(), "riskThresholdSuccess": z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(), "riskThresholdDanger": z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(), "minPercentChange": z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(), "maxPercentChange": z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(), "minSampleSize": z.number().gte(0).optional(), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const getFactMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const updateFactMetricValidator = {
  bodySchema: z.object({ "name": z.string().optional(), "description": z.string().optional(), "owner": z.string().optional(), "projects": z.array(z.string()).optional(), "tags": z.array(z.string()).optional(), "metricType": z.enum(["proportion","mean","quantile","ratio"]).optional(), "numerator": z.object({ "factTableId": z.string(), "column": z.string().describe("Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count'").optional(), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }).optional(), "denominator": z.object({ "factTableId": z.string(), "column": z.string().describe("Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count'"), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }).describe("Only when metricType is 'ratio'").optional(), "inverse": z.boolean().describe("Set to true for things like Bounce Rate, where you want the metric to decrease").optional(), "quantileSettings": z.object({ "type": z.enum(["event","unit"]).describe("Whether the quantile is over unit aggregations or raw event values"), "ignoreZeros": z.boolean().describe("If true, zero values will be ignored when calculating the quantile"), "quantile": z.number().multipleOf(0.001).gte(0.001).lte(0.999).describe("The quantile value (from 0.001 to 0.999)") }).describe("Controls the settings for quantile metrics (mandatory if metricType is \"quantile\")").optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]), "value": z.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric").optional(), "regressionAdjustmentSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used"), "enabled": z.boolean().describe("Controls whether or not regression adjustment is applied to the metric").optional(), "days": z.number().describe("Number of pre-exposure days to use for the regression adjustment").optional() }).describe("Controls the regression adjustment (CUPED) settings for the metric").optional(), "riskThresholdSuccess": z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(), "riskThresholdDanger": z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(), "minPercentChange": z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(), "maxPercentChange": z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(), "minSampleSize": z.number().gte(0).optional(), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const deleteFactMetricValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ "id": z.string() }).strict(),
};

export const postBulkImportFactsValidator = {
  bodySchema: z.object({ "factTables": z.array(z.object({ "id": z.string(), "data": z.object({ "name": z.string(), "description": z.string().describe("Description of the fact table").optional(), "owner": z.string().describe("The person who is responsible for this fact table").optional(), "projects": z.array(z.string()).describe("List of associated project ids").optional(), "tags": z.array(z.string()).describe("List of associated tags").optional(), "datasource": z.string().describe("The datasource id"), "userIdTypes": z.array(z.string()).describe("List of identifier columns in this table. For example, \"id\" or \"anonymous_id\""), "sql": z.string().describe("The SQL query for this fact table"), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }) })).optional(), "factTableFilters": z.array(z.object({ "factTableId": z.string(), "id": z.string(), "data": z.object({ "name": z.string(), "description": z.string().describe("Description of the fact table filter").optional(), "value": z.string().describe("The SQL expression for this filter."), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI. Before you do this, the Fact Table itself must also be marked as \"api\"").optional() }) })).optional(), "factMetrics": z.array(z.object({ "id": z.string(), "data": z.object({ "name": z.string(), "description": z.string().optional(), "owner": z.string().optional(), "projects": z.array(z.string()).optional(), "tags": z.array(z.string()).optional(), "metricType": z.enum(["proportion","mean","quantile","ratio"]), "numerator": z.object({ "factTableId": z.string(), "column": z.string().describe("Must be empty for proportion metrics. Otherwise, the column name or one of the special values: '$$distinctUsers' or '$$count'").optional(), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }), "denominator": z.object({ "factTableId": z.string(), "column": z.string().describe("The column name or one of the special values: '$$distinctUsers' or '$$count'"), "filters": z.array(z.string()).describe("Array of Fact Table Filter Ids").optional() }).describe("Only when metricType is 'ratio'").optional(), "inverse": z.boolean().describe("Set to true for things like Bounce Rate, where you want the metric to decrease").optional(), "quantileSettings": z.object({ "type": z.enum(["event","unit"]).describe("Whether the quantile is over unit aggregations or raw event values"), "ignoreZeros": z.boolean().describe("If true, zero values will be ignored when calculating the quantile"), "quantile": z.number().multipleOf(0.001).gte(0.001).lte(0.999).describe("The quantile value (from 0.001 to 0.999)") }).describe("Controls the settings for quantile metrics (mandatory if metricType is \"quantile\")").optional(), "cappingSettings": z.object({ "type": z.enum(["none","absolute","percentile"]), "value": z.number().describe("When type is absolute, this is the absolute value. When type is percentile, this is the percentile value (from 0.0 to 1.0).").optional(), "ignoreZeros": z.boolean().describe("If true and capping is `percentile`, zeros will be ignored when calculating the percentile.").optional() }).describe("Controls how outliers are handled").optional(), "windowSettings": z.object({ "type": z.enum(["none","conversion","lookback"]), "delayHours": z.number().describe("Wait this many hours after experiment exposure before counting conversions").optional(), "windowValue": z.number().optional(), "windowUnit": z.enum(["hours","days","weeks"]).optional() }).describe("Controls the conversion window for the metric").optional(), "priorSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used instead of the other settings in this object"), "proper": z.boolean().describe("If true, the `mean` and `stddev` will be used, otherwise we will use an improper flat prior."), "mean": z.number().describe("The mean of the prior distribution of relative effects in proportion terms (e.g. 0.01 is 1%)"), "stddev": z.number().gt(0).describe("Must be > 0. The standard deviation of the prior distribution of relative effects in proportion terms.") }).describe("Controls the bayesian prior for the metric. If omitted, organization defaults will be used.").optional(), "regressionAdjustmentSettings": z.object({ "override": z.boolean().describe("If false, the organization default settings will be used"), "enabled": z.boolean().describe("Controls whether or not regression adjustment is applied to the metric").optional(), "days": z.number().describe("Number of pre-exposure days to use for the regression adjustment").optional() }).describe("Controls the regression adjustment (CUPED) settings for the metric").optional(), "riskThresholdSuccess": z.number().gte(0).describe("Threshold for Risk to be considered low enough, as a proportion (e.g. put 0.0025 for 0.25%). <br/> Must be a non-negative number and must not be higher than `riskThresholdDanger`.").optional(), "riskThresholdDanger": z.number().gte(0).describe("Threshold for Risk to be considered too high, as a proportion (e.g. put 0.0125 for 1.25%). <br/> Must be a non-negative number.").optional(), "minPercentChange": z.number().gte(0).describe("Minimum percent change to consider uplift significant, as a proportion (e.g. put 0.005 for 0.5%)").optional(), "maxPercentChange": z.number().gte(0).describe("Maximum percent change to consider uplift significant, as a proportion (e.g. put 0.5 for 50%)").optional(), "minSampleSize": z.number().gte(0).optional(), "managedBy": z.enum(["","api"]).describe("Set this to \"api\" to disable editing in the GrowthBook UI").optional() }) })).optional() }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};

export const postCodeRefsValidator = {
  bodySchema: z.object({ "branch": z.string(), "repoName": z.string(), "refs": z.array(z.object({ "filePath": z.string(), "startingLineNumber": z.number().int(), "lines": z.string(), "flagKey": z.string(), "contentHash": z.string() })) }).strict(),
  querySchema: z.never(),
  paramsSchema: z.never(),
};