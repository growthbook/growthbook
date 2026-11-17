import ExplorerPage from "@/enterprise/components/ProductAnalytics/ExplorerPage";

export default function JourneyExplorePage() {
  return (
    <ExplorerPage type="journey" breadcrumb={[{ display: "User Journeys" }]} />
  );
}

JourneyExplorePage.noPageWrapper = true;
