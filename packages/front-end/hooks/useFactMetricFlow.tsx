import { useCallback, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import {
  FactMetricInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { isProjectListValidForProject } from "shared/util";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  duplicateFactMetric,
  resolveFactMetricCreation,
} from "@/services/metrics";
import { envAllowsCreatingMetrics } from "@/services/env";
import FactTableModal from "@/components/FactTables/FactTableModal";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import Modal from "@/ui/Modal";
import Callout from "@/ui/Callout";
import Button, { Props as ButtonProps } from "@/ui/Button";
import LinkButton from "@/ui/LinkButton";
import Tooltip from "@/ui/Tooltip";

type FactMetricCreationTarget = {
  factTable?: string;
  duplicate?: FactMetricInterface;
  datasource?: string;
  project?: string;
};

type ModalTarget = FactMetricCreationTarget & {
  edit?: FactMetricInterface;
  source: string;
};

export default function useFactMetricFlow(
  source: string,
  {
    onInlineEdit,
    embedded = false,
  }: { onInlineEdit?: (source: string) => void; embedded?: boolean } = {},
) {
  const newFlow = useFeatureIsOn("new-metric-creation-flow");
  const flagReady = !!useGrowthBook()?.ready;
  const router = useRouter();
  const permissionsUtil = usePermissionsUtil();
  const {
    factTables,
    project,
    projects,
    ready: definitionsReady,
  } = useDefinitions();
  const ready = flagReady && definitionsReady;
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [tableTarget, setTableTarget] = useState<ModalTarget | null>(null);
  const [createdTable, setCreatedTable] = useState<FactTableInterface | null>(
    null,
  );
  // Titled by the step that failed, matching the button label.
  const [error, setError] = useState<{
    title: string;
    message: string;
  } | null>(null);

  const creation = (target: FactMetricCreationTarget = {}) => {
    const targetProject = target.project ?? project;
    const factTableId =
      target.factTable ??
      target.duplicate?.numerator?.factTableId ??
      target.duplicate?.funnelSettings?.steps[0]?.factTableId;
    const table = (
      createdTable ? [createdTable, ...factTables] : factTables
    ).find((table) =>
      factTableId
        ? table.id === factTableId
        : (!target.datasource || table.datasource === target.datasource) &&
          isProjectListValidForProject(table.projects, targetProject),
    );
    const mode = resolveFactMetricCreation(ready, newFlow, !!table, embedded);
    const canCreate =
      mode === "fact-table"
        ? permissionsUtil.canViewCreateFactTableModal(targetProject, projects)
        : permissionsUtil.canCreateFactMetric({
            projects: factTableId
              ? (table?.projects ?? [])
              : targetProject
                ? [targetProject]
                : [],
          });
    const disabledReason = !ready
      ? "Loading metric creation…"
      : !envAllowsCreatingMetrics()
        ? "Metric creation is disabled."
        : !canCreate
          ? mode === "fact-table"
            ? "You don't have permission to create a Fact Table in this Project."
            : "You don't have permission to add Fact Metrics in this Project."
          : null;
    const params = new URLSearchParams({
      returnUrl: router.asPath,
      source: target.duplicate ? `${source}-duplicate` : source,
    });
    if (target.factTable) params.set("factTable", target.factTable);
    if (target.duplicate) params.set("duplicate", target.duplicate.id);
    if (target.datasource) params.set("datasource", target.datasource);
    return {
      mode,
      disabledReason,
      permissionError: ready && !canCreate ? disabledReason : null,
      label: mode === "fact-table" ? "Create Fact Table" : "Add Fact Metric",
      href:
        mode === "page"
          ? `/fact-metrics/new?${params}`
          : mode === "fact-table" && !embedded
            ? "/fact-tables"
            : null,
      source: params.get("source") || source,
    };
  };

  const open = (target: FactMetricCreationTarget = {}) => {
    const action = creation(target);
    if (action.mode === "pending") return false;
    if (action.disabledReason) {
      setError({ title: action.label, message: action.disabledReason });
      return true;
    }
    if (action.href) {
      void router.push(action.href);
    } else {
      const modalTarget = { ...target, source: action.source };
      if (action.mode === "fact-table") setTableTarget(modalTarget);
      else setModalTarget(modalTarget);
    }
    return true;
  };

  const edit = useCallback(
    (metric: FactMetricInterface, editSource = source) => {
      if (!ready) return false;
      if (newFlow) {
        if (onInlineEdit) onInlineEdit(editSource);
        else {
          const params = new URLSearchParams({
            edit: "true",
            source: editSource,
          });
          void router.push(`/fact-metrics/${metric.id}?${params}`);
        }
      } else {
        setModalTarget({ edit: metric, source: editSource });
      }
      return true;
    },
    [ready, newFlow, onInlineEdit, router, source],
  );

  const createButton = (
    target: FactMetricCreationTarget = {},
    props: Omit<ButtonProps, "onClick" | "disabled" | "children"> & {
      children?: ButtonProps["children"];
      showPermissionError?: boolean;
      // The caller shows disabledReason itself, so skip the tooltip.
      hideTooltip?: boolean;
    } = {},
    beforeOpen?: () => void,
  ) => {
    const action = creation(target);
    const { children, showPermissionError, hideTooltip, ...buttonProps } =
      props;
    const label = children ?? action.label;
    const permissionCallout = showPermissionError && action.permissionError;
    // The callout already explains a permission block, so skip the tooltip.
    const button =
      action.disabledReason && (hideTooltip || permissionCallout) ? (
        <Button {...buttonProps} disabled>
          {label}
        </Button>
      ) : action.disabledReason ? (
        <Tooltip content={action.disabledReason}>
          <span style={{ cursor: "not-allowed" }}>
            <Button
              {...buttonProps}
              disabled
              style={{ ...buttonProps.style, pointerEvents: "none" }}
            >
              {label}
            </Button>
          </span>
        </Tooltip>
      ) : action.href && !beforeOpen ? (
        <LinkButton {...buttonProps} href={action.href}>
          {label}
        </LinkButton>
      ) : (
        <Button
          {...buttonProps}
          onClick={() => {
            beforeOpen?.();
            open(target);
          }}
        >
          {label}
        </Button>
      );
    return (
      <>
        {permissionCallout && (
          <Callout status="info" mb="3">
            {action.permissionError}
          </Callout>
        )}
        {button}
      </>
    );
  };

  const close = () => {
    setModalTarget(null);
    setTableTarget(null);
    setError(null);
  };
  const duplicate = modalTarget?.duplicate;
  const modal = tableTarget ? (
    <FactTableModal
      close={() => setTableTarget(null)}
      initialDatasource={tableTarget.datasource}
      onCreate={(factTable) => {
        setCreatedTable(factTable);
        setTableTarget(null);
        if (
          !permissionsUtil.canCreateFactMetric({
            projects: factTable.projects,
          })
        ) {
          setError({
            title: "Add Fact Metric",
            message:
              "You don't have permission to add Fact Metrics to this Fact Table.",
          });
          return;
        }
        setModalTarget({ ...tableTarget, factTable: factTable.id });
      }}
    />
  ) : error ? (
    <Modal.Root
      open
      onOpenChange={close}
      hasDescription={false}
      trackingEventModalType=""
    >
      <Modal.Header>
        <Modal.Title>{error.title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Callout status="error">{error.message}</Callout>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close>
          <Button variant="ghost" onClick={close}>
            Close
          </Button>
        </Modal.Close>
      </Modal.Footer>
    </Modal.Root>
  ) : !modalTarget ? null : (
    <FactMetricModal
      close={close}
      initialFactTable={modalTarget.factTable}
      datasource={modalTarget.datasource}
      existing={
        modalTarget.edit ??
        (duplicate
          ? duplicateFactMetric(
              duplicate,
              permissionsUtil.canCreateOfficialResources(duplicate),
            )
          : undefined)
      }
      duplicate={!!duplicate}
      source={modalTarget.source}
    />
  );

  return {
    creation,
    createButton,
    open,
    edit,
    editDisabledReason: ready ? null : "Loading metric editor…",
    modal,
  };
}
