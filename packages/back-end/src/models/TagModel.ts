import mongoose from "mongoose";
import { TagDBInterface, TagInterface } from "../../types/tag";

const tagSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  tags: [String],
  settings: {
    type: Map,
    of: {
      _id: false,
      name: String,
      color: String,
      description: String,
    },
  },
});

export type TagDocument = mongoose.Document & TagDBInterface;

const TagModel = mongoose.model<TagDocument>("Tag", tagSchema);

function toTagInterface(doc: TagDocument | null): TagInterface[] {
  if (!doc) return [];
  const json = doc.toJSON();
  if (!json.tags) return [];
  const settings = json.settings || {};
  return json.tags.map((t) => {
    return {
      id: t,
      color: settings[t]?.color || "#029dd1",
      description: settings[t]?.description || "",
    };
  });
}

export async function getAllTags(
  organization: string
): Promise<TagInterface[]> {
  const doc = await TagModel.findOne({
    organization,
  });
  return toTagInterface(doc);
}

export async function addTags(organization: string, tags: string[]) {
  tags = tags.filter((x) => x.length > 1);
  if (!tags.length) return;

  await TagModel.updateOne(
    { organization },
    {
      $addToSet: {
        tags: { $each: tags },
      },
    },
    {
      upsert: true,
    }
  );
}

export async function addTag(
  organization: string,
  tag: string,
  color: string,
  description: string
) {
  const settingIndex = `settings.${tag}`;
  const setting = { [settingIndex]: { color, description } };
  await TagModel.updateOne(
    { organization },
    {
      $addToSet: {
        tags: tag,
      },
      $set: setting,
    },
    {
      upsert: true,
    }
  );
}

export async function removeTag(organization: string, tag: string) {
  await TagModel.updateOne(
    {
      organization,
    },
    {
      $pull: { tags: tag },
    }
  );
}

export async function addTagsDiff(
  organization: string,
  oldTags: string[],
  newTags: string[]
) {
  const diff = newTags.filter((x) => !oldTags.includes(x));
  if (diff.length) {
    await addTags(organization, diff);
  }
}
