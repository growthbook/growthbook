import { PostFeatureResponse } from "../../../types/openapi";
import { createFeature } from "../../models/FeatureModel";
import { createApiRequestHandler } from "../../util/handler";
import { postFeatureValidator } from "../../validators/openapi";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { FeatureInterface } from "../../../types/feature";
import { EventAuditUser, EventAuditUserApiKey } from "../../events/event-types";

export const postFeature = createApiRequestHandler(postFeatureValidator)(
  async (req): Promise<PostFeatureResponse> => {
    // TODO: Enable once this is merged: https://github.com/growthbook/growthbook/pull/1265
    // req.checkPermissions("manageFeatures", otherProps.project);
    // req.checkPermissions("createFeatureDrafts", otherProps.project);

    const {
      id,
      defaultValue,
      description = "",
      project,
      archived = false,
      owner = "",
      tags,
      valueType,
      // TODO: environments
    } = req.body;
    const groupMap = await getSavedGroupMap(req.organization);

    const feature: FeatureInterface = {
      id: id.toLowerCase(),
      defaultValue,
      archived,
      valueType,
      owner,
      description,
      project,
      tags,
      // TODO: Environments
      environmentSettings: {},
      dateCreated: new Date(),
      dateUpdated: new Date(),
      organization: req.organization.id,
      revision: {
        version: 1,
        comment: "New feature",
        date: new Date(),
        publishedBy: getPublishedByFromRequest(req.eventAudit),
      },
    };
    await createFeature(req.organization, req.eventAudit, feature);

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
