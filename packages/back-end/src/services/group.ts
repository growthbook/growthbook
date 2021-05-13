import { GroupModel } from "../models/GroupModel";

export async function getAllGroups(organization: string) {
  const doc = await GroupModel.findOne({
    organization,
  });
  if (doc) {
    return doc.groups;
  }

  return [];
}

export async function addGroups(organization: string, groups: string[]) {
  groups = groups.filter((x) => x.length > 1);
  if (!groups.length) return;

  await GroupModel.updateOne(
    { organization },
    {
      $addToSet: {
        groups: { $each: groups },
      },
    },
    {
      upsert: true,
    }
  );
}

export async function addGroupsDiff(
  organization: string,
  oldGroups: string[],
  newGroups: string[]
) {
  if (!oldGroups.length) return;
  const diff = newGroups.filter((x) => !oldGroups.includes(x));
  if (diff.length) {
    await addGroups(organization, diff);
  }
}
