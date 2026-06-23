import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";

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
        <Callout status="info">
          <Flex align="center" justify="between" gap="2">
            <div>
              We&apos;re generating the information schema for this datasource.
              This may take a minute, depending on the size of the datasource.
            </div>
            <button disabled={true} className="btn btn-link">
              {fetching && <LoadingSpinner />} Checking Status
            </button>
          </Flex>
        </Callout>
      ) : (
        <Callout status="error">{error}</Callout>
      )}
    </div>
  );
}
