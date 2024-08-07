/* eslint-disable no-console */

import fs from "node:fs/promises";
import path from "node:path";
import { Collection } from "mongodb";
import bluebird from "bluebird";
import mongoose from "mongoose";
import sortBy from "lodash/sortBy";
import { getMigrations, appendMigration } from "./models/MigrationModel";

const migrationFileNameRegex = /([\d]+)\.([\w]+).([\w]+.)\.ts$/;
const digitsCount = 7;

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

export type MigrationHandler = {
  updateAll: typeof updateAll;
  collection: Collection;
};

const migrationTemplate = `
import { MigrationHandler } from "@back-end/src/migrations";

export const apply = (h: MigrationHandler) =>
  // Write migration here
}
`;

type Migration = {
  index: number;
  collection: string;
  name: string;
  apply: (collection: Collection) => void | Promise<void>;
};

const migrationsDir = path.resolve(__dirname, "migrations");

const loadMigrations = async (): Promise<Migration[]> => {
  const migrations = await bluebird.reduce(
    await fs.readdir(migrationsDir),
    async (migrations, fname) => {
      const match = fname.match(migrationFileNameRegex);

      if (!match) return migrations;

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, index, collection, name] = match;
      const { apply } = await import(path.join(migrationsDir, fname));

      return [...migrations, { index: Number(index), collection, name, apply }];
    },
    [] as Migration[]
  );

  return sortBy(migrations, "index");
};

export const generateMigration = async ({
  collection,
  name,
}: {
  collection: string;
  name: string;
}) => {
  const migrations = await loadMigrations();

  const lastIndex = Math.max(...[0, ...migrations.map(({ index }) => index)]);

  console.log(
    `Found ${migrations.length} existing migrations. Last index: ${lastIndex}`
  );

  const fname = `${String(lastIndex + 1).padStart(
    digitsCount,
    "0"
  )}.${collection}.${name}.ts`;

  console.log(`Generating migration ${fname}`);

  await fs.writeFile(path.join(migrationsDir, fname), migrationTemplate);
};

export const applyMigrations = async () => {
  const migrations = await loadMigrations();
  await bluebird.each(migrations, async ({ name, collection, apply }) => {
    const c = mongoose.connection.db.collection(collection);

    const existingMigrations = await getMigrations(collection);

    if (existingMigrations.includes(name)) {
      console.log(
        `Migration ${name} on collection ${collection} already applied!`
      );
      return;
    }

    console.log(`Applying migration ${name} on collection ${collection}..`);
    await apply(c);
    await appendMigration(collection, name);
  });
};
