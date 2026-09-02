import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { OAuthError } from "@/components/OAuthError";
import { getApiHost } from "@/services/env";
import { getPostAuthRedirectPath } from "@/services/auth";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const qs =
      window.location.search.length > 1
        ? window.location.search
        : "?" + window.location.hash.substring(1);

    const post = (path: string) =>
      window
        .fetch(getApiHost() + path, { method: "POST", credentials: "include" })
        .then((res) => res.json());

    post(`/auth/callback${qs}`)
      .then(async (json) => {
        if (json?.status === 200) {
          return router.replace(getPostAuthRedirectPath({ consume: true }));
        }
        // Another tab may have already finished logging in, making this failure moot
        const refresh = await post("/auth/refresh").catch(() => null);
        if (refresh?.token) {
          return router.replace(getPostAuthRedirectPath({ consume: true }));
        }
        setError(json?.message || "An unknown error occurred");
      })
      .catch((e) => {
        setError(e.message);
      });
  }, []);

  return (
    <div className="container py-4">
      {error ? <OAuthError error={error} /> : <LoadingOverlay />}
    </div>
  );
}
OAuthCallbackPage.preAuth = true;
OAuthCallbackPage.preAuthTopNav = true;
