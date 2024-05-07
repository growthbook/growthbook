import mongoose from "mongoose";
import { omit } from "lodash";
import { UpdateResult } from "mongodb";
import { WatchInterface } from "../../types/watch";

const watchSchema = new mongoose.Schema({
  userId: String,
  organization: String,
  experiments: [String],
  features: [String],
});
watchSchema.index({ userId: 1, organization: 1 }, { unique: true });

export type WatchDocument = mongoose.Document & WatchInterface;

interface UpdateWatchOptions {
  organization: string;
  userId: string;
  type: "experiments" | "features";
  item: string;
}

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
  userId: string,
): Promise<WatchInterface | null> {
  const watchDoc = await WatchModel.findOne({
    userId,
    organization,
  });
  return watchDoc ? toInterface(watchDoc) : null;
}

export async function getExperimentWatchers(
  experimentId: string,
  organization: string,
): Promise<WatchInterface[]> {
  const watchers = await WatchModel.find({
    experiments: experimentId,
    organization,
  });
  return watchers.map((watcher) => toInterface(watcher));
}

export async function upsertWatch({
  userId,
  organization,
  item,
  type,
}: UpdateWatchOptions): Promise<UpdateResult> {
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
    },
  );
}

export async function deleteWatchedByEntity({
  organization,
  userId,
  type,
  item,
}: UpdateWatchOptions): Promise<UpdateResult> {
  return await WatchModel.updateOne(
    {
      userId: userId,
      organization: organization,
    },
    {
      $pull: {
        [type]: item,
      },
    },
  );
}
