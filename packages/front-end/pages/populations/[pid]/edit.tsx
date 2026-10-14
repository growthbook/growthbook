import { useState } from "react";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import type { ApiPopulation } from "shared/validators";
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
  // Like the edit modals, the form is seeded once and saving is
  // last-write-wins. SWR keeps refetching on focus, and reseeding the form
  // would discard unsaved edits.
  const [startingCopy, setStartingCopy] = useState<ApiPopulation | null>(null);
  if (population && startingCopy?.id !== population.id) {
    setStartingCopy(population);
  }

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
  if (loading || !startingCopy) {
    return <LoadingOverlay />;
  }

  return <PopulationEditor key={startingCopy.id} population={startingCopy} />;
}
