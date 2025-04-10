import mongoose from "mongoose";
import { UpdateResult } from "mongodb";
import { WatchInterface } from "back-end/types/watch";
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
  userId: string
): Promise<WatchInterface | null> {
  const watchDoc = await getCollection(COLLECTION).findOne({
    userId,
    organization,
  });
  return watchDoc ? toInterface(watchDoc) : null;
}

export async function getExperimentWatchers(
  experimentId: string,
  organization: string
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
  // First try to find the existing watch document
  const doc = await WatchModel.findOne({
    userId,
    organization,
  });

  if (doc) {
    // Get current items or initialize empty array
    const currentItems = doc[type] || [];

    // Only add the item if it doesn't already exist
    if (!currentItems.includes(item)) {
      const updatedItems = [...currentItems, item];

      return await WatchModel.updateOne(
        {
          userId,
          organization,
        },
        {
          $set: {
            [type]: updatedItems,
          },
        }
      );
    }

    // Item already exists, no update needed
    return {
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: undefined,
      matchedCount: 1,
    };
  } else {
    // Document doesn't exist, create a new one
    const newDoc = {
      userId,
      organization,
      [type]: [item],
    };

    const result = await WatchModel.create(newDoc);
    return {
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 1,
      upsertedId: result._id,
      matchedCount: 0,
    };
  }
}

export async function deleteWatchedByEntity({
  organization,
  userId,
  type,
  item,
}: UpdateWatchOptions): Promise<UpdateResult> {
  // Find the document
  const doc = await WatchModel.findOne({
    userId,
    organization,
  });

  // If no document found, nothing to delete
  if (!doc) {
    return {
      acknowledged: true,
      modifiedCount: 0,
      upsertedCount: 0,
      upsertedId: undefined,
      matchedCount: 0,
    };
  }

  // Get current items or initialize empty array
  const currentItems = doc[type] || [];

  // Remove the item from the array
  const updatedItems = currentItems.filter((i) => i !== item);

  // Update the document
  return await WatchModel.updateOne(
    {
      userId,
      organization,
    },
    {
      $set: {
        [type]: updatedItems,
      },
    }
  );
}
