export {
  EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES,
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  findCollidingUserIdTypeName,
  findDuplicateUserIdTypeName,
  findNewDuplicateUserIdTypeName,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getUserIdTypesToAdd,
  isEventForwarderLinkedUserIdType,
  isEventForwarderManagedUserIdType,
  mergeUserIdTypes,
  reconcileEventForwarderManagedUserIdTypes,
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
