import { ReqContext } from "back-end/types/request";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { ApiReqContext } from "back-end/types/api";
import { queueSDKPayloadRefresh } from "./features.js";
import { getContextForAgendaJobByOrgObject } from "./organizations.js";

export async function savedGroupUpdated(
  baseContext: ReqContext | ApiReqContext,
) {
  // This is a background job, so create a new context with full read permissions
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  // Saved groups can be nested recursively and may be referenced cross-project
  // To be safe, refresh all cache entries across all environments/projects
  // TODO: Optimize this later if performance becomes an issue
  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event: "updated",
      model: "savedgroup",
    },
  });
}
