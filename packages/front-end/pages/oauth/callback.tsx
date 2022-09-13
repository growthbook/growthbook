import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Button from "../../components/Button";
import LoadingOverlay from "../../components/LoadingOverlay";
import { getApiHost } from "../../services/env";

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
      .then((res) => {
        return res.json();
      })
      .then((json) => {
        if (!json?.redirectURI) {
          throw new Error(
            json?.message || "There was an error during authentication"
          );
        }
        router.replace(json.redirectURI);
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
                  window.location.href = "/";
                  // Wait 5 seconds for the redirect to complete
                  await new Promise((resolve) => setTimeout(resolve, 5000));
                }}
              >
                Retry
              </Button>
            </div>
            <div className="col-auto">
              <Button
                color="outline-primary"
                onClick={async () => {
                  await fetch(getApiHost() + `/auth/logout/soft`, {
                    method: "POST",
                    credentials: "include",
                  });
                  window.location.href = "/";
                  // Wait 5 seconds for the redirect to complete
                  await new Promise((resolve) => setTimeout(resolve, 5000));
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
