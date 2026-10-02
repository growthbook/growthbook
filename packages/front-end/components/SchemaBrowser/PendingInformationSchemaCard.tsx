import { ReactNode, useEffect, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import Callout from "@/ui/Callout";

export default function PendingInformationSchemaCard({
  mutate,
  timeoutMessage = "This query is taking quite a while. We're building this in the background. Feel free to leave this page and check back in a few minutes.",
  size = "md",
}: {
  mutate: () => void;
  timeoutMessage?: ReactNode;
  size?: "sm" | "md";
}) {
  const [retryCount, setRetryCount] = useState(1);
  const timedOut = retryCount > 8;

  useEffect(() => {
    if (timedOut) return;
    const timer = setTimeout(() => {
      mutate();
      setRetryCount(retryCount * 2);
    }, retryCount * 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [timedOut, mutate, retryCount]);

  return timedOut ? (
    <Callout status="warning" size={size}>
      {timeoutMessage}
    </Callout>
  ) : (
    <Callout status="info" size={size} icon={<LoadingSpinner />}>
      Loading tables. This can take a minute.
    </Callout>
  );
}
