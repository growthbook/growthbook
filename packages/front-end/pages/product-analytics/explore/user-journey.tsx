import { Box } from "@radix-ui/themes";
import PageHead from "@/components/Layout/PageHead";
import UserJourney from "@/enterprise/components/ProductAnalytics/UserJourneys/UserJourney";

export default function UserJourneyExplorePage() {
  return (
    <Box className="position-relative" style={{ padding: "8px" }}>
      <PageHead
        breadcrumb={[
          {
            display: "Explore",
            href: "/product-analytics/explore",
          },
          {
            display: "User Journey",
          },
        ]}
      />
      <Box width="100%">
        <UserJourney />
      </Box>
    </Box>
  );
}
