import type { Response } from "express";
import { getAffectedEnvsForExperiment } from "shared/util";
import { isURLTargeted } from "@growthbook/growthbook";
import { AuthRequest } from "../../types/AuthRequest";
import { getContextFromReq } from "../../services/organizations";
import {
  CreateURLRedirectProps,
  DestinationURL,
  URLRedirectInterface,
  UpdateURLRedirectProps,
} from "../../../types/url-redirect";
import {
  getAllPayloadExperiments,
  getAllURLRedirectExperiments,
  getExperimentById,
} from "../../models/ExperimentModel";
import {
  createURLRedirect,
  deleteURLRedirectById,
  findURLRedirectById,
  updateURLRedirect,
} from "../../models/UrlRedirectModel";
import { ReqContext } from "../../../types/organization";
import { ExperimentInterface } from "../../../types/experiment";
import {
  createUrlRedirectValidator,
  updateUrlRedirectValidator,
} from "./url-redirects.validators";

async function _validateRedirect(
  origin: string,
  destinations: DestinationURL[],
  context: ReqContext,
  experiment: ExperimentInterface,
  urlRedirectId?: string,
) {
  const payloadExperiments = await getAllPayloadExperiments(context);
  const urlRedirects = await getAllURLRedirectExperiments(
    context,
    payloadExperiments,
  );
  // TODO:
  const originUrl = origin;

  const existingRedirects = urlRedirects.filter(
    (r) => r.urlRedirect.id !== urlRedirectId,
  );

  existingRedirects.forEach((existing) => {
    if (
      isURLTargeted(originUrl, [
        {
          type: "simple",
          pattern: existing.urlRedirect.urlPattern,
          include: true,
        },
      ])
    ) {
      throw new Error("Origin URL matches an existing redirect's origin URL.");
    }
    existing.urlRedirect.destinationURLs?.forEach((d) => {
      if (
        isURLTargeted(d.url, [
          {
            type: "simple",
            pattern: origin,
            include: true,
          },
        ])
      ) {
        throw new Error(
          "Origin URL targets the destination url of an existing redirect.",
        );
      }
    });
    destinations.forEach((dest) => {
      if (
        isURLTargeted(dest.url, [
          {
            type: "simple",
            pattern: existing.urlRedirect.urlPattern,
            include: true,
          },
        ])
      ) {
        const variationName = experiment?.variations.find(
          (v) => v.id === dest.variation,
        )?.name;
        throw new Error(
          variationName
            ? `Origin URL of an existing redirect targets the destination URL for "${variationName}" in this redirect.`
            : "Origin URL of an existing redirect targets a destination URL in this redirect.",
        );
      }
    });
  });
}

export const postURLRedirect = async (
  req: AuthRequest<
    CreateURLRedirectProps,
    null,
    { circularDependencyCheck?: string }
  >,
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>,
) => {
  const data = createUrlRedirectValidator.parse(req.body);
  const context = getContextFromReq(req);
  const { circularDependencyCheck } = req.query;

  if (!data.urlPattern) {
    throw new Error("url pattern cannot be empty");
  }

  const experiment = await getExperimentById(context, data.experiment);
  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const variationIds = experiment?.variations.map((v) => v.id);
  const reqVariationIds = data.destinationURLs.map((r) => r.variation);

  const areValidVariations = variationIds?.every((v) =>
    reqVariationIds.includes(v),
  );
  if (!areValidVariations) {
    throw new Error("Invalid variation IDs for urlRedirects");
  }

  const origin = data.urlPattern;
  const destinations = data.destinationURLs;

  if (circularDependencyCheck === "true") {
    await _validateRedirect(origin, destinations, context, experiment);
  }

  const envs = getAffectedEnvsForExperiment({
    experiment,
  });
  envs.length > 0 &&
    req.checkPermissions("runExperiments", experiment.project, envs);

  const urlRedirect = await createURLRedirect({
    experiment,
    urlPattern: data.urlPattern,
    destinationURLs: data.destinationURLs,
    persistQueryString: !!data.persistQueryString,
    context,
  });

  res.status(200).json({
    status: 200,
    urlRedirect,
  });
};

export const putURLRedirect = async (
  req: AuthRequest<
    UpdateURLRedirectProps,
    { id: string },
    { circularDependencyCheck?: string }
  >,
  res: Response<{ status: 200; urlRedirect: URLRedirectInterface }>,
) => {
  const data = updateUrlRedirectValidator.parse(req.body);
  const context = getContextFromReq(req);

  const { org } = context;
  const { circularDependencyCheck } = req.query;

  const urlRedirect = await findURLRedirectById(req.params.id, org.id);
  if (!urlRedirect) {
    throw new Error("URL Redirect not found");
  }

  const experiment = await getExperimentById(context, urlRedirect.experiment);
  if (!experiment) {
    throw new Error("Could not find experiment");
  }

  const origin = data.urlPattern ?? urlRedirect.urlPattern;
  const destinations = data.destinationURLs ?? urlRedirect.destinationURLs;

  if (circularDependencyCheck === "true") {
    await _validateRedirect(
      origin,
      destinations,
      context,
      experiment,
      urlRedirect.id,
    );
  }

  const updates: Partial<URLRedirectInterface> = {
    urlPattern: data.urlPattern,
    destinationURLs: data.destinationURLs,
    persistQueryString: data.persistQueryString,
  };

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];
  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  await updateURLRedirect({
    urlRedirect,
    experiment,
    context,
    updates,
  });

  res.status(200).json({
    status: 200,
    urlRedirect,
  });
};

export const deleteURLRedirect = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;

  const urlRedirect = await findURLRedirectById(req.params.id, org.id);
  if (!urlRedirect) {
    throw new Error("URL Redirect not found");
  }

  const experiment = await getExperimentById(context, urlRedirect.experiment);

  const envs = experiment ? getAffectedEnvsForExperiment({ experiment }) : [];
  req.checkPermissions("runExperiments", experiment?.project || "", envs);

  await deleteURLRedirectById({
    urlRedirect,
    experiment,
    context,
  });

  res.status(200).json({
    status: 200,
  });
};
