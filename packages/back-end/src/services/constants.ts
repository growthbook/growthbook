import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { getPayloadKeysForAllEnvs } from "back-end/src/models/ExperimentModel";
import { queueSDKPayloadRefresh } from "./features";
import { getContextForAgendaJobByOrgObject } from "./organizations";

// Constants are resolved into SDK payloads at build time (`@const:` references).
// Changing a value therefore changes the generated payload, so we refresh the
// SDK payload cache (which also fires SDK webhooks for affected connections).
//
// Constants can be referenced cross-project and across environments, so — like
// saved groups — we conservatively refresh every cache entry across all
// environments/projects rather than trying to scope to the constant.
// TODO: scope to the constant's actual references once reference tracking lands.
export async function constantUpdated(
  baseContext: ReqContext | ApiReqContext,
  event: "updated" | "deleted" = "updated",
) {
  // Background job: use a context with full read permissions.
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  queueSDKPayloadRefresh({
    context,
    payloadKeys: getPayloadKeysForAllEnvs(context, [""]),
    treatEmptyProjectAsGlobal: true,
    auditContext: {
      event,
      model: "constant",
    },
  });
}
