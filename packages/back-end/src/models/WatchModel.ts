import mongoose from "mongoose";
import { UpdateResult } from "mongodb";
import type { WatchInterface } from "back-end/types/watch";
import {
  ToInterface,
  getCollection,
  removeMongooseFields,
} from "back-end/src/util/mongo.util";

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
const COLLECTION = "watches";

const toInterface: ToInterface<WatchInterface> = (doc) =>
  removeMongooseFields(doc);

export async function getWatchedByUser(
  organization: string,
  userId: string,
): Promise<WatchInterface | null> {
  const watchDoc = await getCollection(COLLECTION).findOne({
    userId,
    organization,
  });
  return watchDoc ? toInterface(watchDoc) : null;
}

export async function getExperimentWatchers(
  experimentId: string,
  organization: string,
): Promise<string[]> {
  const watchers = await getCollection(COLLECTION)
    .find({
      experiments: experimentId,
      organization,
    })
    .project({ userId: 1, _id: 0 })
    .toArray();
  return watchers.map((watcher) => watcher.userId);
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
