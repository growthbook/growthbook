import { useEffect } from "react";
import { useRouter } from "next/router";
import LoadingOverlay from "@/components/LoadingOverlay";

// The page moved to /settings/experiment-quality; older links still land here
export default function ExperimentationHealthRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/settings/experiment-quality${window.location.hash}`);
  }, [router]);
  return <LoadingOverlay />;
}
