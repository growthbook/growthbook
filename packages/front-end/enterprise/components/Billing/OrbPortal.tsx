import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";

export default function OrbPortal() {
  const { data, error, isLoading } = useApi<{
    portalUrl: string;
  }>(`/subscription/portal-url`);

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error || !data) {
    return (
      <Callout status="error">
        {error?.message || "Unable to fetch customer portal."}
      </Callout>
    );
  }

  return (
    <div className="p-3 app-box border">
      <h3>Invoices & Usage</h3>
      {data.portalUrl ? (
        <iframe
          src={data.portalUrl}
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
