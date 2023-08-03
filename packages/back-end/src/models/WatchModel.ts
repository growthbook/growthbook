import mongoose from "mongoose";
import { omit } from "lodash";
import { WatchInterface } from "../../types/watch";

const watchSchema = new mongoose.Schema({
  userId: String,
  organization: String,
  experiments: [String],
  features: [String],
});
watchSchema.index({ userId: 1, organization: 1 }, { unique: true });

export type WatchDocument = mongoose.Document & WatchInterface;

const WatchModel = mongoose.model<WatchInterface>("Watch", watchSchema);

/**
 * Convert the Mongo document to a WatchInterface, omitting Mongo default fields __v, _id
 * @param doc
 */
const toInterface = (doc: WatchDocument): WatchInterface => {
  return omit(doc.toJSON<WatchDocument>(), ["__v", "_id"]);
};

export async function getWatchedByUser(
  organization: string,
  userId: string
): Promise<WatchInterface | null> {
  const watchDoc = await WatchModel.findOne({
    userId,
    organization,
  });
  return watchDoc ? toInterface(watchDoc) : null;
}

export async function getExperimentWatchers(
  experimentId: string,
  organization: string
) {
  const watchers = await WatchModel.find({
    experiments: experimentId,
    organization,
  });
  return watchers.map((watcher) => toInterface(watcher));
}

export async function upsertWatch(
  userId: string,
  organization: string,
  item: string,
  type: "experiments" | "features"
) {
  return await WatchModel.updateOne(
    {
      userId,
      organization,
    },
    {
      $addToSet: {
        [type]: item,
      },
    },
    {
      upsert: true,
    }
  );
}

export async function deleteWatchedByEntity(
  organization: string,
  userId: string,
  type: string,
  id: string
) {
  const pluralType = type + "s";
  return await WatchModel.updateOne(
    {
      userId: userId,
      organization: organization,
    },
    {
      $pull: {
        [pluralType]: id,
      },
    }
  );
}
