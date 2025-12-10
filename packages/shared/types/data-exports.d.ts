/**
 * Common response type for supporting file downloads for data exports
 */
export type DataExportFileResponse = {
  fileName: string;
  data: string;
};
