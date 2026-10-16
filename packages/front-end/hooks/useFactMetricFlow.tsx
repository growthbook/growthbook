import { useCallback, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import { isProjectListValidForProject } from "shared/util";
import { FactMetricInterface } from "shared/types/fact-table";
import { useUser } from "@/services/UserContext";
import { getFactMetricCommercialFeature } from "@/services/factMetrics";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import { buildFactMetricDuplicate } from "@/services/metrics";
import Button from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Tooltip from "@/ui/Tooltip";
import FactMetricModal from "@/components/FactTables/FactMetricModal";

export type FactMetricCreationTarget = {
  factTable?: string;
  duplicate?: FactMetricInterface;
  datasource?: string;
};

type ModalTarget = FactMetricCreationTarget & {
  edit?: FactMetricInterface;
  source?: string;
};

// Every fact metric "Add metric", "Duplicate", and "Edit" entry point goes
// through here, so the new-metric-creation-flow experiment switches all of
// them at once: the new full-page editor, or the old FactMetricModal opened
// in place with the same props and tracking `source` it had before.
export default function useFactMetricFlow(source: string) {
  const newFlow = useFeatureIsOn("new-metric-creation-flow");
  // False until flag values load; newFlow reads as off until then.
  const ready = !!useGrowthBook()?.ready;
  const { factTables, project } = useDefinitions();
  // The new page explains a missing Fact Table; the old modal can't.
  const canOpen =
    ready &&
    (newFlow ||
      factTables.some((table) =>
        isProjectListValidForProject(table.projects, project),
      ));
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

  const href = (target: FactMetricCreationTarget = {}) => {
    const params = new URLSearchParams({
      returnUrl: router.asPath,
      source: target.duplicate ? `${source}-duplicate` : source,
    });
    if (target.factTable) params.set("factTable", target.factTable);
    if (target.duplicate) params.set("duplicate", target.duplicate.id);
    if (target.datasource) params.set("datasource", target.datasource);
    return `/fact-metrics/new?${params.toString()}`;
  };

  const open = (target: FactMetricCreationTarget = {}) => {
    if (!canOpen) return;
    if (newFlow) router.push(href(target));
    else setModalTarget(target);
  };

  const edit = useCallback(
    (metric: FactMetricInterface, trackingSource: string | null = null) => {
      if (!ready) return;
      if (newFlow) {
        const params = new URLSearchParams({
          edit: "true",
          source: trackingSource ?? source,
        });
        router.push(`/fact-metrics/${metric.id}?${params.toString()}`);
      } else {
        setModalTarget({ edit: metric, source: trackingSource ?? source });
      }
    },
    [ready, newFlow, router, source],
  );

  const button = (
    target: FactMetricCreationTarget = {},
    disabledReason?: string,
    label = "Add metric",
  ) => {
    const reason =
      disabledReason ||
      (!ready
        ? "Loading metric creation options."
        : !canOpen
          ? "Create a Fact Table before adding a metric."
          : null);
    if (reason) {
      return (
        <Tooltip content={reason}>
          <span tabIndex={0} style={{ cursor: "not-allowed" }}>
            <Button disabled style={{ pointerEvents: "none" }}>
              {label}
            </Button>
          </span>
        </Tooltip>
      );
    }
    return newFlow ? (
      <LinkButton href={href(target)}>{label}</LinkButton>
    ) : (
      <Button onClick={() => open(target)}>{label}</Button>
    );
  };

  const duplicate = modalTarget?.duplicate;
  const commercialFeature = getFactMetricCommercialFeature(
    duplicate?.metricType,
  );
  const modal = !modalTarget ? null : modalTarget.edit ? (
    <FactMetricModal
      close={() => setModalTarget(null)}
      existing={modalTarget.edit}
      source={modalTarget.source ?? source}
    />
  ) : commercialFeature && !hasCommercialFeature(commercialFeature) ? (
    <UpgradeModal
      close={() => setModalTarget(null)}
      source={`${source}-duplicate-${commercialFeature}`}
      commercialFeature={commercialFeature}
    />
  ) : (
    <FactMetricModal
      close={() => setModalTarget(null)}
      initialFactTable={modalTarget.factTable}
      datasource={modalTarget.datasource}
      existing={
        duplicate
          ? buildFactMetricDuplicate(
              duplicate,
              permissionsUtil.canCreateOfficialResources(duplicate),
            )
          : undefined
      }
      duplicate={!!duplicate}
      source={duplicate ? `${source}-duplicate` : source}
    />
  );

  return { newFlow, ready, canOpen, button, open, edit, modal };
}
