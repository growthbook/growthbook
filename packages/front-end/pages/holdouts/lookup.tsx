import { useEffect } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";
import Link from "@/components/Radix/Link";
import Callout from "@/components/Radix/Callout";
import useApi from "@/hooks/useApi";

export default function HoldoutLookupPage() {
  const router = useRouter();
  const { trackingKey } = router.query;

  const path = `/holdout/tracking-key?trackingKey=${encodeURIComponent(trackingKey + "")}`;
  const { data, isLoading, error } = useApi<{ holdoutId: string | null }>(
    path || "",
  );

  useEffect(() => {
    if (data && data.holdoutId) {
      router.push(`/holdout/${data.holdoutId}`);
    }
  }, [data, router]);

  if (isLoading) {
    return <LoadingOverlay />;
  }

  return (
    (!data?.holdoutId && (
      <div className="cotainer-fluid pagecontents pt-4">
        <Callout status="error">
          Error looking up holdout: {error?.message || "No Holdout found"}
        </Callout>{" "}
        <div className="mt-3 px-3">
          <Link href="/holdouts" size="3">
            All Holdouts
          </Link>
        </div>
      </div>
    )) || <LoadingOverlay />
  );
}
