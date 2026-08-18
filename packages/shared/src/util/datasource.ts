export {
  EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES,
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getUserIdTypesToAdd,
  isEventForwarderManagedIdentifierId,
  isHashAttributeUserIdType,
  mergeUserIdTypes,
  supportsEventForwarder,
} from "./event-forwarder-datasource";
export type { EventForwarderDatasourceParams } from "./event-forwarder-datasource";

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
