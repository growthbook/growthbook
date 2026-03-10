import { useEffect, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function PendingInformationSchemaCard({
  mutate,
}: {
  mutate: () => void;
}) {
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [retryCount, setRetryCount] = useState(1);

  useEffect(() => {
    if (fetching) {
      if (retryCount > 8) {
        setFetching(false);
        setError(
          "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes.",
        );
        setRetryCount(1);
      } else {
        const timer = setTimeout(() => {
          mutate();
          setRetryCount(retryCount * 2);
        }, retryCount * 1000);
        return () => {
          clearTimeout(timer);
        };
      }
    }
  }, [fetching, mutate, retryCount]);
  return (
    <div>
      {!error ? (
        <div className="alert alert-info d-flex align-items-center">
          <div>
            We&apos;re generating the information schema for this datasource.
            This may take a minute, depending on the size of the datasource.
          </div>
          <button disabled={true} className="btn btn-link">
            {fetching && <LoadingSpinner />} Checking Status
          </button>
        </div>
      ) : (
        <div className="alert alert-danger">{error}</div>
      )}
    </div>
  );
}
