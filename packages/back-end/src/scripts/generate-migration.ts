#!/usr/bin/env node

import { generateMigration } from "@back-end/src/migrations";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const [_, __, collection, name] = process.argv;

if (!collection || !name) {
  console.error("No collection or migration name given!");
  console.error("Usage: generate-migration <collection name> <migration name>");
  process.exit(1);
}

const exec = async () => {
  await generateMigration({ collection, name });
  process.exit(0);
};

exec();
