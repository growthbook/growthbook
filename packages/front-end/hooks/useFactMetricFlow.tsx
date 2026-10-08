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

type ModalTarget = FactMetricCreationTarget & { edit?: FactMetricInterface };

// Every fact metric "Add metric", "Duplicate", and "Edit" entry point goes
// through here, so the new-metric-creation-flow experiment switches all of
// them at once: the new full-page editor, or the old FactMetricModal opened
// in place with the same props and tracking `source` it had before.
export default function useFactMetricFlow(source: string) {
  const newFlow = useFeatureIsOn("new-metric-creation-flow");
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);

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

  const edit = (metric: FactMetricInterface) => {
    if (newFlow) router.push(`/fact-metrics/${metric.id}?edit=true`);
    else setModalTarget({ edit: metric });
  };

  const duplicate = modalTarget?.duplicate;
  const modal = !modalTarget ? null : modalTarget.edit ? (
    <FactMetricModal
      close={() => setModalTarget(null)}
      existing={modalTarget.edit}
      source={source}
    />
  ) : (
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
  );

  return { newFlow, href, open, edit, modal };
}
