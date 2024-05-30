import { PutSdkConnectionResponse } from "../../../types/openapi";
import {
  findSDKConnectionById,
  toApiSDKConnectionInterface,
  editSDKConnection,
} from "../../models/SdkConnectionModel";
import { createApiRequestHandler } from "../../util/handler";
import { putSdkConnectionValidator } from "../../validators/openapi";
import { findAllProjectsByOrganization } from "../../models/ProjectModel";
import { sdkLanguages } from "../../util/constants";
import { SDKLanguage } from "../../../types/sdk-connection";

export const putSdkConnection = createApiRequestHandler(
  putSdkConnectionValidator
)(
  async (req): Promise<PutSdkConnectionResponse> => {
    const sdkConnection = await findSDKConnectionById(
      req.context,
      req.params.id
    );
    if (!sdkConnection) {
      throw new Error("Could not find sdkConnection with that id");
    }

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
    } = { ...sdkConnection, ...req.body };

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

    const updatedSdkConnection = await editSDKConnection(
      req.context,
      sdkConnection,
      {
        name,
        languages: (languages as unknown) as SDKLanguage[],
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
      }
    );

    return {
      sdkConnection: toApiSDKConnectionInterface(updatedSdkConnection),
    };
  }
);
