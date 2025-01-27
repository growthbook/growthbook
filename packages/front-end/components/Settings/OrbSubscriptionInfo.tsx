import { useState, useEffect } from "react";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "../LoadingOverlay";
import Callout from "../Radix/Callout";

export default function OrbSubscriptionInfo() {
  const [loading, setLoading] = useState(false);
  const [portalError, setPortalError] = useState<null | string>(null);
  const [portalUrl, setPortalUrl] = useState("");
  const { organization } = useUser();

  useEffect(() => {
    const fetchPortalUrl = async () => {
      setLoading(true);
      setPortalError(null);
      try {
        const res = await fetch(
          `https://api.withorb.com/v1/customers/external_customer_id/${organization.id}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.NEXT_PUBLIC_ORB_API_KEY}`,
            },
          }
        );
        const data = await res.json();
        if (data.portal_url) {
          setPortalUrl(data.portal_url);
        }

        if (data.status) {
          setPortalError(
            "Unable to load billing data at this time. Please contact support."
          );
          console.error(
            `Unable to fetch Orb customer portal for organization: ${
              organization.id
            }. ${data.detail ? `Reason: ${data.detail}` : ""}`
          );
        }
      } catch (err) {
        setPortalError(err.message);
        console.error(err);
      }
      setLoading(false);
    };

    fetchPortalUrl();
  }, [organization.id]);

  if (loading) return <LoadingOverlay />;

  return (
    <div>
      {portalUrl ? (
        <iframe
          src={portalUrl}
          onLoad={() => setLoading(false)}
          style={{
            width: "100%",
            height: "80vh",
            border: "none",
          }}
          title="Customer Portal"
        />
      ) : null}
      {portalError ? <Callout status="error">{portalError}</Callout> : null}
    </div>
  );
}
