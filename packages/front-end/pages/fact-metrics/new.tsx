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
  const { project, ready, mutateDefinitions, getFactMetricById } =
    useDefinitions();
  const permissionsUtil = usePermissionsUtil();

  const returnUrl =
    typeof router.query.returnUrl === "string"
      ? router.query.returnUrl
      : "/metrics";

  if (!ready) return <LoadingOverlay />;

  const duplicateSource =
    typeof router.query.duplicate === "string"
      ? getFactMetricById(router.query.duplicate)
      : null;
  // Matches MetricsList.tsx's existing duplicate-name convention exactly -
  // including not resetting managedBy, a pre-existing quirk this migration
  // preserves rather than fixes.
  const duplicateFrom = duplicateSource
    ? { ...duplicateSource, name: duplicateSource.name + " (copy)" }
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
