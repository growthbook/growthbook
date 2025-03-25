import useSWR from "swr";
import { useUser } from "@/services/UserContext";
import Callout from "@/components/Radix/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";

const fetcher = (url: string) =>
  fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_ORB_API_KEY}`,
    },
  }).then((res) => res.json());
const useOrbCustomerData = (organizationId: string) => {
  return useSWR(
    organizationId
      ? `https://api.withorb.com/v1/customers/external_customer_id/${organizationId}`
      : null,
    fetcher
  );
};

export default function OrbPortal({ orgId }: { orgId: string }) {
  const { data, error, isLoading } = useOrbCustomerData(orgId);
  const { subscription } = useUser();

  if (subscription?.billingPlatform !== "orb" || !orgId) return null;

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return <Callout status="error">{error}</Callout>;
  }

  return (
    <div className="pb-3 app-box">
      {data.portal_url ? (
        <iframe
          src={data.portal_url}
          style={{
            width: "100%",
            height: "100vh",
            border: "none",
          }}
          title="Customer Portal"
        />
      ) : null}
    </div>
  );
}
