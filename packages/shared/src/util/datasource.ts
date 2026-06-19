export {
  EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES,
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getUserIdTypesToAdd,
  isEventForwarderAllowedUserIdTypesChange,
  isEventForwarderManagedIdentifierId,
  isHashAttributeUserIdType,
  mergeUserIdTypes,
  supportsEventForwarder,
} from "./event-forwarder-datasource";
export type { EventForwarderDatasourceParams } from "./event-forwarder-datasource";
