import { useEffect, useState } from "react";
import { signinSilentCallback } from "../../authSources/oidcAuthSource";
import LoadingOverlay from "../../components/LoadingOverlay";

export default function OAuthSilentCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    signinSilentCallback().catch((e) => {
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
OAuthSilentCallbackPage.preAuth = true;
