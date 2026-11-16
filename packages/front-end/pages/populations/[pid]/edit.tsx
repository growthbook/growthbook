import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import PopulationEditor from "@/components/Populations/PopulationEditor";
import { usePopulation, useRefreshPopulations } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Custom404 from "@/pages/404";

export default function EditPopulationPage() {
  const router = useRouter();
  const { pid } = router.query;
  const gb = useGrowthBook<AppFeatures>();
  const populationsEnabled = !!gb?.isOn("populations");
  const { ready } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const refreshPopulations = useRefreshPopulations();
  const { population, loading, error } = usePopulation(
    populationsEnabled && typeof pid === "string" ? pid : undefined,
  );

  if (!populationsEnabled) return <Custom404 />;
  if (error) {
    return (
      <div className="pagecontents container-fluid">
        <Callout status="error">{error.message}</Callout>
      </div>
    );
  }
  if (!ready || loading || !population) return <LoadingOverlay />;

  const populationHref = `/populations/${population.id}`;
  const canEdit = permissionsUtil.canUpdatePopulation(population, {});

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          { display: population.name, href: populationHref },
          { display: "Edit" },
        ]}
      />
      {canEdit ? (
        <PopulationEditor
          key={population.id}
          existing={population}
          onSaved={async () => {
            await refreshPopulations(population.id);
            await router.push(populationHref);
          }}
          onCancel={() => router.push(populationHref)}
        />
      ) : (
        <Callout status="error">
          You don&apos;t have permission to edit this Population.{" "}
          <Link href={populationHref}>Back to the Population</Link>
        </Callout>
      )}
    </div>
  );
}
