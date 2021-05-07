import { MONGODB_URI } from "../util/secrets";
import mongoose from "mongoose";
import bluebird from "bluebird";

mongoose.Promise = bluebird;

export default async () => {
  // Connect to MongoDB
  return await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useUnifiedTopology: true,
  });
};
