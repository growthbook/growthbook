import { useRouter } from "next/router";
import { useState } from "react";
import { FactMetricInterface } from "shared/types/fact-table";
import { CommercialFeature } from "shared/enterprise";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Heading from "@/ui/Heading";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useUser } from "@/services/UserContext";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import MetricWorkspace from "@/components/FactTables/MetricEditor/MetricWorkspace";
import {
  parseMetricTemplate,
  TemplateMetric,
} from "@/components/FactTables/MetricEditor/templateMetric";

export default function NewFactMetricPage() {
  const router = useRouter();
  const {
    project,
    ready,
    mutateDefinitions,
    getFactMetricById,
    getFactTableById,
    factMetrics,
  } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();

  const [upgradeModal, setUpgradeModal] = useState<null | {
    source: string;
    commercialFeature: CommercialFeature;
  }>(null);

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

  // ?addMetric=<json> (crafted externally - docs, support, onboarding,
  // nothing in this repo generates the link) pre-fills a metric from a
  // template; MetricWorkspace completes the mapping itself (its numerator
  // has no factTableId yet). A template is the more deliberate of the two
  // seed sources, so it wins if a URL somehow carries both.
  const rawTemplate =
    typeof router.query.addMetric === "string" ? router.query.addMetric : null;
  let template: TemplateMetric | null = null;
  let templateError: string | null = null;
  if (rawTemplate) {
    try {
      template = parseMetricTemplate(rawTemplate);
    } catch (e) {
      templateError = e.message;
    }
  }

  const duplicateSource = template
    ? null
    : fromQuery("duplicate", getFactMetricById);
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
  const duplicateFrom = template
    ? template
    : duplicateSource
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

  // MetricEditor's MetricTypeSelect only disables a commercial-gated option
  // for a fresh choice - it doesn't stop a pre-seeded quantile/retention
  // template from saving, so this stays a page-level gate.
  const missingCommercialFeature:
    | "quantile-metrics"
    | "retention-metrics"
    | null =
    template?.metricType === "quantile" &&
    !hasCommercialFeature("quantile-metrics")
      ? "quantile-metrics"
      : template?.metricType === "retention" &&
          !hasCommercialFeature("retention-metrics")
        ? "retention-metrics"
        : null;

  const nameCollision =
    !!template && factMetrics.some((f) => f.name === template.name);

  return (
    <div className="pagecontents container-fluid">
      {upgradeModal && (
        <UpgradeModal
          close={() => setUpgradeModal(null)}
          source={upgradeModal.source}
          commercialFeature={upgradeModal.commercialFeature}
        />
      )}
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
      ) : templateError ? (
        <Callout status="error" mb="3">
          Failed to parse metric template: {templateError}
        </Callout>
      ) : missingCommercialFeature ? (
        <UpgradeMessage
          commercialFeature={missingCommercialFeature}
          upgradeMessage={
            missingCommercialFeature === "quantile-metrics"
              ? "create quantile metrics"
              : "create retention metrics"
          }
          showUpgradeModal={() =>
            setUpgradeModal({
              source: `metric-template-${missingCommercialFeature}`,
              commercialFeature: missingCommercialFeature,
            })
          }
        />
      ) : (
        <>
          {nameCollision && template && (
            <Callout status="warning" mb="3">
              A metric with the name &quot;{template.name}&quot; already exists.
            </Callout>
          )}
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
        </>
      )}
    </div>
  );
}
