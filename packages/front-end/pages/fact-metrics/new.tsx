import { useRouter } from "next/router";
import { FactMetricInterface } from "shared/types/fact-table";
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
    project,
    ready,
    mutateDefinitions,
    getFactMetricById,
    getFactTableById,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const returnUrl =
    typeof router.query.returnUrl === "string"
      ? router.query.returnUrl
      : "/metrics";

  if (!ready) return <LoadingOverlay />;

  const fromQuery = <T,>(
    key: string,
    lookup: (id: string) => T | null,
  ): T | null => {
    const v = router.query[key];
    return typeof v === "string" ? lookup(v) : null;
  };

  const initialFactTable = fromQuery("factTable", getFactTableById);
  const duplicateSource = fromQuery("duplicate", getFactMetricById);
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

  return (
    <div className="pagecontents container-fluid">
      <PageHead
        breadcrumb={[
          { display: "Metrics", href: "/metrics" },
          { display: "New Metric" },
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
      ) : (
        <MetricWorkspace
          existing={null}
          duplicateFrom={duplicateFrom}
          initialFactTable={initialFactTable}
          isEditing={true}
          mutate={mutateDefinitions}
          onSaved={(metric: FactMetricInterface) =>
            router.replace(`/fact-metrics/${metric.id}`)
          }
          onCancel={() => router.push(returnUrl)}
        />
      )}
    </div>
  );
}
