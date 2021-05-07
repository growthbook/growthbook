/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const pg = require("pg");
const { MongoClient } = require("mongodb");
const { POSTGRES_TEST_CONN } = require("../../src/util/secrets");

if (!fs.existsSync("./dummy/users.csv")) {
  console.error(
    "Missing CSV files. Make sure to run `yarn generate-dummy-data` first."
  );
  process.exit(1);
}
if (!POSTGRES_TEST_CONN.user) {
  console.error("Must specify env variable POSTGRES_TEST_CONN");
  process.exit(1);
}

const client = new pg.Client({
  user: "growthbook",
  database: "growthbook",
  port: 5432,
  ...POSTGRES_TEST_CONN,
});

async function updateMongo() {
  if (!process.env.IMPORT_ORG_ID) return;
  if (!process.env.MONGO_IMPORT_URI) return;

  const data = fs.readFileSync("./dummy/mongo.json");
  const { startDate, endDate, experiments } = JSON.parse(data);

  const uri = process.env.MONGO_IMPORT_URI.replace(/\/[a-zA-Z0-9_-]+\?/, "/?");
  const dbname = process.env.MONGO_IMPORT_URI.match(/\/([a-zA-Z0-9_-]+)\?/)[1];

  const client = new MongoClient(uri, {
    useUnifiedTopology: true,
  });
  await client.connect();
  const database = client.db(dbname);
  const collection = database.collection("experiments");
  const query = {
    organization: process.env.IMPORT_ORG_ID,
    trackingKey: {
      $in: experiments,
    },
  };
  const update = {
    $set: {
      "phases.0.dateStarted": new Date(startDate),
      "phases.0.dateEnded": new Date(endDate),
    },
  };
  await collection.updateMany(query, update);
}

function getInsertQuery(table) {
  const data = fs.readFileSync(`./dummy/${table}.csv`);
  const rows = data
    .toString()
    .split("\n")
    .map((row) => row.split(","));
  const cols = rows.shift();

  // Remove last empty row
  rows.pop();

  const sql = `INSERT INTO ${table} (${cols.join(",")}) VALUES
  ${rows
    .map((row) => {
      return `(${row.map((v) => "'" + v + "'").join(",")})`;
    })
    .join(",\n")}`;
  return sql;
}

async function run() {
  const dropQueries = [
    "DROP TABLE IF EXISTS users",
    "DROP TABLE IF EXISTS pages",
    "DROP TABLE IF EXISTS purchase",
    "DROP TABLE IF EXISTS experiment_viewed",
    "DROP TABLE IF EXISTS sessions",
    "DROP TABLE IF EXISTS signup",
    "DROP TABLE IF EXISTS viewed_signup",
  ];
  const createQueries = [
    "CREATE TABLE users (user_id VARCHAR(8) PRIMARY KEY, received_at TIMESTAMP, gender VARCHAR(10))",
    "CREATE TABLE pages (user_id VARCHAR(8), received_at TIMESTAMP, path VARCHAR(256))",
    "CREATE TABLE purchase (user_id VARCHAR(8), received_at TIMESTAMP, amount INT)",
    "CREATE TABLE experiment_viewed (user_id VARCHAR(8), received_at TIMESTAMP, experiment_id VARCHAR(64), variation_id INT)",
    "CREATE TABLE sessions (session_id VARCHAR(8) PRIMARY KEY, user_id VARCHAR(8), date_start TIMESTAMP, date_end TIMESTAMP, duration_seconds INT, num_pages INT)",
    "CREATE TABLE signup (user_id VARCHAR(8), received_at TIMESTAMP)",
    "CREATE TABLE viewed_signup (user_id VARCHAR(8), received_at TIMESTAMP)",
  ];
  const insertQueries = [
    getInsertQuery("users"),
    getInsertQuery("pages"),
    getInsertQuery("purchase"),
    getInsertQuery("experiment_viewed"),
    getInsertQuery("sessions"),
    getInsertQuery("signup"),
    getInsertQuery("viewed_signup"),
  ];

  // Timeout after 10 minutes
  setTimeout(() => {
    console.error("Timeout!");
    process.exit(1);
  }, 10 * 60 * 1000);

  try {
    const time = Date.now();
    console.log(new Date(), "Starting");
    await client.connect();
    console.log(new Date(), "Connected to Postgres");
    await Promise.all(dropQueries.map((q) => client.query(q)));
    console.log(new Date(), "DROP TABLE complete");
    await Promise.all(createQueries.map((q) => client.query(q)));
    console.log(new Date(), "CREATE TABLE complete");
    await Promise.all(insertQueries.map((q) => client.query(q)));
    console.log(new Date(), "INSERT INTO complete");
    await client.end();
    await updateMongo();
    console.log(new Date(), "Mongo Update complete");
    console.log("Finished! Took", Date.now() - time, "ms");
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

run();
