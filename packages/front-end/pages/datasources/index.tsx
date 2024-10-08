import { FC } from "react";
import { PiArrowRight } from "react-icons/pi";
import { Button } from "@radix-ui/themes";
import { DocLink } from "@/components/DocLink";
import DataSources from "@/components/Settings/DataSources";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";

const DataSourcesPage: FC = () => {
  const {
    exists: demoDataSourceExists,
    projectId: demoProjectId,
  } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { mutateDefinitions, setProject } = useDefinitions();

  return (
    <div className="container-fluid pagecontents">
      <div className="d-flex">
        <h1>Data Sources</h1>
        {!demoDataSourceExists && (
          <Button
            className="ml-auto"
            onClick={async (e) => {
              e.preventDefault();
              try {
                await apiCall("/demo-datasource-project", {
                  method: "POST",
                });
                track("Create Sample Project", {
                  source: "sample-project-page",
                });
                if (demoProjectId) {
                  setProject(demoProjectId);
                }
                await mutateDefinitions();
              } catch (e: unknown) {
                console.error(e);
              }
            }}
            variant="soft"
          >
            Generate Sample Data
          </Button>
        )}
      </div>
      <p className="mb-0">
        GrowthBook connects to your your raw data to analyze experiments and
        show you results.{" "}
        <DocLink
          docSection="datasources"
          className="align-self-center ml-1 mt-2 pb-1"
        >
          View docs <PiArrowRight />
        </DocLink>
      </p>
      <DataSources />
    </div>
  );
};
export default DataSourcesPage;
