import mongoose from "mongoose";
import { TagDBInterface, TagInterface } from "../../types/tag";

const tagSchema = new mongoose.Schema({
  organization: {
    type: String,
    index: true,
  },
  tags: [String],
  settings: {},
});

type TagDocument = mongoose.Document & TagDBInterface;

const TagModel = mongoose.model<TagDBInterface>("Tag", tagSchema);

const MIN_TAG_LENGTH = 2;
const MAX_TAG_LENGTH = 64;

function toTagInterface(doc: TagDocument | null): TagInterface[] {
  if (!doc) return [];
  const json = doc.toJSON<TagDBInterface>();
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
  tags = tags.filter(
    (x) => x.length >= MIN_TAG_LENGTH && x.length <= MAX_TAG_LENGTH
  );
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
  if (tag.length < MIN_TAG_LENGTH || tag.length > MAX_TAG_LENGTH) {
    throw new Error(
      `Tags must be at between ${MIN_TAG_LENGTH} and ${MAX_TAG_LENGTH} characers long.`
    );
  }
  if (description.length > 256) {
    description = description.substr(0, 256);
  }

  const existing = await TagModel.findOne({
    organization,
  });

  if (existing?.tags?.filter((t) => t === tag).length !== 0) {
    throw new Error("Tag name already exists.");
  }
  const settings = existing?.settings || {};
  settings[tag] = { color, description };

  await TagModel.updateOne(
    { organization },
    {
      $addToSet: {
        tags: tag,
      },
      $set: {
        // Need to set the entire settings object, not just settings.{tag},
        // since tags can contains dots in the name
        settings,
      },
    },
    {
      upsert: true,
    }
  );
}

export async function removeTag(organization: string, tag: string) {
  const existing = await TagModel.findOne({
    organization,
  });

  const settings = existing?.settings || {};
  delete settings[tag];

  await TagModel.updateOne(
    {
      organization,
    },
    {
      $set: { settings },
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

export async function editTag(
  organization: string,
  tag: string,
  oldTag: string,
  color: string,
  description: string
) {
  if (tag.length < MIN_TAG_LENGTH || tag.length > MAX_TAG_LENGTH) {
    throw new Error(
      `Tags must be at between ${MIN_TAG_LENGTH} and ${MAX_TAG_LENGTH} characers long.`
    );
  }
  if (description.length > 256) {
    description = description.substr(0, 256);
  }

  const existing = await TagModel.findOne({
    organization,
  });
  // If settings does not exists.
  if (!existing?.settings) {
    throw new Error("Settings doen't exists.");
  }

  // Tag with the same name already exists.
  if (tag !== oldTag && existing?.tags?.filter((t) => t === tag).length !== 0) {
    throw new Error("Tag name already exists.");
  }
  // Assigning color, description in new tag.
  const settings = existing?.settings;
  settings[tag] = { color, description };
  if (tag !== oldTag) {
    delete settings[oldTag];
  }

  await TagModel.updateOne(
    { organization },
    {
      $set: {
        // Need to set the entire settings object, not just settings.{tag},
        // since tags can contains dots in the name
        settings,
        "tags.$[element]": tag,
      },
    },
    {
      arrayFilters: [
        {
          element: oldTag,
        },
      ],
      upsert: false,
    }
  );
}
