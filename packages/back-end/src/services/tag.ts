import { TagModel } from "../models/TagModel";

export async function getAllTags(organization: string) {
  const doc = await TagModel.findOne({
    organization,
  });
  if (doc) {
    return doc.tags;
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

export async function addTagsDiff(
  organization: string,
  oldTags: string[],
  newTags: string[]
) {
  if (!oldTags.length) return;
  const diff = newTags.filter((x) => !oldTags.includes(x));
  if (diff.length) {
    console.log(diff);
    await addTags(organization, diff);
  }
}
