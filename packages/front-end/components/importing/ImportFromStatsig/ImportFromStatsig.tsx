import React, { useEffect, useMemo, useState } from "react";
import { FaTriangleExclamation } from "react-icons/fa6";
import { FaCheck, FaMinusCircle, FaExchangeAlt } from "react-icons/fa";
import { MdPending } from "react-icons/md";
import { FeatureInterface } from "shared/types/feature";
import { ProjectInterface } from "shared/types/project";
import {
  buildImportedData,
  runImport,
  BuildImportedDataOptions,
  RunImportOptions,
} from "@/services/importing/statsig/statsig-importing";
import { ImportStatus, ImportData } from "@/services/importing/statsig/types";
import Field from "@/components/Forms/Field";
import Tooltip from "@/components/Tooltip/Tooltip";
import Button from "@/components/Button";
import Checkbox from "@/ui/Checkbox";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import {
  useEnvironments,
  useAttributeSchema,
  useFeaturesListWithValues,
} from "@/services/features";
import Switch from "@/ui/Switch";
import { useExperiments } from "@/hooks/useExperiments";
import { useUser } from "@/services/UserContext";
import { useSessionStorage } from "@/hooks/useSessionStorage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import LoadingSpinner from "@/components/LoadingSpinner";
import track from "@/services/track";
import { isCloud } from "@/services/env";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import { EntityAccordion, EntityAccordionContent } from "./EntityAccordion";

function HasChangesIcon({
  hasChanges,
  entityId,
  onToggle,
}: {
  hasChanges?: boolean;
  entityId: string;
  onToggle: (id: string) => void;
}) {
  // Show icon only if there are changes
  if (!hasChanges) {
    return null;
  }

  const tooltipText = "This item has changes from the existing version";

  return (
    <Tooltip body={tooltipText}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(entityId);
        }}
        className="btn btn-link p-0 ml-2"
        style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          padding: 0,
          lineHeight: 1,
          verticalAlign: "middle",
        }}
      >
        <FaExchangeAlt size={14} style={{ opacity: 0.7 }} />
      </button>
    </Tooltip>
  );
}

function ImportStatusDisplay({
  data,
  enabled = true,
}: {
  data: {
    status: ImportStatus;
    exists?: boolean;
    error?: string;
    hasChanges?: boolean;
  };
  enabled?: boolean;
}) {
  // If disabled (checkbox unchecked), show skip status
  if (!enabled) {
    return (
      <Tooltip
        body={
          <div>
            <strong>skip</strong> {data.error ? <>: {data.error}</> : null}
          </div>
        }
      >
        <span className="text-secondary mr-3">
          <FaMinusCircle />
          <span className="ml-1">skip</span>
        </span>
      </Tooltip>
    );
  }

  const statusText =
    data.status === "pending"
      ? data.exists
        ? "update"
        : "create"
      : data.status === "completed"
        ? data.exists
          ? "updated"
          : "created"
        : data.status === "failed"
          ? data.exists
            ? "failed to update"
            : "failed to create"
          : data.status;

  const color =
    data.status === "failed" || data.status === "invalid"
      ? "danger"
      : data.status === "completed"
        ? "success"
        : data.status === "skipped"
          ? "secondary"
          : "info";

  return (
    <Tooltip
      body={
        <div>
          <strong>{statusText}</strong>{" "}
          {data.error ? <>: {data.error}</> : null}
        </div>
      }
    >
      <span className={`text-${color} mr-3`}>
        {data.status === "invalid" || data.status === "failed" ? (
          <FaTriangleExclamation />
        ) : data.status === "skipped" ? (
          <FaMinusCircle />
        ) : data.status === "pending" ? (
          <MdPending />
        ) : data.status === "completed" ? (
          <FaCheck />
        ) : null}
        <span className="ml-1">{statusText}</span>
      </span>
    </Tooltip>
  );
}

function ImportHeader({
  name,
  items,
  beta,
  checkboxState,
  onCategoryToggle,
}: {
  name: string;
  items: { status: ImportStatus }[];
  beta?: boolean;
  checkboxState: boolean | "indeterminate";
  onCategoryToggle: (enabled: boolean) => void;
}) {
  const countsByStatus = items.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    },
    {} as Record<ImportStatus, number>,
  );

  return (
    <div className="bg-light p-3 border-bottom">
      <div className="row">
        <div className="col-auto" style={{ minWidth: 300 }}>
          <div className="d-flex align-items-center">
            <Checkbox
              value={checkboxState}
              setValue={onCategoryToggle}
              label={name}
              size="sm"
              containerClassName="mr-2"
            />
            {beta ? (
              <span className="ml-1 badge badge-warning badge-pill">Beta</span>
            ) : null}
          </div>
        </div>
        <div className="col-auto mr-4">
          <strong>{items.length}</strong> total
        </div>
        <div className="col-auto">
          <span className="badge badge-info badge-pill">
            {countsByStatus["pending"] || 0}
          </span>{" "}
          pending
        </div>
        <div className="col-auto">
          <span className="badge badge-secondary badge-pill">
            {countsByStatus["skipped"] || 0}
          </span>{" "}
          skipped
        </div>
        <div className="col-auto">
          <span className="badge badge-success badge-pill">
            {countsByStatus["completed"] || 0}
          </span>{" "}
          imported
        </div>
        <div className="col-auto">
          <span className="badge badge-danger badge-pill">
            {(countsByStatus["failed"] || 0) + (countsByStatus["invalid"] || 0)}
          </span>{" "}
          failed
        </div>
      </div>
    </div>
  );
}

