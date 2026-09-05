import type { Response } from "express";
import { CreateProps } from "shared/types/base-model";
import { FactMetricInterface } from "shared/types/fact-table";
import { MetricInterface } from "shared/types/metric";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  createFactTable,
  getFactTableMap,
} from "back-end/src/models/FactTableModel";
import {
  getMetricsByOrganization,
  updateMetric,
} from "back-end/src/models/MetricModel";
import { getExperimentsUsingMetrics } from "back-end/src/models/ExperimentModel";
import { addTags } from "back-end/src/models/TagModel";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { refreshColumns } from "back-end/src/services/factTableColumns";
import { MigrateLegacyMetricsBody } from "./legacy-metrics.validators";

export interface MigrateLegacyMetricsResult {
  factTableId: string;
  // Fact metric ids created by this request
  created: string[];
  // Fact metric ids that already existed
  skipped: string[];
  errors: { id: string; message: string }[];
}

export interface MigrateLegacyMetricsResponse {
  status: 200;
  results: MigrateLegacyMetricsResult[];
  archived: string[];
  notArchived: { id: string; reason: string }[];
  metricGroupsUpdated: number;
  templatesUpdated: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * POST /legacy-metrics/migrate
 *
 * Creates the fact tables and fact metrics for one batch of groups, then swaps
 * the migrated ids into metric groups and experiment templates and archives
 * the legacy metrics. Every step is idempotent: existing fact tables and fact
 * metrics are reused, so a batch can be retried safely.
 */
export const postMigrateLegacyMetrics = async (
  req: AuthRequest<MigrateLegacyMetricsBody>,
  res: Response<MigrateLegacyMetricsResponse>,
) => {
  const context = getContextFromReq(req);
  const { groups, archive } = req.body;

  const factTableMap = await getFactTableMap(context);
  const factMetrics = await context.models.factMetrics.getAll();
  const factMetricIds = new Set(factMetrics.map((m) => m.id));

  const results: MigrateLegacyMetricsResult[] = [];
  for (const group of groups) {
    const result: MigrateLegacyMetricsResult = {
      factTableId: group.factTable.id,
      created: [],
      skipped: [],
      errors: [],
    };
    results.push(result);

    try {
      if (!factTableMap.has(group.factTable.id)) {
        if (group.existing) {
          throw new Error("Existing Fact Table not found");
        }
        const data = { ...group.factTable, columnRefreshPending: false };
        if (!context.permissions.canCreateFactTable(data)) {
          context.permissions.throwPermissionError();
        }
        const datasource = await getDataSourceById(context, data.datasource);
        if (!datasource) throw new Error("Could not find Data Source");

        // Detect real column types from the warehouse, keeping the number
        // formats the migration derived from the legacy metric types
        const formats = new Map(
          (data.columns || []).map((c) => [c.column, c.numberFormat]),
        );
        const { columns, needsBackgroundRefresh } = await refreshColumns(
          context,
          datasource,
          { ...data, columns: [] },
        );
        if (!columns.length) {
          throw new Error("SQL did not return any columns");
        }
        data.columns = columns.map((c) => ({
          ...c,
          numberFormat: formats.get(c.column) || c.numberFormat,
        }));
        data.columnRefreshPending = needsBackgroundRefresh;

        const factTable = await createFactTable(context, data);
        factTableMap.set(factTable.id, factTable);
        if (needsBackgroundRefresh) {
          await queueFactTableColumnsRefresh(factTable);
        }
        if (data.tags.length) await addTags(context.org.id, data.tags);
      }
    } catch (e) {
      result.errors.push({ id: group.factTable.id, message: message(e) });
      continue;
    }

    for (const metric of group.metrics) {
      if (factMetricIds.has(metric.id)) {
        result.skipped.push(metric.id);
        continue;
      }
      try {
        const created = await context.models.factMetrics.create(
          metric as CreateProps<FactMetricInterface>,
        );
        factMetrics.push(created);
        factMetricIds.add(created.id);
        result.created.push(created.id);
      } catch (e) {
        result.errors.push({ id: metric.id, message: message(e) });
      }
    }
  }

  // legacy metric id -> fact metric id, from every replacement that exists
  const idMap = new Map<string, string>();
  for (const fm of factMetrics) {
    for (const legacyId of fm.replaces || []) idMap.set(legacyId, fm.id);
  }
  const swap = (ids: string[]) => [
    ...new Set(ids.map((id) => idMap.get(id) ?? id)),
  ];
  const changed = (before: string[], after: string[]) =>
    before.length !== after.length || before.some((id, i) => id !== after[i]);

  let metricGroupsUpdated = 0;
  if (context.permissions.canUpdateMetricGroup()) {
    for (const mg of await context.models.metricGroups.getAll()) {
      const metrics = swap(mg.metrics);
      if (!changed(mg.metrics, metrics)) continue;
      await context.models.metricGroups.update(mg, { metrics });
      metricGroupsUpdated++;
    }
  }

  let templatesUpdated = 0;
  if (orgHasPremiumFeature(context.org, "templates")) {
    for (const template of await context.models.experimentTemplates.getAll()) {
      const updates = {
        goalMetrics: swap(template.goalMetrics || []),
        secondaryMetrics: swap(template.secondaryMetrics || []),
        guardrailMetrics: swap(template.guardrailMetrics || []),
        activationMetric: template.activationMetric
          ? (idMap.get(template.activationMetric) ?? template.activationMetric)
          : template.activationMetric,
      };
      if (
        !changed(template.goalMetrics || [], updates.goalMetrics) &&
        !changed(template.secondaryMetrics || [], updates.secondaryMetrics) &&
        !changed(template.guardrailMetrics || [], updates.guardrailMetrics) &&
        updates.activationMetric === template.activationMetric
      ) {
        continue;
      }
      if (!context.permissions.canUpdateExperimentTemplate(template, updates)) {
        continue;
      }
      await context.models.experimentTemplates.update(template, updates);
      templatesUpdated++;
    }
  }

  const archived: string[] = [];
  const notArchived: MigrateLegacyMetricsResponse["notArchived"] = [];
  if (archive) {
    const legacyIds = [
      ...new Set(groups.flatMap((g) => g.metrics.flatMap((m) => m.replaces))),
    ].filter((id) => idMap.has(id));
    const legacyMetrics = new Map<string, MetricInterface>(
      (await getMetricsByOrganization(context)).map((m) => [m.id, m]),
    );
    // One query for every experiment still referencing these metrics,
    // directly or through a metric group
    const metricToGroupIds = new Map<string, string[]>();
    for (const mg of await context.models.metricGroups.getAll()) {
      for (const id of mg.metrics) {
        metricToGroupIds.set(id, [...(metricToGroupIds.get(id) || []), mg.id]);
      }
    }
    const running = (
      await getExperimentsUsingMetrics({
        context,
        metricIds: legacyIds,
        metricToGroupIds,
      })
    ).filter((e) => e.status === "running");
    const usedBy = (id: string) =>
      running.filter((e) => {
        const ids = [
          ...(e.goalMetrics || []),
          ...(e.secondaryMetrics || []),
          ...(e.guardrailMetrics || []),
          e.activationMetric || "",
        ];
        return (
          ids.includes(id) ||
          (metricToGroupIds.get(id) || []).some((g) => ids.includes(g))
        );
      });

    for (const id of legacyIds) {
      const metric = legacyMetrics.get(id);
      if (!metric || metric.status === "archived") continue;
      if (metric.managedBy === "config" || metric.managedBy === "api") {
        notArchived.push({
          id,
          reason: `Managed by ${metric.managedBy}; archive it there instead`,
        });
        continue;
      }
      const blockers = usedBy(id);
      if (blockers.length) {
        notArchived.push({
          id,
          reason: `Used by running experiment(s): ${blockers.map((e) => e.name).join(", ")}`,
        });
        continue;
      }
      if (!context.permissions.canUpdateMetric(metric, {})) {
        notArchived.push({ id, reason: "No permission to update this metric" });
        continue;
      }
      try {
        await updateMetric(context, metric, { status: "archived" });
        archived.push(id);
      } catch (e) {
        notArchived.push({ id, reason: message(e) });
      }
    }
  }

  res.status(200).json({
    status: 200,
    results,
    archived,
    notArchived,
    metricGroupsUpdated,
    templatesUpdated,
  });
};
