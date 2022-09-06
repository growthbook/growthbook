import { useRouter } from "next/router";
import { useEffect, useState } from "react";
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
        <div className="mt-5 alert alert-danger">{error}</div>
      ) : (
        <LoadingOverlay />
      )}
    </div>
  );
}
OAuthCallbackPage.preAuth = true;