export default function ImportFromStatsig() {
  const [token, setToken] = useSessionStorage("ssApiToken", "");
  const [intervalCap, setIntervalCap] = useState(50);
  const [data, setData] = useState<ImportData>({
    status: "init",
  });
  const dataStr = JSON.stringify(data);
  const [featuresMap, setFeaturesMap] = useState<Map<
    string,
    FeatureInterface
  > | null>(null);
  const [expandedAccordions, setExpandedAccordions] = useState<Set<string>>(
    new Set(),
  );
  const [projectName, setProjectName] = useLocalStorage(
    "statsig_import_project",
    "",
  );
  const [skipAttributeMapping, setSkipAttributeMapping] = useLocalStorage(
    "statsig_skip_attribute_mapping",
    false,
  );
  const [useBackendProxy, setUseBackendProxy] = useLocalStorage(
    "statsig_use_backend_proxy",
    false,
  );

  const { datasources, getDatasourceById } = useDefinitions();
  const dataSourceOptions = datasources.map((ds) => ({
    label: ds.name,
    value: ds.id,
  }));
  const [dataSource, setDataSource] = useState<string | undefined>(
    datasources[0]?.id,
  );

  // Force useBackendProxy to false for cloud users
  useEffect(() => {
    if (isCloud() && useBackendProxy) {
      setUseBackendProxy(false);
    }
  }, [useBackendProxy, setUseBackendProxy]);

  // Item-level checkbox states (all enabled by default)
  const [itemEnabled, setItemEnabled] = useState<{
    [category: string]: { [key: string]: boolean };
  }>({});

  // Tag filtering state
  const [selectByTags, setSelectByTags] = useLocalStorage<string[]>(
    "statsig_select_by_tags",
    [],
  );

  // New/updated filtering state
  const [filterNewItems, setFilterNewItems] = useLocalStorage<boolean>(
    "statsig_filter_new",
    false,
  );
  const [filterUpdatedItems, setFilterUpdatedItems] = useLocalStorage<boolean>(
    "statsig_filter_updated",
    false,
  );
  const [filterUpdatedWithChanges, setFilterUpdatedWithChanges] =
    useLocalStorage<boolean>("statsig_filter_updated_with_changes", false);

  const toggleAccordion = (id: string) => {
    setExpandedAccordions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Helper function to get item key for checkbox state
  const getItemKey = (
    category: string,
    index: number,
    item: unknown,
  ): string => {
    switch (category) {
      case "environments": {
        const envItem = item as { environment?: { name?: string } };
        return `env-${envItem.environment?.name || index}`;
      }
      case "tags": {
        const tagItem = item as { tag?: { name?: string; id?: string } };
        return `tag-${tagItem.tag?.name || tagItem.tag?.id || index}`;
      }
      case "segments": {
        const segmentItem = item as {
          segment?: { name?: string; id?: string };
        };
        return `segment-${segmentItem.segment?.name || segmentItem.segment?.id || index}`;
      }
      case "featureGates": {
        const gateItem = item as { featureGate?: { id?: string } };
        return `gate-${gateItem.featureGate?.id || index}`;
      }
      case "dynamicConfigs": {
        const configItem = item as { dynamicConfig?: { id?: string } };
        return `config-${configItem.dynamicConfig?.id || index}`;
      }
      case "experiments": {
        const expItem = item as { experiment?: { name?: string; id?: string } };
        return `exp-${expItem.experiment?.name || expItem.experiment?.id || index}`;
      }
      case "metrics": {
        const metricItem = item as { metric?: { name?: string } };
        return `metric-${metricItem.metric?.name || index}`;
      }
      case "metricSources": {
        const sourceItem = item as {
          metricSource?: { name: string };
        };
        return `metricSource-${sourceItem.metricSource?.name || index}`;
      }
      default:
        return `${category}-${index}`;
    }
  };

  // Helper function to get all unique tags from all items
  const getAllTags = useMemo((): string[] => {
    if (data.status !== "ready" && data.status !== "completed") return [];

    const tagSet = new Set<string>();

    // Get tags from feature gates
    data.featureGates?.forEach((gate) => {
      gate.featureGate?.tags?.forEach((tag) => tagSet.add(tag));
    });

    // Get tags from dynamic configs
    data.dynamicConfigs?.forEach((config) => {
      config.dynamicConfig?.tags?.forEach((tag) => tagSet.add(tag));
    });

    // Get tags from experiments
    data.experiments?.forEach((exp) => {
      exp.experiment?.tags?.forEach((tag) => tagSet.add(tag));
    });

    // Get tags from metrics
    data.metrics?.forEach((metric) => {
      metric.metric?.tags?.forEach((tag) => tagSet.add(tag));
    });

    return Array.from(tagSet).sort();
  }, [data]);

  // Helper function to check if an item matches the selected tags
  const itemMatchesTags = (category: string, item: unknown): boolean => {
    // If no tags selected, show all items
    if (selectByTags.length === 0) return true;

    let itemTags: string[] = [];

    switch (category) {
      case "featureGates": {
        const gateItem = item as { featureGate?: { tags?: string[] } };
        itemTags = gateItem.featureGate?.tags || [];
        break;
      }
      case "dynamicConfigs": {
        const configItem = item as { dynamicConfig?: { tags?: string[] } };
        itemTags = configItem.dynamicConfig?.tags || [];
        break;
      }
      case "experiments": {
        const expItem = item as { experiment?: { tags?: string[] } };
        itemTags = expItem.experiment?.tags || [];
        break;
      }
      case "metrics": {
        const metricItem = item as { metric?: { tags?: string[] } };
        itemTags = metricItem.metric?.tags || [];
        break;
      }
      default:
        // For categories without tags (environments, tags, segments, metricSources),
        // show them if no tags are selected, or hide them if tags are selected
        return selectByTags.length === 0;
    }

    // Check if item has any of the selected tags
    return itemTags.some((tag) => selectByTags.includes(tag));
  };

  // Helper function to check if an item matches the new/updated filter
  const itemMatchesNewUpdatedFilter = (item: unknown): boolean => {
    // If no filters enabled, show all items
    if (!filterNewItems && !filterUpdatedItems) return true;

    const importItem = item as {
      exists?: boolean;
      hasChanges?: boolean;
    };

    const isNew = !importItem.exists;
    const isUpdated = !!importItem.exists;
    const hasDiffs = importItem.hasChanges === true;

    // Updated items gate controls the "with changes" subset
    const updatedMatch =
      filterUpdatedItems &&
      isUpdated &&
      (filterUpdatedWithChanges ? hasDiffs : true);

    // New items are independent
    const newMatch = filterNewItems && isNew;

    return newMatch || updatedMatch;
  };

  // Helper function to count new items (respecting tag filter)
  const getNewItemsCount = (): number => {
    if (data.status !== "ready" && data.status !== "completed") return 0;

    let count = 0;
    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.environments)
      allItems.push({ category: "environments", items: data.environments });
    if (data.tags) allItems.push({ category: "tags", items: data.tags });
    if (data.segments)
      allItems.push({ category: "segments", items: data.segments });
    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });
    if (data.metricSources)
      allItems.push({ category: "metricSources", items: data.metricSources });

    allItems.forEach(({ category, items }) => {
      items.forEach((item) => {
        // Check tag filter
        if (!itemMatchesTags(category, item)) return;

        // Check if new
        const importItem = item as { exists?: boolean };
        if (!importItem.exists) {
          count++;
        }
      });
    });

    return count;
  };

  // Helper function to count updated items (respecting tag filter)
  const getUpdatedItemsCount = (): number => {
    if (data.status !== "ready" && data.status !== "completed") return 0;

    let count = 0;
    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.environments)
      allItems.push({ category: "environments", items: data.environments });
    if (data.tags) allItems.push({ category: "tags", items: data.tags });
    if (data.segments)
      allItems.push({ category: "segments", items: data.segments });
    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });
    if (data.metricSources)
      allItems.push({ category: "metricSources", items: data.metricSources });

    allItems.forEach(({ category, items }) => {
      items.forEach((item) => {
        // Check tag filter
        if (!itemMatchesTags(category, item)) return;

        // Updated == exists true
        const importItem = item as { exists?: boolean };
        if (importItem.exists) {
          count++;
        }
      });
    });

    return count;
  };

  // Helper function to count updated items with changes (respecting tag filter)
  const getUpdatedItemsWithChangesCount = (): number => {
    if (data.status !== "ready" && data.status !== "completed") return 0;

    let count = 0;
    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.environments)
      allItems.push({ category: "environments", items: data.environments });
    if (data.tags) allItems.push({ category: "tags", items: data.tags });
    if (data.segments)
      allItems.push({ category: "segments", items: data.segments });
    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });
    if (data.metricSources)
      allItems.push({ category: "metricSources", items: data.metricSources });

    allItems.forEach(({ category, items }) => {
      items.forEach((item) => {
        // Check tag filter
        if (!itemMatchesTags(category, item)) return;

        // Updated with changes
        const importItem = item as { exists?: boolean; hasChanges?: boolean };
        if (importItem.exists && importItem.hasChanges === true) {
          count++;
        }
      });
    });

    return count;
  };

  // Helper function to count items for a specific tag
  const getTagItemCount = (tag: string): number => {
    if (data.status !== "ready" && data.status !== "completed") return 0;

    let count = 0;
    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });

    allItems.forEach(({ category, items }) => {
      items.forEach((item) => {
        let itemTags: string[] = [];

        switch (category) {
          case "featureGates": {
            const gateItem = item as { featureGate?: { tags?: string[] } };
            itemTags = gateItem.featureGate?.tags || [];
            break;
          }
          case "dynamicConfigs": {
            const configItem = item as { dynamicConfig?: { tags?: string[] } };
            itemTags = configItem.dynamicConfig?.tags || [];
            break;
          }
          case "experiments": {
            const expItem = item as { experiment?: { tags?: string[] } };
            itemTags = expItem.experiment?.tags || [];
            break;
          }
          case "metrics": {
            const metricItem = item as { metric?: { tags?: string[] } };
            itemTags = metricItem.metric?.tags || [];
            break;
          }
        }

        if (itemTags.includes(tag)) {
          count++;
        }
      });
    });

    return count;
  };

  // Helper function to check if an item is enabled
  const isItemEnabled = (
    category: string,
    index: number,
    item: unknown,
  ): boolean => {
    // First check tag filter (AND)
    if (!itemMatchesTags(category, item)) return false;

    // Then check new/updated filter (AND)
    if (!itemMatchesNewUpdatedFilter(item)) return false;

    const key = getItemKey(category, index, item);
    return itemEnabled[category]?.[key] ?? true; // Default to enabled
  };

  // Helper function to get the effective checkbox state
  const getEffectiveCheckboxState = (
    category: string,
    index: number,
    item: unknown,
  ): boolean => {
    return isItemEnabled(category, index, item);
  };

  // Helper function to toggle item enabled state
  const toggleItemEnabled = (
    category: string,
    index: number,
    item: unknown,
    enabled: boolean,
  ) => {
    const key = getItemKey(category, index, item);
    setItemEnabled((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [key]: enabled,
      },
    }));
  };

  // Helper function to get category checkbox state (boolean or "indeterminate")
  const getCategoryCheckboxState = (
    category: string,
    items: unknown[],
  ): boolean | "indeterminate" => {
    if (!items || items.length === 0) {
      return false;
    }

    const enabledCount = items.filter((item, index) =>
      getEffectiveCheckboxState(category, index, item),
    ).length;

    if (enabledCount === 0) {
      return false;
    } else if (enabledCount === items.length) {
      return true;
    } else {
      return "indeterminate";
    }
  };

  // Helper function to toggle all items in a category
  const toggleCategoryItems = (
    category: string,
    items: unknown[] | undefined,
    enabled: boolean,
  ) => {
    if (!items) return;

    const updates: { [key: string]: boolean } = {};
    items.forEach((item, index) => {
      const key = getItemKey(category, index, item);
      updates[key] = enabled;
    });

    setItemEnabled((prev) => ({
      ...prev,
      [category]: {
        ...prev[category],
        ...updates,
      },
    }));
  };

  // Helper function to get global checkbox state (true/false/indeterminate)
  const getGlobalCheckboxState = (): boolean | "indeterminate" => {
    // Allow selection when ready or after import completes (to allow re-running)
    if (data.status !== "ready" && data.status !== "completed") return false;

    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.environments)
      allItems.push({ category: "environments", items: data.environments });
    if (data.tags) allItems.push({ category: "tags", items: data.tags });
    if (data.segments)
      allItems.push({ category: "segments", items: data.segments });
    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });
    if (data.metricSources)
      allItems.push({ category: "metricSources", items: data.metricSources });

    if (allItems.length === 0) return false;

    let totalItems = 0;
    let enabledItems = 0;

    allItems.forEach(({ category, items }) => {
      items.forEach((item, index) => {
        totalItems++;
        if (isItemEnabled(category, index, item)) {
          enabledItems++;
        }
      });
    });

    if (enabledItems === 0) return false;
    if (enabledItems === totalItems) return true;
    return "indeterminate";
  };

  // Helper function to get total selected items count
  const getSelectedItemsCount = (): number => {
    // Allow counting when ready or after import completes (to allow re-running)
    if (data.status !== "ready" && data.status !== "completed") return 0;

    let count = 0;
    const allItems: { category: string; items: unknown[] }[] = [];

    if (data.environments)
      allItems.push({ category: "environments", items: data.environments });
    if (data.tags) allItems.push({ category: "tags", items: data.tags });
    if (data.segments)
      allItems.push({ category: "segments", items: data.segments });
    if (data.featureGates)
      allItems.push({ category: "featureGates", items: data.featureGates });
    if (data.dynamicConfigs)
      allItems.push({ category: "dynamicConfigs", items: data.dynamicConfigs });
    if (data.experiments)
      allItems.push({ category: "experiments", items: data.experiments });
    if (data.metrics)
      allItems.push({ category: "metrics", items: data.metrics });
    if (data.metricSources)
      allItems.push({ category: "metricSources", items: data.metricSources });

    allItems.forEach(({ category, items }) => {
      items.forEach((item, index) => {
        if (isItemEnabled(category, index, item)) {
          count++;
        }
      });
    });

    return count;
  };

  // Helper function to get selected items count by category
  const getSelectedItemsCountByCategory = (): {
    [category: string]: number;
  } => {
    // Allow counting when ready or after import completes (to allow re-running)
    if (data.status !== "ready" && data.status !== "completed") return {};

    const counts: { [category: string]: number } = {};

    if (data.environments) {
      counts.environments = data.environments.filter((item, index) =>
        isItemEnabled("environments", index, item),
      ).length;
    }
    if (data.tags) {
      counts.tags = data.tags.filter((item, index) =>
        isItemEnabled("tags", index, item),
      ).length;
    }
    if (data.segments) {
      counts.segments = data.segments.filter((item, index) =>
        isItemEnabled("segments", index, item),
      ).length;
    }
    if (data.featureGates) {
      counts.featureGates = data.featureGates.filter((item, index) =>
        isItemEnabled("featureGates", index, item),
      ).length;
    }
    if (data.dynamicConfigs) {
      counts.dynamicConfigs = data.dynamicConfigs.filter((item, index) =>
        isItemEnabled("dynamicConfigs", index, item),
      ).length;
    }
    if (data.experiments) {
      counts.experiments = data.experiments.filter((item, index) =>
        isItemEnabled("experiments", index, item),
      ).length;
    }
    if (data.metrics) {
      counts.metrics = data.metrics.filter((item, index) =>
        isItemEnabled("metrics", index, item),
      ).length;
    }
    if (data.metricSources) {
      counts.metricSources = data.metricSources.filter((item, index) =>
        isItemEnabled("metricSources", index, item),
      ).length;
    }

    return counts;
  };

  // Helper function to toggle all items globally
  const toggleAllItems = (enabled: boolean) => {
    // Allow toggling when ready or after import completes (to allow re-running)
    if (data.status !== "ready" && data.status !== "completed") return;

    const updates: { [category: string]: { [key: string]: boolean } } = {};

    if (data.environments) {
      updates.environments = {};
      data.environments.forEach((item, index) => {
        const key = getItemKey("environments", index, item);
        updates.environments[key] = enabled;
      });
    }

    if (data.tags) {
      updates.tags = {};
      data.tags.forEach((item, index) => {
        const key = getItemKey("tags", index, item);
        updates.tags[key] = enabled;
      });
    }

    if (data.segments) {
      updates.segments = {};
      data.segments.forEach((item, index) => {
        const key = getItemKey("segments", index, item);
        updates.segments[key] = enabled;
      });
    }

    if (data.featureGates) {
      updates.featureGates = {};
      data.featureGates.forEach((item, index) => {
        const key = getItemKey("featureGates", index, item);
        updates.featureGates[key] = enabled;
      });
    }

    if (data.dynamicConfigs) {
      updates.dynamicConfigs = {};
      data.dynamicConfigs.forEach((item, index) => {
        const key = getItemKey("dynamicConfigs", index, item);
        updates.dynamicConfigs[key] = enabled;
      });
    }

    if (data.experiments) {
      updates.experiments = {};
      data.experiments.forEach((item, index) => {
        const key = getItemKey("experiments", index, item);
        updates.experiments[key] = enabled;
      });
    }

    if (data.metrics) {
      updates.metrics = {};
      data.metrics.forEach((item, index) => {
        const key = getItemKey("metrics", index, item);
        updates.metrics[key] = enabled;
      });
    }

    if (data.metricSources) {
      updates.metricSources = {};
      data.metricSources.forEach((item, index) => {
        const key = getItemKey("metricSources", index, item);
        updates.metricSources[key] = enabled;
      });
    }

    setItemEnabled((prev) => ({
      ...prev,
      ...updates,
    }));
  };

  // Initialize item checkbox states when data changes
  React.useEffect(
    () => {
      // Initialize when ready, or preserve existing states when completed (to allow re-running)
      if (data.status === "ready" || data.status === "completed") {
        const newItemEnabled: {
          [category: string]: { [key: string]: boolean };
        } = {};

        if (data.environments) {
          newItemEnabled.environments = {};
          data.environments.forEach((item, index) => {
            const key = getItemKey("environments", index, item);
            // Preserve existing state, or default to true (enabled)
            // This ensures failed items can be re-run
            newItemEnabled.environments[key] =
              itemEnabled.environments?.[key] ?? true;
          });
        }

        if (data.tags) {
          newItemEnabled.tags = {};
          data.tags.forEach((item, index) => {
            const key = getItemKey("tags", index, item);
            newItemEnabled.tags[key] = itemEnabled.tags?.[key] ?? true;
          });
        }

        if (data.segments) {
          newItemEnabled.segments = {};
          data.segments.forEach((item, index) => {
            const key = getItemKey("segments", index, item);
            newItemEnabled.segments[key] = itemEnabled.segments?.[key] ?? true;
          });
        }

        if (data.featureGates) {
          newItemEnabled.featureGates = {};
          data.featureGates.forEach((item, index) => {
            const key = getItemKey("featureGates", index, item);
            newItemEnabled.featureGates[key] =
              itemEnabled.featureGates?.[key] ?? true;
          });
        }

        if (data.dynamicConfigs) {
          newItemEnabled.dynamicConfigs = {};
          data.dynamicConfigs.forEach((item, index) => {
            const key = getItemKey("dynamicConfigs", index, item);
            newItemEnabled.dynamicConfigs[key] =
              itemEnabled.dynamicConfigs?.[key] ?? true;
          });
        }

        if (data.experiments) {
          newItemEnabled.experiments = {};
          data.experiments.forEach((item, index) => {
            const key = getItemKey("experiments", index, item);
            newItemEnabled.experiments[key] =
              itemEnabled.experiments?.[key] ?? true;
          });
        }

        if (data.metrics) {
          newItemEnabled.metrics = {};
          data.metrics.forEach((item, index) => {
            const key = getItemKey("metrics", index, item);
            newItemEnabled.metrics[key] = itemEnabled.metrics?.[key] ?? true;
          });
        }

        if (data.metricSources) {
          newItemEnabled.metricSources = {};
          data.metricSources.forEach((item, index) => {
            const key = getItemKey("metricSources", index, item);
            newItemEnabled.metricSources[key] =
              itemEnabled.metricSources?.[key] ?? true;
          });
        }

        setItemEnabled(newItemEnabled);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataStr],
  );

  const { refreshOrganization } = useUser();
  const { apiCall } = useAuth();

  const { features, mutate: mutateFeatures } = useFeaturesListWithValues();
  const {
    mutateDefinitions,
    savedGroups,
    tags,
    projects,
    factTables,
    factMetrics,
  } = useDefinitions();
  const { experiments } = useExperiments();
  const environments = useEnvironments();
  const attributeSchema = useAttributeSchema();
  const existingEnvironmentsMap = useMemo(
    () => new Map(environments.map((e) => [e.id, e])),
    [environments],
  );
  const existingSavedGroupsMap = useMemo(
    () => new Map(savedGroups.map((sg) => [sg.groupName, sg])),
    [savedGroups],
  );
  const existingTagsMap = useMemo(
    () => new Map((tags || []).map((t) => [t.id, t])),
    [tags],
  );
  const existingExperimentsMap = useMemo(
    () => new Map((experiments || []).map((e) => [e.trackingKey || "", e])),
    [experiments],
  );
  const existingFactTablesMap = useMemo(
    () => new Map(factTables.map((ft) => [ft.name, ft])),
    [factTables],
  );
  const existingMetricsMap = useMemo(
    () => new Map(factMetrics.map((m) => [m.name, m])),
    [factMetrics],
  );

  // Function to create or find project
  const getOrCreateProject = async (projectName: string): Promise<string> => {
    if (!projectName.trim()) {
      return ""; // Empty string means "All projects"
    }

    // Check if project already exists
    const existingProject = projects.find((p) => p.name === projectName.trim());
    if (existingProject) {
      return existingProject.id;
    }

    // Create new project
    const newProject: ProjectInterface = await apiCall("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: projectName.trim(),
        description: `Created during Statsig import on ${new Date().toISOString()}`,
      }),
    });

    // Refresh projects list
    await mutateDefinitions();

    return newProject.id;
  };

  const step = ["init", "loading", "error"].includes(data.status)
    ? 1
    : data.status === "ready" || data.status === "completed"
      ? 2
      : 3;

  return (
    <div>
      <style>{`
        .diff-viewer-wrapper table,
        .diff-viewer-wrapper thead,
        .diff-viewer-wrapper tbody,
        .diff-viewer-wrapper tr,
        .diff-viewer-wrapper th,
        .diff-viewer-wrapper td {
          padding: 0 !important;
          margin: 0 !important;
          border: none !important;
          border-collapse: separate !important;
          border-spacing: 0 !important;
          background: transparent !important;
          line-height: 1.1 !important;
        }
        .diff-viewer-wrapper table {
          width: 100% !important;
          table-layout: auto !important;
        }
        .diff-viewer-wrapper td {
          padding: 1px 2px !important;
          line-height: 1.1 !important;
        }
        /* Explicit background colors for diff highlighting */
        .diff-viewer-wrapper [class*="-removed"] {
          background: #ffeef0 !important;
        }
        .diff-viewer-wrapper [class*="-added"] {
          background: #acf2bd !important;
        }
        .diff-viewer-wrapper * {
          line-height: 1.1 !important;
        }
      `}</style>
      <h1>Statsig Importer</h1>
      <div className="appbox p-3">
        <div className="row">
          <div className="col">
            <div className="row">
              <div className="col">
                <Field
                  label="API Token"
                  value={token}
                  type="password"
                  onChange={(e) => setToken(e.target.value)}
                  helpText="Console API Key from StatSig Project Settings > API Keys"
                />
              </div>
              <div className="col-auto">
                <Field
                  label="Max requests per 10 secs"
                  type="number"
                  value={intervalCap}
                  helpText="Lower this if you are getting rate limited"
                  onChange={(e) => setIntervalCap(parseInt(e.target.value))}
                />
              </div>
              {!isCloud() && (
                <div className="col-auto" style={{ maxWidth: 180 }}>
                  <label className="form-label d-block">Backend Proxy</label>
                  <Checkbox
                    label="Proxy through API"
                    value={useBackendProxy}
                    setValue={setUseBackendProxy}
                    size="lg"
                    weight="regular"
                    mt="2"
                  />
                  <div className="text-muted small mt-1">
                    Workaround for HTTP origin requests
                  </div>
                </div>
              )}
              <div className="col-auto" style={{ maxWidth: 350 }}>
                <Field
                  label="GrowthBook Project"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="All projects"
                  helpText="Import into a specific project. Leave blank for no project"
                />
              </div>
              <div className="col-auto">
                <SelectField
                  label="Data Source"
                  initialOption="Select..."
                  options={dataSourceOptions}
                  value={dataSource || ""}
                  onChange={(e) => setDataSource(e)}
                  helpText="Used when importing experiments and metrics"
                />
              </div>
            </div>
            <Button
              type="button"
              color={step === 1 ? "primary" : "outline-primary"}
              onClick={async () => {
                if (!token) return;

                track("Statsig import fetch started", {
                  source: "statsig",
                  step: 1,
                });

                setData({
                  status: "fetching",
                });

                try {
                  const buildOptions: BuildImportedDataOptions = {
                    apiKey: token,
                    intervalCap,
                    features,
                    existingEnvironments: existingEnvironmentsMap,
                    existingSavedGroups: existingSavedGroupsMap,
                    existingTags: existingTagsMap,
                    existingExperiments: existingExperimentsMap,
                    callback: (d) => setData(d),
                    skipAttributeMapping,
                    useBackendProxy: isCloud() ? false : useBackendProxy,
                    apiCall,
                    project: projectName || undefined,
                    datasource: getDatasourceById(dataSource || ""),
                    projects,
                    existingAttributeSchema: attributeSchema,
                    existingFactTables: existingFactTablesMap,
                    existingMetrics: existingMetricsMap,
                  };
                  const featuresMap = await buildImportedData(buildOptions);
                  // Store featuresMap for use in runImport
                  setFeaturesMap(featuresMap);
                } catch (e) {
                  setData({
                    ...data,
                    status: "error",
                    error: e.message,
                  });
                }
              }}
            >
              Step 1: Fetch from StatSig
            </Button>
            <Button
              className="ml-2"
              color={step === 2 ? "primary" : "outline-primary"}
              disabled={step < 2 || data.status === "importing"}
              onClick={async () => {
                if (!featuresMap) {
                  console.error("featuresMap not available");
                  return;
                }

                track("Statsig import started", {
                  source: "statsig",
                  step: 2,
                });

                const projectId = await getOrCreateProject(projectName);
                const runOptions: RunImportOptions = {
                  data,
                  existingAttributeSchema: attributeSchema,
                  apiCall,
                  callback: (d) => setData(d),
                  featuresMap,
                  project: projectId,
                  itemEnabled,
                  skipAttributeMapping,
                  existingSavedGroups: savedGroups,
                  existingExperiments: experiments || [],
                  existingFactTables: factTables,
                  datasource: getDatasourceById(dataSource || ""),
                };
                await runImport(runOptions);
                mutateDefinitions();
                mutateFeatures();
                refreshOrganization();
              }}
            >
              Step 2: Import to GrowthBook
            </Button>
          </div>
        </div>
      </div>

      {data.status === "ready" || data.status === "completed" ? (
        <div className="mb-3">
          <div className="bg-light pt-2 px-3 pb-1 rounded">
            <div className="mb-2">
              <strong>{getSelectedItemsCount()} items will be imported</strong>
            </div>
            <div className="d-flex flex-wrap">
              {(() => {
                const counts = getSelectedItemsCountByCategory();
                const categoryLabels: {
                  [key: string]: string;
                } = {
                  environments: "Environments",
                  tags: "Tags",
                  segments: "Segments",
                  featureGates: "Feature Gates",
                  dynamicConfigs: "Dynamic Configs",
                  experiments: "Experiments",
                  metrics: "Metrics",
                  metricSources: "Metric Sources",
                };
                return Object.entries(counts)
                  .filter(([_, count]) => count > 0)
                  .map(([category, count], index, array) => (
                    <div
                      key={category}
                      className="d-flex align-items-center"
                      style={{
                        marginRight: index < array.length - 1 ? "1.5rem" : "0",
                        marginBottom: "0.5rem",
                      }}
                    >
                      <span className="badge badge-info badge-pill mr-2">
                        {count}
                      </span>
                      <span>{categoryLabels[category] || category}</span>
                    </div>
                  ));
              })()}
            </div>
          </div>
        </div>
      ) : null}

      <div className="position-relative">
        {data.status === "error" ? (
          <div className="alert alert-danger">{data.error || "Error"}</div>
        ) : data.status === "init" ? null : (
          <div>
            <div className="mt-3">
              <div>
                <h3>
                  Import status: {data.status}{" "}
                  {data.status === "fetching" ? <LoadingSpinner /> : null}
                </h3>
                <div className="p-3">
                  <div className="d-flex align-items-center mb-3">
                    <Checkbox
                      value={getGlobalCheckboxState()}
                      setValue={(enabled) => toggleAllItems(enabled)}
                      label="Select all items"
                      size="sm"
                      containerClassName="mr-3 mb-0"
                    />
                    <span className="text-muted">
                      {getSelectedItemsCount()} item
                      {getSelectedItemsCount() !== 1 ? "s" : ""} selected
                    </span>
                  </div>
                  <div className="row">
                    <div className="col-auto pr-4" style={{ width: 350 }}>
                      <label className="mb-1 font-weight-bold">
                        Filter items by tags
                      </label>
                      <MultiSelectField
                        placeholder="All tags"
                        value={selectByTags}
                        options={getAllTags.map((tag) => ({
                          value: tag,
                          label: tag,
                        }))}
                        onChange={(tags) => setSelectByTags(tags)}
                        formatOptionLabel={(option) => {
                          const tag = option.value;
                          const count = getTagItemCount(tag);
                          return (
                            <div className="d-flex align-items-center justify-content-between w-100">
                              <span>{option.label}</span>
                              <span className="badge badge-info badge-pill ml-2">
                                {count}
                              </span>
                            </div>
                          );
                        }}
                      />
                      <a
                        role="button"
                        className="mt-1 small float-right"
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.preventDefault();
                          setSelectByTags(getAllTags);
                        }}
                      >
                        Select all tags
                      </a>
                    </div>
                    <div className="col-auto px-4">
                      <label className="mb-1 font-weight-bold d-block">
                        Filter items by status
                      </label>
                      <div className="d-flex align-items-center mb-2">
                        <Checkbox
                          value={filterNewItems}
                          setValue={setFilterNewItems}
                          label="New items"
                          size="sm"
                        />
                        <span className="badge badge-info badge-pill ml-2">
                          {getNewItemsCount()}
                        </span>
                      </div>
                      <div className="d-flex align-items-center">
                        <Checkbox
                          value={filterUpdatedItems}
                          setValue={(v) => {
                            setFilterUpdatedItems(v);
                            if (!v) {
                              setFilterUpdatedWithChanges(false);
                            }
                          }}
                          label="Updated items"
                          size="sm"
                        />
                        <span className="badge badge-info badge-pill ml-2">
                          {getUpdatedItemsCount()}
                        </span>
                      </div>
                      {filterUpdatedItems ? (
                        <div className="d-flex align-items-center mt-1 ml-3">
                          <Checkbox
                            value={filterUpdatedWithChanges}
                            setValue={setFilterUpdatedWithChanges}
                            label="with changes"
                            size="sm"
                          />
                          <span className="badge badge-info badge-pill ml-2">
                            {getUpdatedItemsWithChangesCount()}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex-1" />
                    <div className="col-auto ml-auto">
                      <label className="mb-1 font-weight-bold d-block">
                        Attribute Mapping
                      </label>
                      <div className="d-flex align-items-center justify-content-end">
                        <Switch
                          value={!skipAttributeMapping}
                          onChange={(checked) =>
                            setSkipAttributeMapping(!checked)
                          }
                        />
                        <div className="d-flex flex-column ml-2">
                          <span>
                            Map Statsig attributes to GrowthBook attributes
                          </span>
                          <span className="text-muted small">
                            (e.g. user_id → id)
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {data.environments ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Environments"
                  items={data.environments}
                  checkboxState={getCategoryCheckboxState(
                    "environments",
                    data.environments,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems(
                      "environments",
                      data.environments,
                      enabled,
                    )
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Name</th>
                          <th></th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.environments?.map((environment, i) => {
                          const entityId = `environment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "environments",
                            i,
                            environment,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "environments",
                                        i,
                                        environment,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={environment}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {environment.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={environment.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{environment.environment?.name}</td>
                                <td>
                                  {environment.error ? (
                                    <em>{environment.error}</em>
                                  ) : null}
                                </td>
                                <EntityAccordion
                                  entity={environment.environment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={environment.environment}
                                isExpanded={isExpanded}
                                importItem={environment}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.tags ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Tags"
                  items={data.tags}
                  checkboxState={getCategoryCheckboxState("tags", data.tags)}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems("tags", data.tags, enabled)
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Tag</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tags?.map((tag, i) => {
                          const entityId = `tag-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "tags",
                            i,
                            tag,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled("tags", i, tag, enabled)
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={tag}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {tag.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={tag.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{tag.tag?.name || "Unknown"}</td>
                                <td>{tag.tag?.description}</td>
                                <EntityAccordion
                                  entity={tag.tag}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={tag.tag}
                                isExpanded={isExpanded}
                                importItem={tag}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.segments ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Segments → Saved Groups"
                  items={data.segments}
                  checkboxState={getCategoryCheckboxState(
                    "segments",
                    data.segments,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems("segments", data.segments, enabled)
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th></th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.segments?.map((segment, i) => {
                          const entityId = `segment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "segments",
                            i,
                            segment,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "segments",
                                        i,
                                        segment,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={segment}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {segment.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={segment.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>
                                  {segment.segment?.name ?? segment.segment?.id}
                                </td>
                                <td>{segment.segment?.type}</td>
                                <td>{segment.segment?.description}</td>
                                <td>
                                  {segment.error ? (
                                    <em>{segment.error}</em>
                                  ) : null}
                                </td>
                                <EntityAccordion
                                  entity={segment.segment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={segment.segment}
                                isExpanded={isExpanded}
                                importItem={segment}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.featureGates ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Feature Gates → Features"
                  items={data.featureGates}
                  checkboxState={getCategoryCheckboxState(
                    "featureGates",
                    data.featureGates,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems(
                      "featureGates",
                      data.featureGates,
                      enabled,
                    )
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>ID</th>
                          <th>Description</th>
                          <th>Enabled</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.featureGates?.map((gate, i) => {
                          const entityId = `featureGate-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "featureGates",
                            i,
                            gate,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "featureGates",
                                        i,
                                        gate,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={gate}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {gate.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={gate.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{gate.featureGate?.id}</td>
                                <td>{gate.featureGate?.description}</td>
                                <td>
                                  {gate.featureGate?.isEnabled ? "Yes" : "No"}
                                </td>
                                <EntityAccordion
                                  entity={gate.featureGate}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={gate.featureGate}
                                isExpanded={isExpanded}
                                importItem={gate}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.dynamicConfigs ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Dynamic Configs → Features"
                  items={data.dynamicConfigs}
                  checkboxState={getCategoryCheckboxState(
                    "dynamicConfigs",
                    data.dynamicConfigs,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems(
                      "dynamicConfigs",
                      data.dynamicConfigs,
                      enabled,
                    )
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>ID</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.dynamicConfigs?.map((config, i) => {
                          const entityId = `dynamicConfig-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "dynamicConfigs",
                            i,
                            config,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "dynamicConfigs",
                                        i,
                                        config,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={config}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {config.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={config.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{config.dynamicConfig?.id}</td>
                                <td>{config.dynamicConfig?.description}</td>
                                <EntityAccordion
                                  entity={config.dynamicConfig}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={config.dynamicConfig}
                                isExpanded={isExpanded}
                                importItem={config}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.experiments ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Experiments"
                  items={data.experiments}
                  checkboxState={getCategoryCheckboxState(
                    "experiments",
                    data.experiments,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems(
                      "experiments",
                      data.experiments,
                      enabled,
                    )
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Name</th>
                          <th>Experiment Status</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.experiments?.map((exp, i) => {
                          const entityId = `experiment-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "experiments",
                            i,
                            exp,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "experiments",
                                        i,
                                        exp,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={exp}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {exp.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={exp.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{exp.experiment?.name}</td>
                                <td>{exp.experiment?.status}</td>
                                <EntityAccordion
                                  entity={exp.experiment}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={exp.experiment}
                                isExpanded={isExpanded}
                                importItem={exp}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.metricSources ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Metric Sources → Fact Tables"
                  beta={true}
                  items={data.metricSources}
                  checkboxState={getCategoryCheckboxState(
                    "metricSources",
                    data.metricSources,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems(
                      "metricSources",
                      data.metricSources,
                      enabled,
                    )
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Name</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.metricSources?.map((metricSource, i) => {
                          const entityId = `metricSource-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "metricSources",
                            i,
                            metricSource,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "metricSources",
                                        i,
                                        metricSource,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={metricSource}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {metricSource.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={metricSource.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>{metricSource.metricSource?.name}</td>
                                <td>
                                  {metricSource.metricSource?.description}
                                </td>
                                <EntityAccordion
                                  entity={metricSource.metricSource}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={metricSource.metricSource}
                                isExpanded={isExpanded}
                                importItem={metricSource}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}

            {data.metrics ? (
              <div className="appbox mb-4">
                <ImportHeader
                  name="Metrics"
                  beta={true}
                  items={data.metrics}
                  checkboxState={getCategoryCheckboxState(
                    "metrics",
                    data.metrics,
                  )}
                  onCategoryToggle={(enabled) =>
                    toggleCategoryItems("metrics", data.metrics, enabled)
                  }
                />
                <div className="p-3">
                  <div style={{ maxHeight: 400, overflowY: "auto" }}>
                    <table className="gbtable table w-100">
                      <thead>
                        <tr>
                          <th style={{ width: 50 }}></th>
                          <th style={{ width: 120 }}>Status</th>
                          <th style={{ width: 100 }}>Exists</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.metrics?.map((metric, i) => {
                          const entityId = `metric-${i}`;
                          const isExpanded = expandedAccordions.has(entityId);
                          const effectiveEnabled = getEffectiveCheckboxState(
                            "metrics",
                            i,
                            metric,
                          );
                          return (
                            <React.Fragment key={i}>
                              <tr>
                                <td>
                                  <Checkbox
                                    value={effectiveEnabled}
                                    setValue={(enabled) =>
                                      toggleItemEnabled(
                                        "metrics",
                                        i,
                                        metric,
                                        enabled,
                                      )
                                    }
                                    size="sm"
                                    mt="2"
                                  />
                                </td>
                                <td>
                                  <ImportStatusDisplay
                                    data={metric}
                                    enabled={effectiveEnabled}
                                  />
                                </td>
                                <td style={{ width: 100 }}>
                                  {metric.exists ? (
                                    <span className="text-muted">exists</span>
                                  ) : null}
                                  <HasChangesIcon
                                    hasChanges={metric.hasChanges}
                                    entityId={entityId}
                                    onToggle={toggleAccordion}
                                  />
                                </td>
                                <td>
                                  {metric.metric?.name || metric.metric?.id}
                                </td>
                                <td>{metric.metric?.type}</td>
                                <td>{metric.metric?.description}</td>
                                <EntityAccordion
                                  entity={metric.metric}
                                  entityId={entityId}
                                  isExpanded={isExpanded}
                                  onToggle={toggleAccordion}
                                />
                              </tr>
                              <EntityAccordionContent
                                entity={metric.metric}
                                isExpanded={isExpanded}
                                importItem={metric}
                              />
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
