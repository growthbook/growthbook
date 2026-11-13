import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import PopulationEditor from "@/components/Populations/PopulationEditor";
import { useRefreshPopulations } from "@/hooks/usePopulations";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import Custom404 from "@/pages/404";

export default function NewPopulationPage() {
  const router = useRouter();
  const gb = useGrowthBook<AppFeatures>();
  const { project, projects, ready } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const refreshPopulations = useRefreshPopulations();

  if (!gb?.isOn("populations")) return <Custom404 />;
  if (!ready) return <LoadingOverlay />;

  const canCreate = permissionsUtil.canViewCreatePopulation(project, projects);

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          { display: "Populations", href: "/populations" },
          { display: "New Population" },
        ]}
      />
      {canCreate ? (
        <PopulationEditor
          existing={null}
          onSaved={async (population) => {
            await refreshPopulations();
            await router.replace(`/populations/${population.id}`);
          }}
          onCancel={() => router.push("/populations")}
        />
      ) : (
        <Callout status="error">
          You don&apos;t have permission to create Populations
          {project ? " in this Project" : ""}.{" "}
          <Link href="/populations">Back to Populations</Link>
        </Callout>
      )}
    </div>
  );
}
