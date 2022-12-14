import { dump } from "js-yaml";
import { useMemo } from "react";
import { OrganizationSettings } from "back-end/types/organization";
import { FaDownload } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useConfigJson } from "@/services/config";

export default function BackupConfigYamlButton({
  settings = {},
}: {
  settings?: OrganizationSettings;
}) {
  const { datasources, metrics, dimensions } = useDefinitions();

  const config = useConfigJson({
    datasources,
    metrics,
    dimensions,
    settings,
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

  if (!href) return null;

  return (
    <a href={href} download="config.yml" className="btn btn-primary">
      <FaDownload /> Export to config.yml
    </a>
  );
}
