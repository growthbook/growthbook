import { useEffect, useState } from "react";
import { Flex } from "@radix-ui/themes";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";

export default function PendingTablesCard({ mutate }: { mutate: () => void }) {
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [retryCount, setRetryCount] = useState(1);

  useEffect(() => {
    if (fetching) {
      if (retryCount > 8) {
        setFetching(false);
        setError(
          "This is taking quite a while. We're identifying tables in the background. Feel free to leave this page and check back in a few minutes.",
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
    <>
      {!error ? (
        <Callout status="info" mt="2">
          <Flex align="center" gap="2">
            <LoadingSpinner />
            <div>
              We&apos;re identifying what tables are available on this Data
              Source. This may take a minute, depending on the size of the Data
              Source.
            </div>
          </Flex>
        </Callout>
      ) : (
        <Callout status="warning" mt="2">
          {error}
        </Callout>
      )}
    </>
  );
}
