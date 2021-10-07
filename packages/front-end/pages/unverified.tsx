import { useEffect, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { useAuth } from "../services/auth";

const UnverifiedPage = (): React.ReactElement => {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let key = null;
    const m =
      window.location.search.match(/(^|&|\?)key=([a-zA-Z0-9]+)/) ?? null;
    if (m) {
      key = m[2];
    }

    if (!key) {
      setError(
        "Missing required invite key parameter in URL. Please go back to your email and click the invite link again."
      );
      return;
    }

    apiCall<{ status: number; orgId?: string; message?: string }>(
      `/invite/accept`,
      {
        method: "POST",
        body: JSON.stringify({
          key,
        }),
      }
    )
      .then((res) => {
        if (res.orgId) {
          window.location.href = `/?org=${res.orgId}`;
        } else {
          setError(
            res.message ||
              "There was an error accepting the invite. Please go back to your email and click the invite link again."
          );
        }
      })
      .catch((e) => {
        setError(e.message);
      });
  }, []);

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  return <LoadingOverlay />;
};

UnverifiedPage.noOrganization = true;

export default UnverifiedPage;
