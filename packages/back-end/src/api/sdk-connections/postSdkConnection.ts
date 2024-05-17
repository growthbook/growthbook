import { getLatestSDKVersion } from "shared/sdk-versioning";
import { PostSdkConnectionResponse } from "../../../types/openapi";
import {
  toApiSDKConnectionInterface,
  createSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { postSdkConnectionValidator } from "../../validators/openapi";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { sdkLanguages } from "../../util/constants";

export const postSdkConnection = createApiRequestHandler(
  postSdkConnectionValidator
)(
  async (req): Promise<PostSdkConnectionResponse> => {
    const {
      name,
      language,
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

    const languages = sdkLanguages.filter((l) => l === language);
    if (!languages.length)
      throw new Error(`Language ${language} is not supported!`);

    const sdkConnection = await createSDKConnection({
      name,
      languages,
      organization: req.context.org.id,
      sdkVersion:
        sdkVersion === undefined
          ? getLatestSDKVersion(languages[0])
          : sdkVersion,
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
