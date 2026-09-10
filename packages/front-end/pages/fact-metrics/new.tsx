import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { isProjectListValidForProject } from "shared/util";
import { useRouter } from "next/router";
import { FactMetricInterface } from "shared/types/fact-table";
import Button from "@/ui/Button";
import MetricForm from "@/components/Metrics/MetricForm";
import { useUser } from "@/services/UserContext";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { getSafeReturnUrl } from "@/services/returnUrl";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricWorkspace from "@/components/FactTables/MetricEditor/MetricWorkspace";

export default function NewFactMetricPage() {
  const router = useRouter();
  const {
    getFactMetricById,
    project,
    ready,
    mutateDefinitions,
    factTables,
    datasources,
    metrics,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const { settings } = useUser();
  const { demoDataSourceId } = useDemoDataSourceProject();
  const [showLegacyForm, setShowLegacyForm] = useState(false);

  const returnUrl = getSafeReturnUrl(router.query.returnUrl);

  if (!ready || !router.isReady) return <LoadingOverlay />;

  const duplicateSource =
    typeof router.query.duplicate === "string"
      ? getFactMetricById(router.query.duplicate)
      : null;
  if (router.query.duplicate && !router.query.addMetric && !duplicateSource) {
    return (
      <Callout status="error">
        Could not find the metric to duplicate.{" "}
        <Link href={returnUrl}>Go back</Link>
      </Callout>
    );
  }
  // Matches the old modal's duplicate normalization (FactMetricList.tsx,
  // pre-migration): only "admin" managedBy carries over, and only if this
  // user could create it themselves - otherwise a copy of an API-managed or
  // admin-managed metric would be rejected outright by the backend instead
  // of saving as an ordinary metric.
  const duplicatedManagedBy: "" | "admin" =
    duplicateSource?.managedBy === "admin" &&
    permissionsUtil.canCreateOfficialResources(duplicateSource)
      ? "admin"
      : "";
  const duplicateFrom = duplicateSource
    ? {
        ...duplicateSource,
        name: duplicateSource.name + " (copy)",
        managedBy: duplicatedManagedBy,
      }
    : null;

  const canCreate = permissionsUtil.canCreateFactMetric({
    projects: project ? [project] : [],
    managedBy: "",
  });

  const hasDatasource = datasources.some(
    (d) =>
      isProjectListValidForProject(d.projects, project) &&
      d.properties?.queryLanguage === "sql",
  );
  const hasFactTable = factTables.some((t) =>
    isProjectListValidForProject(t.projects, project),
  );
  const showLegacySwitch =
    !settings.disableLegacyMetricCreation &&
    permissionsUtil.canCreateMetric({ projects: project ? [project] : [] }) &&
    metrics.some(
      (m) =>
        isProjectListValidForProject(m.projects, project) &&
        m.datasource !== demoDataSourceId,
    );

  return (
    <div className="pagecontents container-fluid">
      {showLegacyForm && (
        <MetricForm
          current={{
            projects: project ? [project] : [],
          }}
          edit={false}
          source="metric-editor"
          onClose={() => setShowLegacyForm(false)}
          switchToFact={() => setShowLegacyForm(false)}
        />
      )}
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: "New Fact Metric" },
        ]}
      />
      <Heading as="h1" mb="3">
        New Fact Metric
      </Heading>
      {!canCreate ? (
        <Callout status="error">
          You don&apos;t have permission to create Fact Metrics in this Project.{" "}
          <Link href="/metrics">Back to all metrics</Link>
        </Callout>
      ) : !hasDatasource ? (
        <Callout status="info">
          Connect a Data Source to create a metric.{" "}
          <Link href="/datasources">Connect Data Source</Link>
        </Callout>
      ) : !hasFactTable ? (
        <Callout status="info">
          Create a fact table to define your metric.{" "}
          <Link href="/fact-tables">Go to fact tables</Link>
        </Callout>
      ) : (
        <MetricWorkspace
          existing={null}
          duplicateFrom={duplicateFrom}
          isEditing={true}
          mutate={mutateDefinitions}
          onSaved={(metric: FactMetricInterface) =>
            router.replace(`/fact-metrics/${metric.id}`)
          }
          onCancel={() => router.push(returnUrl)}
        />
      )}
      {showLegacySwitch && (
        <Flex mt="3">
          <Button variant="ghost" onClick={() => setShowLegacyForm(true)}>
            Use legacy SQL metric form
          </Button>
        </Flex>
      )}
    </div>
  );
}
