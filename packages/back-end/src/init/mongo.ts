import mongoose from "mongoose";
import bluebird from "bluebird";
import { MONGODB_URI } from "../util/secrets";
import { logger } from "../util/logger";

mongoose.Promise = bluebird;

export default async (): Promise<void> => {
  // Connect to MongoDB
  try {
    let uri = MONGODB_URI;
    if (process.env.NODE_ENV === "test") {
      uri = process.env.MONGO_URL || "";
    }

    // in Mongoose 7.x, connect will no longer return a Mongoose client
    await mongoose.connect(uri, {
      bufferCommands: false,
      autoCreate: true,
      autoIndex: true,
    });
  } catch (e) {
    logger.error(e, "Failed to connect to MongoDB");
    throw new Error("MongoDB connection error.");
  }
};
