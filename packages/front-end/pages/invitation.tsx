import { useEffect, useState } from "react";
import LoadingOverlay from "../components/LoadingOverlay";
import { useAuth } from "../services/auth";

const InvitationPage = (): React.ReactElement => {
  const { apiCall } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const key = window.location.search.match(/(^|&|\?)key=([a-zA-Z0-9]+)/)[2];

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

InvitationPage.noOrganization = true;

export default InvitationPage;
