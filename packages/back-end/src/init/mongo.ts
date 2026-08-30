import mongoose, { ConnectOptions } from "mongoose";
import bluebird from "bluebird";
import { MONGODB_URI } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { getConnectionStringWithDeprecatedKeysMigratedForV3to4 } from "back-end/src/util/mongo.util";

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
};
