import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import PopulationEditor from "@/components/Populations/PopulationEditor";
import Custom404 from "@/pages/404";

export default function NewPopulationPage() {
  const gb = useGrowthBook<AppFeatures>();
  if (!gb?.isOn("populations")) {
    return <Custom404 />;
  }
  return <PopulationEditor />;
}
