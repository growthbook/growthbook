import { useDefinitions } from "../../services/DefinitionsContext";
import { MetricInterface } from "back-end/types/metric";
import { dump } from "js-yaml";
import { useMemo } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { DimensionInterface } from "back-end/types/dimension";
import { OrganizationSettings } from "back-end/types/organization";
import { ProjectInterface } from "back-end/types/project";

export default function ConfigYamlButton({
  settings = {},
}: {
  settings?: OrganizationSettings;
}) {
  const { datasources, metrics, dimensions, projects } = useDefinitions();

  const href = useMemo(() => {
    const config: {
      projects?: Record<string, Partial<ProjectInterface>>;
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
      },
    };

    if (datasources.length) config.datasources = {};
    datasources.forEach((d) => {
      config.datasources[d.id] = {
        type: d.type,
        name: d.name,
        params: d.params,
        settings: {
          variationIdFormat: d.settings.variationIdFormat ?? "index",
        },
      } as Partial<DataSourceInterfaceWithParams>;

      if (d.type === "google_analytics") return;

      if (d.type === "mixpanel") {
        if (d.settings?.events?.experimentIdProperty) {
          config.datasources[d.id].settings.events = d.settings.events;
        }
      } else {
        if (d.settings?.queries?.experimentsQuery) {
          config.datasources[d.id].settings.queries = d.settings.queries;
        }
      }
    });

    if (metrics.length) config.metrics = {};
    metrics.forEach((m) => {
      const met: Partial<MetricInterface> = {
        type: m.type,
        name: m.name,
      };

      const fields: (keyof MetricInterface)[] = [
        "datasource",
        "description",
        "earlyStart",
        "ignoreNulls",
        "inverse",
        "cap",
        "conversionWindowHours",
        "loseRisk",
        "winRisk",
        "userIdType",
        "tags",
      ];

      if (m.sql) {
        fields.push("sql");
      } else {
        fields.push("anonymousIdColumn");
        fields.push("timestampColumn");
        fields.push("userIdColumn");
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
      config.dimensions[d.id] = {
        name: d.name,
        datasource: d.datasource,
        sql: d.sql,
      };
    });

    if (projects.length) config.projects = {};
    projects.forEach((p) => {
      config.projects[p.id] = {
        name: p.name,
      };
    });

    try {
      const yml =
        dump(config, {
          skipInvalid: true,
        }) + "\n";
      const blob = new Blob([yml], { type: "text/yaml" });
      return window.URL.createObjectURL(blob);
    } catch (e) {
      console.error(e);
      return "";
    }
  }, [dimensions, metrics, datasources, projects]);

  if (!href) return null;

  return (
    <a href={href} download="config.yml" className="btn btn-primary btn-sm">
      Download config.yml
    </a>
  );
}
