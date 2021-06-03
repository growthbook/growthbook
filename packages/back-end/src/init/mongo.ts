import { MONGODB_URI } from "../util/secrets";
import mongoose from "mongoose";
import bluebird from "bluebird";

mongoose.Promise = bluebird;

export default async () => {
  // Connect to MongoDB
  try {
    let uri = MONGODB_URI;
    if (process.env.NODE_ENV === "test") {
      uri = process.env.MONGO_URL;
    }

    return await mongoose.connect(uri, {
      useNewUrlParser: true,
      useCreateIndex: true,
      useUnifiedTopology: true,
    });
  } catch (e) {
    console.error(e);
    throw new Error("MongoDB connection error.");
  }
};
