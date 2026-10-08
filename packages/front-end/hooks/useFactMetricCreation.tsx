import { useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import { FactMetricInterface } from "shared/types/fact-table";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import FactMetricModal from "@/components/FactTables/FactMetricModal";

export type FactMetricCreationTarget = {
  factTable?: string;
  duplicate?: FactMetricInterface;
  datasource?: string;
};

// Every "Add metric" / "Duplicate" entry point goes through here, so the
// new-metric-creation-flow experiment switches all of them at once: the new
// full-page editor (/fact-metrics/new) or the old FactMetricModal, opened in
// place with the same props and tracking `source` it had before.
export default function useFactMetricCreation(source: string) {
  const newFlow = useFeatureIsOn("new-metric-creation-flow");
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const [modalTarget, setModalTarget] =
    useState<FactMetricCreationTarget | null>(null);

  const sourceFor = (target: FactMetricCreationTarget) =>
    target.duplicate ? `${source}-duplicate` : source;

  const href = (target: FactMetricCreationTarget = {}) => {
    const params = new URLSearchParams({
      returnUrl: router.asPath,
      // Lets the page report the same tracking source as the modal.
      source: sourceFor(target),
    });
    if (target.factTable) params.set("factTable", target.factTable);
    if (target.duplicate) params.set("duplicate", target.duplicate.id);
    return `/fact-metrics/new?${params.toString()}`;
  };

  const open = (target: FactMetricCreationTarget = {}) => {
    if (newFlow) router.push(href(target));
    else setModalTarget(target);
  };

  const duplicate = modalTarget?.duplicate;
  const modal = modalTarget ? (
    <FactMetricModal
      close={() => setModalTarget(null)}
      initialFactTable={modalTarget.factTable}
      datasource={modalTarget.datasource}
      existing={
        duplicate
          ? {
              ...duplicate,
              name: `${duplicate.name} (copy)`,
              // Only an admin-managed copy the user could create themselves
              // stays official; anything else saves as an ordinary metric.
              managedBy:
                duplicate.managedBy === "admin" &&
                permissionsUtil.canCreateOfficialResources(duplicate)
                  ? "admin"
                  : "",
            }
          : undefined
      }
      duplicate={!!duplicate}
      source={sourceFor(modalTarget)}
    />
  ) : null;

  return { newFlow, href, open, modal };
}
