import { useRouter } from "next/router";
import Link from "next/link";
import { useState } from "react";
import { FaChartLine, FaExternalLinkAlt, FaTimes } from "react-icons/fa";
import { FactTableInterface } from "back-end/types/fact-table";
import { getAggregateFilters, quantileMetricType } from "shared/experiments";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";

import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDefinitions } from "@/services/DefinitionsContext";
import LoadingOverlay from "@/components/LoadingOverlay";
import { GBBandit, GBCuped, GBEdit, GBExperiment } from "@/components/Icons";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import { useAuth } from "@/services/auth";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import PageHead from "@/components/Layout/PageHead";
import EditTagsForm from "@/components/Tags/EditTagsForm";
import SortedTags from "@/components/Tags/SortedTags";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import RightRailSectionGroup from "@/components/Layout/RightRailSectionGroup";
import RightRailSection from "@/components/Layout/RightRailSection";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { getPercentileLabel } from "@/services/metrics";
import MarkdownInlineEdit from "@/components/Markdown/MarkdownInlineEdit";
import Tooltip from "@/components/Tooltip/Tooltip";
import { capitalizeFirstLetter } from "@/services/utils";
import MetricName from "@/components/Metrics/MetricName";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricPriorRightRailSectionGroup from "@/components/Metrics/MetricPriorRightRailSectionGroup";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";
import MetricAnalysis from "@/components/MetricAnalysis/MetricAnalysis";
import MetricExperiments from "@/components/MetricExperiments/MetricExperiments";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/Radix/Tabs";
import DataList, { DataListItem } from "@/components/Radix/DataList";
import useOrgSettings from "@/hooks/useOrgSettings";
import { AppFeatures } from "@/types/app-features";

function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");

  if (!factTable) return <em className="text-muted">Unknown Fact Table</em>;

  return (
    <Link href={`/fact-tables/${factTable.id}`}>
      {factTable.name} <FaExternalLinkAlt />
    </Link>
  );
}

function FilterBadges({
  ids,
  factTable,
}: {
  ids: string[] | null | undefined;
  factTable?: FactTableInterface | null;
}) {
  if (!factTable || !ids) return null;

  return (
    <>
      {ids.map((id) => {
        const filter = factTable.filters.find((f) => f.id === id);
        if (!filter) return null;
        return (
          <span className="badge badge-secondary mr-2" key={filter.id}>
            {filter.name}
          </span>
        );
      })}
    </>
  );
}

function MetricType({
  type,
  quantileType,
}: {
  type: "proportion" | "mean" | "ratio" | "quantile";
  quantileType?: "" | "unit" | "event";
}) {
  if (type === "proportion") {
    return (
      <div>
        <strong>Proportion Metric</strong> - Percent of experiment users who
        exist in a Fact Table
      </div>
    );
  }
  if (type === "mean") {
    return (
      <div>
        <strong>Mean Metric</strong> - The average of a numeric value among all
        experiment users
      </div>
    );
  }
  if (type === "ratio") {
    return (
      <div>
        <strong>Ratio Metric</strong> - The ratio of two numeric values among
        experiment users
      </div>
    );
  }
  if (type === "quantile") {
    return (
      <div>
        <strong>Quantile Metric</strong> - The quantile of values{" "}
        {quantileType === "unit" ? "after aggregating per user" : ""}
      </div>
    );
  }

  return null;
}

