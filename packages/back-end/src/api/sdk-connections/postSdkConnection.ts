import { PostSdkConnectionResponse } from "../../../types/openapi";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSdkConnectionValidator } from "../../validators/openapi";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { sdkLanguages } from "../../util/constants";
import { SDKLanguage } from "../../../types/sdk-connection";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator
)(
  async (req): Promise<PostSdkConnectionResponse> => {
    const {
      name,
      languages,
      sdkVersion,
      environment,
      projects = [],
      encryptPayload = false,
      includeVisualExperiments = false,
      includeDraftExperiments = false,
      includeExperimentNames = false,
      includeRedirectExperiments = false,
      proxyEnabled,
      proxyHost,
      hashSecureAttributes = false,
      remoteEvalEnabled,
    } = req.body;

    if (name.length < 3) {
      throw Error("Name length must be at least 3 characters");
    }

    if (projects) {
      const allProjects = await findAllProjectsByOrganization(req.context);
      const nonexistentProjects = projects.filter(
        (p) => !allProjects.some(({ id }) => p === id)
      );
      if (nonexistentProjects.length)
        throw new Error(
          `The following projects do not exist: ${nonexistentProjects.join(
            ", "
          )}`
        );
    }

    if (!languages.length)
      throw new Error("You need to specify some lanuages!");

    languages.forEach((lang) => {
      if (!(sdkLanguages as readonly string[]).includes(lang))
        throw new Error(`Language ${lang} is not supported!`);
    });

    const sdkConnection = await createSDKConnection({
      name,
      languages: (languages as unknown) as SDKLanguage[],
      organization: req.context.org.id,
      sdkVersion,
      environment,
      projects,
      encryptPayload,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      includeRedirectExperiments,
      proxyEnabled,
      proxyHost,
      hashSecureAttributes,
      remoteEvalEnabled,
    });

    return {
      sdkConnection: toApiSDKConnectionInterface(sdkConnection),
    };
  }
);
