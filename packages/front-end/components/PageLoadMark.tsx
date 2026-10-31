import { useEffect } from "react";
import { useRouter } from "next/router";
import { useAuth } from "@/services/auth";
import { markPageLoad, PageLoadMarkName } from "@/services/pageLoad";

// Marks a point in the first page load. The `last` mark sends the timings to
// the back end, which writes them to its log.
export default function PageLoadMark({
  name,
  last = false,
}: {
  name: PageLoadMarkName;
  last?: boolean;
}) {
  const { pathname } = useRouter();
  const { apiCall } = useAuth();

  useEffect(() => {
    markPageLoad(name, pathname, last, (report) => {
      apiCall("/page-load", {
        method: "POST",
        body: JSON.stringify(report),
        keepalive: true,
      }).catch(() => {
        // Timings are best effort
      });
    });
  }, [name, pathname, last, apiCall]);

  return null;
}
