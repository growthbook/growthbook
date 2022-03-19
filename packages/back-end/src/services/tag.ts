import { TagModel } from "../models/TagModel";

export async function getAllTags(organization: string) {
  const doc = await TagModel.findOne({
    organization,
  });
  if (doc) {
    return doc.toJSON();
  }
  return [];
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
  const tagDoc = await getAllTags(organization);
  if (tagDoc && "tags" in tagDoc) {
    const newTags = tagDoc.tags.filter((t) => !(t === tag));
    const newSetting = { ...tagDoc?.settings };
    delete newSetting[tag];
    await TagModel.updateOne(
      { organization },
      { $set: { tags: newTags, settings: newSetting } }
    );
  }
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
