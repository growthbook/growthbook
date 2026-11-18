import { Box } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";

const PORTAL_SCALE = 0.85;

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
    <Frame>
      <Heading as="h2" size="md" mb="3">
        Invoices & Usage
      </Heading>
      {data.portalUrl ? (
        // Cross-origin, so it's scaled down to shrink its fonts.
        <Box style={{ height: "100vh", overflow: "hidden" }}>
          <iframe
            src={data.portalUrl}
            style={{
              width: `${100 / PORTAL_SCALE}%`,
              height: `calc(100vh / ${PORTAL_SCALE})`,
              border: "none",
              transform: `scale(${PORTAL_SCALE})`,
              transformOrigin: "top left",
            }}
            title="Customer Portal"
          />
        </Box>
      ) : null}
    </Frame>
  );
}
