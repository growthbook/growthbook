import mongoose from "mongoose";
import bluebird from "bluebird";
import { MONGODB_URI } from "../util/secrets";
import { logger } from "../util/logger";

mongoose.Promise = bluebird;

export default async () => {
  // Connect to MongoDB
  try {
    let uri = MONGODB_URI;
    if (process.env.NODE_ENV === "test") {
      uri = process.env.MONGO_URL || "";
    }

    return await mongoose.connect(uri, {
      useNewUrlParser: true,
      useCreateIndex: true,
      useUnifiedTopology: true,
    });
  } catch (e) {
    logger.error(e, "Failed to connect to MongoDB");
    throw new Error("MongoDB connection error.");
  }
};
