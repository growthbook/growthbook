import { dump } from "js-yaml";
import { useMemo } from "react";
import { OrganizationSettings } from "shared/types/organization";
import { MetricInterface } from "shared/types/metric";
import { FaDownload } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useConfigJson } from "@/services/config";
import useApi from "@/hooks/useApi";
import Button from "@/ui/Button";

export default function BackupConfigYamlButton({
  settings = {},
}: {
  settings?: OrganizationSettings;
}) {
  const { datasources, dimensions, segments } = useDefinitions();

  // Definitions only contain slimmed metrics (no sql, etc.), so fetch the
  // full versions for the export. /metrics excludes archived metrics by
  // default, matching the old definitions-based behavior.
  const { data: metricsData } = useApi<{ metrics: MetricInterface[] }>(
    "/metrics",
  );
  const metrics = metricsData?.metrics;

  const config = useConfigJson({
    datasources,
    metrics: metrics || [],
    dimensions,
    settings,
    segments,
  });

  const href = useMemo(() => {
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
  }, [config]);

  if (!metricsData) {
    return (
      <Button disabled loading icon={<FaDownload />}>
        Export to config.yml
      </Button>
    );
  }
  if (!href) return null;

  return (
    <a href={href} download="config.yml" className="btn btn-primary">
      <FaDownload /> Export to config.yml
    </a>
  );
}
