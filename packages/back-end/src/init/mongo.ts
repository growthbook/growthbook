import { performance } from "perf_hooks";
import mongoose, { ConnectOptions } from "mongoose";
import bluebird from "bluebird";
import { MONGO_CALL_STATS, MONGODB_URI } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { getConnectionStringWithDeprecatedKeysMigratedForV3to4 } from "back-end/src/util/mongo.util";
import { installMongoCallCounter } from "back-end/src/util/mongoCallStats";

mongoose.Promise = bluebird;

export default async (): Promise<void> => {
  let uri = MONGODB_URI;
  if (process.env.NODE_ENV === "test") {
    uri = process.env.MONGO_URL || "";
  }

  const mongooseOpts: ConnectOptions = {
    bufferCommands: false,
    autoCreate: true,
    autoIndex: true,
  };

  if (MONGO_CALL_STATS) {
    const { installed, driverVersion } = await installMongoCallCounter();
    if (!installed) {
      logger.error(
        { driverVersion },
        "Unsupported MongoDB driver internals, not counting MongoDB calls per request",
      );
    }
  }

  // Connect to MongoDB
  try {
    // in Mongoose 7.x, connect will no longer return a Mongoose client
    await mongoose.connect(uri, mongooseOpts);
  } catch (e) {
    logger.warn(
      e,
      "Failed to connect to MongoDB. Retrying with field remapping for mongodb v3 to v4",
    );

    try {
      const {
        url: modifiedUri,
        success,
        remapped,
        unsupported,
      } = getConnectionStringWithDeprecatedKeysMigratedForV3to4(uri);
      if (!success) {
        throw new Error("mongodb connection string invalid");
      }

      // Log problematic fields before attempting to reconnect
      if (unsupported.length) {
        logger.error(`mongodb unsupported fields: ${unsupported.join(", ")}`);
      }
      if (remapped.length) {
        logger.warn(
          `mongodb deprecated fields remapped: ${remapped.join(", ")}`,
        );
      }

      await mongoose.connect(modifiedUri, mongooseOpts);
    } catch (e) {
      logger.error(e, "Failed to connect to MongoDB after retrying");
      throw new Error("MongoDB connection error.");
    }
  }

  if (MONGO_CALL_STATS) scheduleMongoRoundTripLog();
};

const ROUND_TRIP_LOG_INTERVAL_MS = 60_000;

function scheduleMongoRoundTripLog() {
  setTimeout(async () => {
    await logMongoRoundTrip();
    scheduleMongoRoundTripLog();
  }, ROUND_TRIP_LOG_INTERVAL_MS).unref();
}

async function logMongoRoundTrip() {
  try {
    const admin = mongoose.connection.db.admin();
    let ms = Infinity;
    let node: string | undefined;
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      const hello = await admin.command(
        { hello: 1 },
        { readPreference: "primary" },
      );
      ms = Math.min(ms, performance.now() - start);
      node = hello.me;
    }
    logger.info(
      { mongoRoundTrip: { node, ms: Math.round(ms * 100) / 100 } },
      "MongoDB round trip to the primary (fastest of 3 hello commands)",
    );
  } catch (e) {
    logger.warn(e, "Failed to measure the MongoDB round trip, next try in 60s");
  }
}
