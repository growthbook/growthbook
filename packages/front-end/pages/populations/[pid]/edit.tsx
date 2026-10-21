import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { Box } from "@radix-ui/themes";
import Callout from "@/ui/Callout";
import LoadingOverlay from "@/components/LoadingOverlay";
import PopulationEditor from "@/components/Populations/PopulationEditor";
import { usePopulation } from "@/hooks/usePopulations";
import Custom404 from "@/pages/404";

export default function EditPopulationPage() {
  const router = useRouter();
  const { pid } = router.query;
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const { population, loading, error } = usePopulation(
    populationsEnabled && typeof pid === "string" ? pid : undefined,
  );

  if (!populationsEnabled) {
    return <Custom404 />;
  }
  if (error) {
    return (
      <Box className="pagecontents" style={{ margin: "0 auto" }}>
        <Callout status="error">{error.message}</Callout>
      </Box>
    );
  }
  if (loading || !population) {
    return <LoadingOverlay />;
  }
  // The editor only supports a single step, so saving a multi-step Population
  // created through the API would drop the rest.
  if (population.steps.length > 1) {
    return (
      <Box className="pagecontents" style={{ margin: "0 auto" }}>
        <Callout status="info">
          This Population has {population.steps.length} steps. Multi-step
          Populations can only be edited through the API for now.
        </Callout>
      </Box>
    );
  }

  // Like the edit modals, the editor seeds its form once per Population and
  // saving is last-write-wins, so a refetch doesn't discard unsaved edits.
  return <PopulationEditor key={population.id} population={population} />;
}
