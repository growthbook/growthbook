import { Collection } from "mongodb";
import bluebird from "bluebird";
import mongoose from "mongoose";
import sortBy from "lodash/sortBy";
import { getMigrations, appendMigration } from "./models/MigrationModel";

type Migration = {
  index: number;
  name: string;
  apply: (collection: Collection) => void | Promise<void>;
};

// Abstracted away to potentially optimize later
const updateAll = async <
  Params extends Parameters<Collection["find"]>[0],
  Old extends Record<string, unknown>,
  New
>(
  c: Collection,
  params: Params,
  mapper: (old: Old) => New
) => {
  await bluebird.each((await c.find<Old>(params)).toArray(), async (model) => {
    await c.updateOne(model, { $set: mapper(model) });
  });
};

const migrations: Record<string, Migration[]> = {
  eventwebhooks: [
    {
      index: 0,
      name: "rename_organizationId",
      apply: (c) =>
        updateAll(c, { organizationId: null }, ({ organizationId }) => ({
          organization: organizationId,
          organizationId: null,
        })),
    },
  ],
};

export const applyMigrations = async () => {
  await bluebird.each(Object.keys(migrations), async (collectionName) => {
    const collection = mongoose.connection.db.collection(collectionName);

    const existingMigrations = await getMigrations(collectionName);

    const migrationsToApply = sortBy(
      migrations[collectionName].filter(
        ({ name }) => !existingMigrations.includes(name)
      ),
      "index"
    );

    await bluebird.each(migrationsToApply, async ({ name, apply }) => {
      await apply(collection);
      await appendMigration(collectionName, name);
    });
  });
};