export default function FactMetricPage() {
  const router = useRouter();
  const { fmid } = router.query;
  const [activeTab, setActiveTab] = useState("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [editTagsModal, setEditTagsModal] = useState(false);
  const [editOwnerModal, setEditOwnerModal] = useState(false);

  const { apiCall } = useAuth();

  const permissionsUtil = usePermissionsUtil();

  const settings = useOrgSettings();

  const {
    metricDefaults,
    getMinSampleSizeForMetric,
    getMinPercentageChangeForMetric,
    getMaxPercentageChangeForMetric,
  } = useOrganizationMetricDefaults();

  const {
    getFactMetricById,
    getFactTableById,
    ready,
    mutateDefinitions,
    getProjectById,
    projects,
    getDatasourceById,
  } = useDefinitions();
  const growthbook = useGrowthBook<AppFeatures>();

  if (!ready) return <LoadingOverlay />;

  const factMetric = getFactMetricById(fmid as string);

  if (!factMetric) {
    return (
      <div className="alert alert-danger">
        Could not find the requested metric.{" "}
        <Link href="/metrics">Back to all metrics</Link>
      </div>
    );
  }

  const canEdit =
    permissionsUtil.canUpdateFactMetric(factMetric, {}) &&
    !factMetric.managedBy;
  const canDelete =
    permissionsUtil.canDeleteFactMetric(factMetric) && !factMetric.managedBy;

  let regressionAdjustmentAvailableForMetric = true;
  let regressionAdjustmentAvailableForMetricReason = <></>;
  if (factMetric.metricType === "ratio") {
    regressionAdjustmentAvailableForMetric = false;
    regressionAdjustmentAvailableForMetricReason = (
      <>Not available for ratio metrics.</>
    );
  }

  const factTable = getFactTableById(factMetric.numerator.factTableId);
  const denominatorFactTable = getFactTableById(
    factMetric.denominator?.factTableId || ""
  );

  const datasource = factMetric.datasource
    ? getDatasourceById(factMetric.datasource)
    : null;

  const userFilters = getAggregateFilters({
    columnRef: factMetric.numerator,
    column:
      factMetric.numerator.aggregateFilterColumn === "$$count"
        ? `COUNT(*)`
        : `SUM(${factMetric.numerator.aggregateFilterColumn})`,
    ignoreInvalid: true,
  });

  const numeratorData: DataListItem[] = [
    {
      label: `Fact Table`,
      value: <FactTableLink id={factMetric.numerator.factTableId} />,
    },
    ...Object.entries(factMetric.numerator.inlineFilters || {})
      .filter(([, v]) => v.some((v) => !!v))
      .map(([k, v]) => {
        const columnName =
          factTable?.columns.find((c) => c.column === k)?.name || k;
        return {
          label: columnName,
          value: v.join(" OR "),
        };
      }),
    {
      label: `Row Filter`,
      value:
        factMetric.numerator.filters.length > 0 ? (
          <FilterBadges
            factTable={factTable}
            ids={factMetric.numerator.filters}
          />
        ) : (
          <em>None</em>
        ),
    },
    ...(factMetric.metricType !== "proportion"
      ? [
          {
            label: `Value`,
            value:
              factMetric.numerator.column === "$$count"
                ? "Count of Rows"
                : factMetric.numerator.column === "$$distinctUsers"
                ? "Unique Users"
                : factMetric.numerator.column,
          },
        ]
      : []),
    ...(!factMetric.numerator.column.startsWith("$$") &&
    (factMetric.metricType !== "quantile" ||
      factMetric.quantileSettings?.type === "unit")
      ? [
          {
            label: "Per-User Aggregation",
            value: "SUM",
          },
        ]
      : userFilters.length > 0
      ? [
          {
            label: "User Filter",
            value: userFilters.join(" AND "),
          },
        ]
      : []),
    ...(factMetric.metricType === "quantile"
      ? [
          {
            label: "Quantile Scope",
            value: factMetric.quantileSettings?.type,
          },
          {
            label: "Ignore Zeros",
            value: factMetric.quantileSettings?.ignoreZeros ? "Yes" : "No",
          },
          {
            label: "Quantile",
            value: getPercentileLabel(
              factMetric.quantileSettings?.quantile ?? 0.5
            ),
          },
        ]
      : []),
  ];

  const denominatorData: DataListItem[] =
    factMetric.metricType === "ratio" &&
    factMetric.denominator &&
    denominatorFactTable
      ? [
          {
            label: `Fact Table`,
            value: <FactTableLink id={factMetric.denominator.factTableId} />,
          },
          ...Object.entries(factMetric.denominator.inlineFilters || {})
            .filter(([, v]) => v.some((v) => !!v))
            .map(([k, v]) => {
              const columnName =
                denominatorFactTable?.columns.find((c) => c.column === k)
                  ?.name || k;
              return {
                label: columnName,
                value: v.join(" OR "),
              };
            }),
          {
            label: `Row Filter`,
            value:
              factMetric.denominator.filters.length > 0 ? (
                <FilterBadges
                  factTable={denominatorFactTable}
                  ids={factMetric.denominator.filters}
                />
              ) : (
                <em>None</em>
              ),
          },
          {
            label: `Value`,
            value:
              factMetric.denominator.column === "$$count"
                ? "Count of Rows"
                : factMetric.denominator.column === "$$distinctUsers"
                ? "Unique Users"
                : factMetric.denominator.column,
          },
          ...(!factMetric.denominator.column.startsWith("$$")
            ? [
                {
                  label: "Per-User Aggregation",
                  value: "SUM",
                },
              ]
            : []),
        ]
      : [];

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v)}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="usage">Usage</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <MetricOverview />
      </TabsContent>
      <TabsContent value="usage">
        <MetricUsage />
      </TabsContent>
      <TabsContent value="history">
        <MetricHistory />
      </TabsContent>
    </Tabs>
  );
}
