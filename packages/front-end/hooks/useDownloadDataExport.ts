import { useCallback, useState } from "react";
import { DataExportFileResponse } from "shared/types/data-exports";
import { useAuth } from "@/services/auth";
import { saveAs } from "@/services/files";

type DownloadDataExportOptions = {
  url: string;
  successDelay?: number;
};

type DownloadDataExport = {
  isDownloading: boolean;
  hasError: boolean;
  performDownload: () => void;
};

/**
 * Helper for downloading files from the Data Export endpoints (GET /data-export/:resource?type=:type)
 *
 * URL should be something like /data-export/events?type=json
 * and it should return {@link DataExportFileResponse} for this to work.
 *
 * Specify an optional successDelay, and 0 if you prefer no delay. Default: 10 seconds.
 * The file will download immediately after it's complete, the delay is to optionally prevent button click spam.
 *
 * Example:
 *    const {
 *      isDownloading,
 *      performDownload,
 *      hasError,
 *    } = useDownloadDataExport({ url: "/data-export/events?type=json" });
 *
 * @param url
 * @param successDelay
 */
export const useDownloadDataExport = ({
  url,
  successDelay,
}: DownloadDataExportOptions): DownloadDataExport => {
  const { apiCall } = useAuth();
  const [hasError, setHasError] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const performDownload = useCallback(() => {
    setHasError(false);
    setIsDownloading(true);

    apiCall(url)
      .then((response: DataExportFileResponse) => {
        saveAs({
          textContent: response.data,
          fileName: response.fileName,
        });

        setTimeout(() => {
          // Re-enable after some time to avoid spam
          setIsDownloading(false);
        }, successDelay);
      })
      .catch((err) => {
        console.error(err);
        setHasError(true);
      });
  }, [apiCall, successDelay, url]);

  return {
    hasError,
    isDownloading,
    performDownload,
  };
};
