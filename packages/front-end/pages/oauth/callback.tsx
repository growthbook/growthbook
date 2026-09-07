import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import { OAuthError } from "@/components/OAuthError";
import { getApiHost } from "@/services/env";
import { getPostAuthRedirectPath, redirectWithTimeout } from "@/services/auth";

// At most one silent restart a minute, so a persistent failure still surfaces the error page
const canAutoRestart = () => {
  try {
    const last = parseInt(
      window.sessionStorage.getItem("gb-login-restart") || "0",
      10,
    );
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem("gb-login-restart", `${Date.now()}`);
    return true;
  } catch (e) {
    return false;
  }
};

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
        // A stale attempt (e.g. a tab parked on the IdP overnight) is fixed by a fresh flow
        if (
          json?.code === "stale_login_attempt" &&
          refresh?.redirectURI &&
          canAutoRestart()
        ) {
          return redirectWithTimeout(refresh.redirectURI);
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
