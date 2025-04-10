import mongoose from "mongoose";
import { TagDBInterface, TagInterface } from "back-end/types/tag";

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

  // First get the existing document
  const existing = await TagModel.findOne({ organization });

  if (existing) {
    // Get current tags
    const currentTags = existing.tags || [];

    // Add only the new tags that don't already exist
    const uniqueTags = [...new Set([...currentTags, ...tags])];

    await TagModel.updateOne(
      { organization },
      {
        $set: {
          tags: uniqueTags,
        },
      }
    );
  } else {
    // Create a new document
    await TagModel.create({
      organization,
      tags,
      settings: {},
    });
  }
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

  if (existing) {
    // Get current tags
    const currentTags = existing.tags || [];

    // Only add if tag doesn't already exist
    const updatedTags = currentTags.includes(tag)
      ? currentTags
      : [...currentTags, tag];

    // Update settings
    const settings: Record<string, { color: string; description: string }> =
      existing.settings || {};
    settings[tag] = { color, description };

    await TagModel.updateOne(
      { organization },
      {
        $set: {
          tags: updatedTags,
          settings,
        },
      }
    );
  } else {
    // Create new document
    const settings: Record<string, { color: string; description: string }> = {};
    settings[tag] = { color, description };

    await TagModel.create({
      organization,
      tags: [tag],
      settings,
    });
  }
}

export async function removeTag(organization: string, tag: string) {
  // First get the existing document
  const existing = await TagModel.findOne({ organization });

  if (!existing) {
    return; // Nothing to remove
  }

  // Filter out the tag to remove
  const updatedTags = (existing.tags || []).filter((t) => t !== tag);

  // Remove from settings if it exists
  const settings = existing.settings || {};
  if (settings[tag]) {
    delete settings[tag];
  }

  await TagModel.updateOne(
    { organization },
    {
      $set: {
        tags: updatedTags,
        settings,
      },
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
