export {
  EVENT_FORWARDER_SUPPORTED_DATASOURCE_TYPES,
  attributeMatchesDatasourceProjects,
  buildUserIdTypesFromAttributeSchema,
  findCollidingUserIdTypeName,
  getEventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  getUserIdTypesToAdd,
  isEventForwarderManagedUserIdType,
  mergeUserIdTypes,
  reconcileEventForwarderManagedUserIdTypes,
  supportsEventForwarder,
} from "./event-forwarder-datasource";
export type { EventForwarderDatasourceParams } from "./event-forwarder-datasource";
