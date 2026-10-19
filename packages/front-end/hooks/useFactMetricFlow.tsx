import { useCallback, useState } from "react";
import { useRouter } from "next/router";
import { useFeatureIsOn, useGrowthBook } from "@growthbook/growthbook-react";
import {
  FactMetricInterface,
  FactTableInterface,
  StandardFactMetricInterface,
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
import MetricWorkspace from "@/components/FactTables/MetricEditor/MetricWorkspace";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import TemplateFieldMapping from "@/components/FactTables/MetricEditor/TemplateFieldMapping";
import {
  parseMetricTemplate,
  TemplateMetric,
} from "@/components/FactTables/MetricEditor/templateMetric";
import { useUser } from "@/services/UserContext";
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
  template?: string;
};

type ModalTarget = FactMetricCreationTarget & {
  edit?: FactMetricInterface;
  source: string;
  templateMetric?: TemplateMetric;
  mappedTemplate?: Partial<StandardFactMetricInterface>;
};

// Owns experiment routing, prerequisites, and permissions for metric entry points.
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
    mutateDefinitions,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();
  const ready = flagReady && definitionsReady;
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [tableTarget, setTableTarget] = useState<ModalTarget | null>(null);
  const [createdTable, setCreatedTable] = useState<FactTableInterface | null>(
    null,
  );
  const [actionsContainer, setActionsContainer] =
    useState<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const creation = (target: FactMetricCreationTarget) => {
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
      returnUrl: target.template ? "/metrics" : router.asPath,
      source: target.duplicate ? `${source}-duplicate` : source,
    });
    if (target.factTable) params.set("factTable", target.factTable);
    if (target.duplicate) params.set("duplicate", target.duplicate.id);
    if (target.datasource) params.set("datasource", target.datasource);
    if (target.template) params.set("addMetric", target.template);
    return {
      mode,
      disabledReason,
      permissionError: ready && !canCreate ? disabledReason : null,
      label: mode === "fact-table" ? "Create Fact Table" : "Add Fact Metric",
      href:
        mode === "page"
          ? `/fact-metrics/new?${params}`
          : mode === "fact-table" && !embedded && !target.template
            ? "/fact-tables"
            : null,
      source: params.get("source") || source,
    };
  };

  const open = (target: FactMetricCreationTarget = {}) => {
    const action = creation(target);
    if (action.mode === "pending") return false;
    if (action.disabledReason) {
      setError(action.disabledReason);
      return true;
    }
    if (action.href) {
      if (target.template) void router.replace(action.href);
      else void router.push(action.href);
    } else {
      let templateMetric: TemplateMetric | undefined;
      if (target.template) {
        try {
          templateMetric = parseMetricTemplate(target.template);
          if (
            (templateMetric.metricType === "quantile" &&
              !hasCommercialFeature("quantile-metrics")) ||
            (templateMetric.metricType === "retention" &&
              !hasCommercialFeature("retention-metrics"))
          ) {
            throw new Error("Your plan does not support this metric type.");
          }
        } catch (error) {
          setError(error.message);
          return true;
        }
      }
      const modalTarget = { ...target, source: action.source, templateMetric };
      if (action.mode === "fact-table") {
        setTableTarget(modalTarget);
      } else {
        setModalTarget(modalTarget);
        if (target.template) {
          const query = { ...router.query };
          delete query.addMetric;
          void router.replace({ pathname: router.pathname, query }, undefined, {
            shallow: true,
          });
        }
      }
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
    } = {},
    beforeOpen?: () => void,
  ) => {
    const action = creation(target);
    const { children, showPermissionError, ...buttonProps } = props;
    const label = children ?? action.label;
    const button = action.disabledReason ? (
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
        {showPermissionError && action.permissionError && (
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
  const template = !modalTarget?.mappedTemplate
    ? modalTarget?.templateMetric
    : null;
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
          setError(
            "You don't have permission to add Fact Metrics to this Fact Table.",
          );
          return;
        }
        setModalTarget({ ...tableTarget, factTable: factTable.id });
        if (tableTarget.template) {
          const query = { ...router.query };
          delete query.addMetric;
          void router.replace({ pathname: router.pathname, query }, undefined, {
            shallow: true,
          });
        }
      }}
    />
  ) : error || template ? (
    <Modal.Root
      open
      onOpenChange={close}
      hasDescription={false}
      trackingEventModalType=""
    >
      <Modal.Header>
        <Modal.Title>
          {error
            ? "Create Fact Metric"
            : "Map Template Fields to Your Fact Table"}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error ? (
          <Callout status="error">{error}</Callout>
        ) : (
          template && (
            <TemplateFieldMapping
              template={template}
              hideHeading
              onCancel={close}
              onMapped={(mapped) => {
                if (mapped.metricType === "funnel" || !mapped.numerator) return;
                const mappedTemplate: Partial<StandardFactMetricInterface> = {
                  ...mapped,
                  metricType: mapped.metricType,
                  numerator: mapped.numerator,
                  funnelSettings: null,
                };
                setModalTarget((current) =>
                  current ? { ...current, mappedTemplate } : null,
                );
              }}
            />
          )
        )}
      </Modal.Body>
      {error && (
        <Modal.Footer>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </Modal.Footer>
      )}
    </Modal.Root>
  ) : !modalTarget ? null : embedded && newFlow ? (
    <Modal.Root
      open
      onOpenChange={() => {}}
      size="xl"
      hasDescription={false}
      trackingEventModalType=""
    >
      <Modal.Header>
        <Modal.Title>Create Fact Metric</Modal.Title>
        <div ref={setActionsContainer} />
      </Modal.Header>
      <Modal.Body>
        <MetricWorkspace
          embedded
          existing={null}
          initialFactTable={
            factTables.find((table) => table.id === modalTarget.factTable) ??
            createdTable
          }
          initialDatasource={modalTarget.datasource}
          isEditing
          actionsContainer={actionsContainer}
          mutate={mutateDefinitions}
          onSaved={close}
          onCancel={close}
          source={modalTarget.source}
        />
      </Modal.Body>
    </Modal.Root>
  ) : (
    <FactMetricModal
      close={close}
      initialFactTable={
        modalTarget.factTable ??
        modalTarget.mappedTemplate?.numerator?.factTableId
      }
      datasource={modalTarget.datasource}
      existing={
        modalTarget.edit ??
        modalTarget.mappedTemplate ??
        (duplicate
          ? duplicateFactMetric(
              duplicate,
              permissionsUtil.canCreateOfficialResources(duplicate),
            )
          : undefined)
      }
      duplicate={!!duplicate || !!modalTarget.templateMetric}
      source={modalTarget.source}
    />
  );

  return {
    createButton,
    open,
    edit,
    editDisabledReason: ready ? null : "Loading metric creation…",
    modal,
  };
}
