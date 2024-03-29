import mongoose from "mongoose";

export default async function deleteOrg(orgId: string) {
  const org = await mongoose.connection.db
    .collection("organizations")
    .findOne({ id: orgId });

  if (!org) throw new Error("Organization not found");

  // @ts-expect-error we do not care
  const userIds = org.members.map((m) => m.id);

  // these collected are not tied to orgs (maybe they should be?)
  const collectionsIgnored = ["agendaJobs", "installations"];

  const allCollections = await mongoose.connection.db
    .listCollections()
    .toArray();

  const collections = allCollections
    .map((c) => c.name)
    .filter((c) => !collectionsIgnored.includes(c));

  console.log("this count should be 50 ---->", collections.length);

  const orgFieldAliases = ["organization", "org", "orgId", "organizationId"];
  const query = {
    $or: [...orgFieldAliases.map((field) => ({ [field]: orgId }))],
  };

  const collectionsHit: string[] = [];
  const collectionsMissed: string[] = [];

  for (const collection of collections) {
    console.log("deleting from", collection);

    let result;
    if (collection === "authrefreshes" || collection === "forgotpasswords") {
      result = await mongoose.connection.db
        .collection(collection)
        .deleteMany({ userId: { $in: userIds } });
    } else {
      result = await mongoose.connection.db
        .collection(collection)
        .deleteMany(query);
    }
    console.log(
      "Deleted %s documents from %s",
      result.deletedCount,
      collection
    );

    if (result.deletedCount > 0) {
      collectionsHit.push(collection);
    } else {
      collectionsMissed.push(collection);
    }
  }

  console.log(
    "collections hit",
    collectionsHit.length,
    collectionsHit.join(", ")
  );

  console.log(
    "collections missed",
    collectionsMissed.length,
    collectionsMissed.join(", ")
  );

  const usersDeleted = await mongoose.connection.db
    .collection("users")
    .deleteMany({ id: { $in: userIds } });

  if (usersDeleted.deletedCount > 0) {
    console.log("Deleted %s users", usersDeleted.deletedCount);
  } else {
    console.log("No users deleted");
  }

  // delete teh org
  const orgDeleted = await mongoose.connection.db
    .collection("organizations")
    .deleteOne({ id: orgId });

  if (orgDeleted.deletedCount > 0) {
    console.log("Deleted org", orgId, orgDeleted.deletedCount);
  } else {
    console.log("No org deleted?");
  }
}
