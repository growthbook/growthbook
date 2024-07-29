import mongoose from "mongoose";

const migrationSchema = new mongoose.Schema({
  targetCollection: {
    type: String,
    index: true,
  },
  migrations: [String],
});

type MigrationInterface = {
  targetCollection: string;
  migrations: string[];
};

const MigrationModel = mongoose.model<MigrationInterface>(
  "growbookmigrations",
  migrationSchema
);

export const getMigrations = async (
  targetCollection: string
): Promise<string[]> => {
  const doc = await MigrationModel.findOne({
    targetCollection,
  });

  if (!doc) return [];

  return doc.migrations;
};

export const appendMigration = async (
  targetCollection: string,
  migration: string
) => {
  const migrations = await getMigrations(targetCollection);

  if (migrations.includes(migration))
    throw new Error(
      `Migration ${migration} has already been applied to collection ${targetCollection}`
    );

  await MigrationModel.updateOne(
    { targetCollection },
    { migrations: [...migrations, migration] },
    { upsert: true }
  );
};
