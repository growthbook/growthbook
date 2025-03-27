import mongoose from "mongoose";
import { init } from "back-end/src/init";
import { logger } from "back-end/src/util/logger";

export async function migrations() {
  try {
    // NB: init is called from app, but we need to await here to ensure db connection is established
    await init();
    await dropOldIndexOnMetricTimeSeries();
  } catch (e) {
    logger.error("Unable to run migrations", { error: e });
  }
}

// This index is unique, and after adding sourcePhase the documents are not unique anymore
// based on these values, so we need to drop it to allow new documents to be created.
async function dropOldIndexOnMetricTimeSeries() {
  const oldIndexName = "organization_1_source_1_sourceId_1_metricId_1";
  const hasOldIndex = await mongoose.connection.db
    .collection("metrictimeseries")
    .indexExists(oldIndexName);

  if (hasOldIndex) {
    mongoose.connection.db
      .collection("metrictimeseries")
      .dropIndex(oldIndexName);
  }
}
