// Names of the incremental refresh queries that write the warehouse cache
// tables. The reaper reads them back to tell how far an interrupted run got.
export const incrementalRefreshQueryNames = {
  dropUnitsTable: (snapshotId: string) => `drop_${snapshotId}`,
  alterUnitsTable: (snapshotId: string) => `alter_${snapshotId}`,
  maxTimestampUnitsTable: (snapshotId: string) => `max_timestamp_${snapshotId}`,
  insertMetricsSourceData: (groupId: string) =>
    `insert_metrics_source_data_${groupId}`,
  maxTimestampMetricsSource: (groupId: string) =>
    `max_timestamp_metrics_source_${groupId}`,
};

export const INSERT_METRICS_SOURCE_DATA_PREFIX =
  incrementalRefreshQueryNames.insertMetricsSourceData("");
