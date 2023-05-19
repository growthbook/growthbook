import { PostFeatureResponse } from "../../../types/openapi";
import { createApiRequestHandler } from "../../util/handler";
import { postFeatureValidator } from "../../validators/openapi";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { FeatureEnvironment } from "../../../types/feature";
import { EventAuditUser, EventAuditUserApiKey } from "../../events/event-types";
import { BasicFeatureCreator } from "../../util/features";

export const postFeature = createApiRequestHandler(postFeatureValidator)(
  async (req): Promise<PostFeatureResponse> => {
    const {
      organization,
      body: {
        id,
        defaultValue,
        description,
        project,
        archived, // TODO: add this?
        valueType,
        owner,
        tags, // TODO: add this?
        environments,
      },
    } = req;

    if (!environments.length) {
      throw new Error("Must include environments");
    }

    const environmentSettings: Record<
      string,
      FeatureEnvironment
    > = environments.reduce<Record<string, FeatureEnvironment>>(
      (prev, curr) => {
        prev[curr.id] = {
          enabled: curr.enabled,
          rules: [],
        };
        return prev;
      },
      {}
    );

    const featureCreator = new BasicFeatureCreator({
      organization,
      valueType,
      description,
      owner,
      publishedBy: getPublishedByFromRequest(req.eventAudit),
      defaultValue,
      checkPermissions: () => undefined, // TODO: Update once this is merged: https://github.com/growthbook/growthbook/pull/1265
      id,
      project,
      environmentSettings,
      eventAudit: req.eventAudit,
    });
    const feature = await featureCreator.perform();
    const groupMap = await getSavedGroupMap(organization);

    return {
      feature: getApiFeatureObj(feature, req.organization, groupMap),
    };
  }
);

// TODO: Update with different token info once this merged: https://github.com/growthbook/growthbook/pull/1265
const getPublishedByFromRequest = (
  eventAudit: EventAuditUser
): { id: string; name: string; email: string } => {
  // The only possible branch is an API key for auditing
  const audit = eventAudit as EventAuditUserApiKey;

  return {
    id: audit?.apiKey || "unknown",
    name: "API Key",
    email: "(none)",
  };
};
