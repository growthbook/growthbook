import React, { useState } from "react";
import useApi from "../hooks/useApi";
import useUser from "../hooks/useUser";
import { SettingsApiResponse } from "../pages/settings";
import { useAuth } from "../services/auth";
import { isCloud } from "../services/env";

export const BillingErrorBanner = () => {
  const { apiCall } = useAuth();
  const { data } = useApi<SettingsApiResponse>(`/organization`);
  const { role } = useUser();
  const [error, setError] = useState(null);

  if (isCloud() && data?.organization.subscription?.status === "past_due") {
    return (
      <div className="alert alert-danger d-flex flex-column flex-md-row justify-content-between align-items-center">
        <div>
          <strong>Whoops!</strong> Your bill is passed due.
          <span>
            {role === "admin"
              ? " Please update your billing information."
              : " Please contact your administrator to update your payment method."}
          </span>
        </div>
        {role === "admin" && (
          <button
            className="btn btn-danger"
            onClick={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const res = await apiCall<{ url: string }>(
                  `/subscription/manage`,
                  {
                    method: "POST",
                  }
                );
                if (res && res.url) {
                  window.location.href = res.url;
                  return;
                } else {
                  throw new Error("Unknown response");
                }
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            Update Payment Method
          </button>
        )}
        {error && <div className="alert alert-danger">{error}</div>}
      </div>
    );
  } else {
    return null;
  }
};
