import { useEffect, useState } from "react";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";

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
        <Callout
          status="info"
          action={
            <Button color="inherit" variant="ghost" disabled loading={fetching}>
              Checking Status
            </Button>
          }
        >
          We&apos;re generating the information schema for this datasource. This
          may take a minute, depending on the size of the datasource.
        </Callout>
      ) : (
        <Callout status="error">{error}</Callout>
      )}
    </div>
  );
}
