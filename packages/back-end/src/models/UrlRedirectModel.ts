import { isEqual, keyBy } from "lodash";
import omit from "lodash/omit";
import mongoose from "mongoose";
import uniqid from "uniqid";
import { ExperimentInterface } from "../../types/experiment";
import { ReqContext } from "../../types/organization";
import { DestinationURL, URLRedirectInterface } from "../../types/url-redirect";
import { refreshSDKPayloadCache } from "../services/features";
import { ApiReqContext } from "../../types/api";
import {
  getExperimentById,
  getPayloadKeys,
  updateExperiment,
} from "./ExperimentModel";

const urlRedirectSchema = new mongoose.Schema<URLRedirectInterface>({
  id: {
    type: String,
    required: true,
  },
  organization: {
    type: String,
    required: true,
  },
  urlPattern: {
    type: String,
    required: true,
  },
  experiment: {
    type: String,
    required: true,
  },
  destinationURLs: [
    {
      _id: false,
      variation: String,
      url: String,
    },
  ],
  persistQueryString: Boolean,
});
urlRedirectSchema.index({ organization: 1, id: 1 }, { unique: true });
urlRedirectSchema.index({ organization: 1, experiment: 1 });

export type URLRedirectDocument = mongoose.Document & URLRedirectInterface;

export const URLRedirectModel = mongoose.model<URLRedirectInterface>(
  "URLRedirect",
  urlRedirectSchema
);

const toInterface = (doc: URLRedirectDocument): URLRedirectInterface =>
  omit(
    doc.toJSON<URLRedirectDocument>({ flattenMaps: true }),
    ["__v", "_id"]
  );

export async function findURLRedirectById(
  id: string,
  organization: string
): Promise<URLRedirectInterface | null> {
  const doc = await URLRedirectModel.findOne({
    organization,
    id,
  });
  return doc ? toInterface(doc) : null;
}

export async function findURLRedirectsByExperiment(
  experiment: string,
  organization: string
): Promise<URLRedirectInterface[]> {
  const docs = await URLRedirectModel.find({
    experiment,
    organization,
  });
  return docs.map(toInterface);
}

export async function findURLRedirects(
  organization: string
): Promise<URLRedirectInterface[]> {
  return (
    await URLRedirectModel.find({
      organization,
    })
  ).map(toInterface);
}

export const createURLRedirect = async ({
  experiment,
  context,
  urlPattern,
  destinationURLs,
  persistQueryString,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  urlPattern: string;
  destinationURLs: DestinationURL[];
  persistQueryString: boolean;
}): Promise<URLRedirectInterface> => {
  const doc = toInterface(
    await URLRedirectModel.create({
      id: uniqid("url_"),
      experiment: experiment.id,
      organization: context.org.id,
      urlPattern,
      destinationURLs,
      persistQueryString,
      dateCreated: new Date(),
      dateUpdated: new Date(),
    })
  );

  // mark the experiment as having a url redirect
  if (!experiment.hasURLRedirects) {
    experiment = await updateExperiment({
      context,
      experiment,
      changes: { hasURLRedirects: true },
      bypassWebhooks: true,
    });
  }

  await onURLRedirectCreate({
    context,
    experiment,
  });

  return doc;
};

export const updateURLRedirect = async ({
  urlRedirect,
  experiment,
  context,
  updates,
  bypassWebhooks,
}: {
  urlRedirect: URLRedirectInterface;
  experiment: ExperimentInterface | null;
  context: ReqContext | ApiReqContext;
  updates: Partial<URLRedirectInterface>;
  bypassWebhooks?: boolean;
}) => {
  updates.dateUpdated = new Date();

  await URLRedirectModel.updateOne(
    {
      id: urlRedirect.id,
      organization: context.org.id,
    },
    {
      $set: {
        ...updates,
      },
    }
  );

  // double-check that the experiment is marked as having url redirects
  if (experiment && !experiment.hasURLRedirects) {
    await updateExperiment({
      context,
      experiment,
      changes: { hasURLRedirects: true },
      bypassWebhooks: true,
    });
  }

  const newURLRedirect = {
    ...urlRedirect,
    ...updates,
  };

  await onURLRedirectUpdate({
    oldURLRedirect: urlRedirect,
    newURLRedirect: newURLRedirect,
    context,
    bypassWebhooks,
  });

  return newURLRedirect;
};

const onURLRedirectCreate = async ({
  context,
  experiment,
}: {
  context: ReqContext | ApiReqContext;
  experiment: ExperimentInterface;
}) => {
  const payloadKeys = getPayloadKeys(context, experiment);
  await refreshSDKPayloadCache(context, payloadKeys);
};

const onURLRedirectUpdate = async ({
  context,
  oldURLRedirect,
  newURLRedirect,
  bypassWebhooks = false,
}: {
  context: ReqContext | ApiReqContext;
  oldURLRedirect: URLRedirectInterface;
  newURLRedirect: URLRedirectInterface;
  bypassWebhooks?: boolean;
}) => {
  if (bypassWebhooks) return;

  if (
    isEqual(
      omit(oldURLRedirect, "dateUpdated"),
      omit(newURLRedirect, "dateUpdated")
    )
  ) {
    return;
  }

  const experiment = await getExperimentById(
    context,
    newURLRedirect.experiment
  );

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(context, experiment);

  await refreshSDKPayloadCache(context, payloadKeys);
};

const onURLRedirectDelete = async ({
  context,
  urlRedirect,
}: {
  context: ReqContext | ApiReqContext;
  urlRedirect: URLRedirectInterface;
}) => {
  // get payload keys
  const experiment = await getExperimentById(context, urlRedirect.experiment);

  if (!experiment) return;

  const payloadKeys = getPayloadKeys(context, experiment);

  await refreshSDKPayloadCache(context, payloadKeys);
};

// when an experiment adds/removes variations, we need to update the analogous
// url redirect changes to be in sync
export const syncURLRedirectsWithVariations = async ({
  experiment,
  context,
  urlRedirect,
}: {
  experiment: ExperimentInterface;
  context: ReqContext | ApiReqContext;
  urlRedirect: URLRedirectInterface;
}) => {
  const { variations } = experiment;
  const { destinationURLs } = urlRedirect;
  const byVariationId = keyBy(destinationURLs, "variation");
  const newDestinationURLs = variations.map((variation) => {
    const destination = byVariationId[variation.id];
    return destination ? destination : { variation: variation.id, url: "" };
  });

  await updateURLRedirect({
    context,
    urlRedirect: urlRedirect,
    experiment,
    updates: { destinationURLs: newDestinationURLs },
    // bypass webhooks since the payload was already updated by the experiment change
    bypassWebhooks: true,
  });
};

export const deleteURLRedirectById = async ({
  urlRedirect,
  experiment,
  context,
}: {
  urlRedirect: URLRedirectInterface;
  experiment: ExperimentInterface | null;
  context: ReqContext | ApiReqContext;
}) => {
  await URLRedirectModel.deleteOne({
    id: urlRedirect.id,
    organization: context.org.id,
  });

  // if experiment has no more url redirects, update experiment
  const remaining = await findURLRedirectsByExperiment(
    urlRedirect.experiment,
    context.org.id
  );
  if (remaining.length === 0) {
    if (experiment && experiment.hasURLRedirects) {
      await updateExperiment({
        context,
        experiment,
        changes: { hasURLRedirects: false },
        bypassWebhooks: true,
      });
    }
  }

  await onURLRedirectDelete({
    context,
    urlRedirect,
  });
};
