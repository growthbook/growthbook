import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Button from "@/components/Button";
import LoadingOverlay from "@/components/LoadingOverlay";
import { redirectWithTimeout, safeLogout } from "@/services/auth";
import { getApiHost } from "@/services/env";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const qs =
      window.location.search.length > 1
        ? window.location.search
        : "?" + window.location.hash.substring(1);

    window
      .fetch(getApiHost() + `/auth/callback${qs}`, {
        method: "POST",
        credentials: "include",
      })
      .then((res) => res.json())
      .then((json) => {
        if (json?.status !== 200) {
          setError(json?.message || "An unknown error occurred");
        } else {
          try {
            let redirect =
              window.sessionStorage.getItem("postAuthRedirectPath") ?? "/";
            // make sure the redirect path is relative (starts with a / followed by a string or nothing)
            if (!/^\/\w*/.test(redirect)) {
              redirect = "/";
            }
            router.replace(redirect);
          } catch (e) {
            // just redirect to the home page if there's an error
            router.replace("/");
          }
        }
      })
      .catch((e) => {
        setError(e.message);
      });
  }, []);

  return (
    <div className="container">
      {error ? (
        <div>
          <div className="mt-5 alert alert-danger">
            <strong>OAuth Error:</strong> {error}
          </div>
          <div className="row">
            <div className="col-auto">
              <Button
                color="primary"
                onClick={async () => {
                  await redirectWithTimeout(window.location.origin);
                }}
              >
                Retry
              </Button>
            </div>
            <div className="col-auto">
              <Button
                color="outline-primary"
                onClick={async () => {
                  await safeLogout();
                }}
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <LoadingOverlay />
      )}
    </div>
  );
}
OAuthCallbackPage.preAuth = true;
