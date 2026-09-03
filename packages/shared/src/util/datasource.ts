export {
  EVENT_FORWARDER_MANAGED_IDENTIFIER_TYPE_DESCRIPTION,
  EVENT_FORWARDER_NAME_COLLISION_PREFIX,
  EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES,
  attributeMatchesDatasourceProjects,
  findCollidingUserIdTypeName,
  findEventForwarderManagedViolation,
  findNewDuplicateUserIdTypeName,
  getEventForwarderDatasourceParams,
  getEventForwarderHashAttributes,
  getEventForwarderSinkTypeForDatasource,
  getEventForwarderUserIdTypeSourceAttribute,
  isEventForwarderManaged,
  normalizeUserIdTypeName,
  resolveEventForwarderManagedName,
  resolveEventForwarderManagedUserIdTypes,
  supportsEventForwarder,
  toNormalizedNameSet,
} from "./event-forwarder-datasource";
export type {
  EventForwarderDatasourceParams,
  EventForwarderUserIdTypePair,
  EventForwarderUserIdTypeResolution,
} from "./event-forwarder-datasource";

export {
  secretParamKeys,
  redactSecretParams,
  mergeDataSourceParams,
  isSecretDatasourceParamKey,
} from "./datasource-params";
export type {
  DataSourceParamsForType,
  ParamClassification,
  ParamSensitivity,
} from "./datasource-params";

export type { DataRegion } from "./data-regions";

export {
  getDefaultMaxConcurrentQueries,
  getMaxConcurrentQueriesLimit,
} from "./datasource-concurrency";
