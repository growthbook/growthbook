import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { signinCallback } from "../../authSources/oidcAuthSource";
import LoadingOverlay from "../../components/LoadingOverlay";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    signinCallback(router).catch((e) => {
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
