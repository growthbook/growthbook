import { MetricInterface } from "back-end/types/metric";
import { useMemo } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { OrganizationSettings } from "back-end/types/organization";

type Props = {
  metrics: MetricInterface[];
  dimensions: DimensionInterface[];
  datasources: DataSourceInterfaceWithParams[];
  settings: OrganizationSettings;
};

export function useConfigJson({
  metrics,
  dimensions,
  datasources,
  settings,
}: Props) {
  return useMemo(() => {
    const config: {
      organization?: {
        settings?: OrganizationSettings;
      };
      datasources?: Record<string, Partial<DataSourceInterfaceWithParams>>;
      metrics?: Record<string, Partial<MetricInterface>>;
      dimensions?: Record<string, Partial<DimensionInterface>>;
    } = {};

    config.organization = {
      settings: {
        pastExperimentsMinLength: settings.pastExperimentsMinLength ?? 6,
        visualEditorEnabled: !!settings.visualEditorEnabled,
        environments: settings.environments,
        attributeSchema: settings.attributeSchema,
        namespaces: settings.namespaces,
        metricAnalysisDays: settings.metricAnalysisDays,
        northStar: settings.northStar,
        updateSchedule: settings.updateSchedule,
        multipleExposureMinPercent: settings.multipleExposureMinPercent,
        videoInstructionsViewed: settings.videoInstructionsViewed,
        sdkInstructionsViewed: settings.sdkInstructionsViewed,
        defaultRole: settings.defaultRole,
        metricDefaults: settings.metricDefaults,
      },
    };

    const datasourceIds: string[] = [];

    if (datasources.length) config.datasources = {};
    datasources.forEach((d) => {
      datasourceIds.push(d.id);
      config.datasources[d.id] = {
        type: d.type,
        name: d.name,
        params: d.params,
        settings: {},
      } as Partial<DataSourceInterfaceWithParams>;

      if (d.type === "google_analytics") return;

      if (d.type === "mixpanel") {
        if (d.settings?.schemaFormat) {
          config.datasources[d.id].settings.schemaFormat =
            d.settings?.schemaFormat;
        }
      } else {
        if (d.settings?.events?.experimentIdProperty) {
          config.datasources[d.id].settings.events = d.settings.events;
        }
        if (
          d.settings?.queries?.experimentsQuery ||
          d.settings?.queries?.exposure ||
          d.settings?.queries?.identityJoins
        ) {
          config.datasources[d.id].settings.queries = d.settings.queries;
        }
        if (d.settings?.userIdTypes) {
          config.datasources[d.id].settings.userIdTypes =
            d.settings?.userIdTypes;
        }
        if (d.settings?.notebookRunQuery) {
          config.datasources[d.id].settings.notebookRunQuery =
            d.settings?.notebookRunQuery;
        }
        if (d.settings?.events?.experimentIdProperty) {
          config.datasources[d.id].settings.events = d.settings.events;
        }
      }
    });

    if (metrics.length) config.metrics = {};
    metrics.forEach((m) => {
      if (m.datasource && !datasourceIds.includes(m.datasource)) return;
      const met: Partial<MetricInterface> = {
        type: m.type,
        name: m.name,
      };

      const fields: (keyof MetricInterface)[] = [
        "datasource",
        "description",
        "ignoreNulls",
        "inverse",
        "cap",
        "conversionWindowHours",
        "conversionDelayHours",
        "loseRisk",
        "winRisk",
        "maxPercentChange",
        "minPercentChange",
        "minSampleSize",
        "userIdType",
        "userIdTypes",
        "tags",
        "denominator",
        "type",
        "conditions",
      ];

      if (m.sql) {
        fields.push("sql");
      } else {
        fields.push("anonymousIdColumn");
        fields.push("timestampColumn");
        fields.push("userIdColumn");
        fields.push("userIdColumns");
        fields.push("table");
        fields.push("column");
        fields.push("conditions");
      }

      fields.forEach((f) => {
        const v = m[f];
        if (!v) return;
        if (Array.isArray(v) && !v.length) return;
        // eslint-disable-next-line
        (met[f] as any) = v;
      });

      config.metrics[m.id] = met;
    });

    if (dimensions.length) config.dimensions = {};
    dimensions.forEach((d) => {
      if (d.datasource && !datasourceIds.includes(d.datasource)) return;
      config.dimensions[d.id] = {
        name: d.name,
        datasource: d.datasource,
        sql: d.sql,
        userIdType: d.userIdType || "user_id",
      };
    });

    return config;
  }, [metrics, dimensions, datasources, settings]);
}
