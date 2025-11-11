import { ProjectInterface } from "back-end/types/project";
import { useRouter } from "next/router";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";

const ViewSampleDataButton = ({
  resource = "experiment",
}: {
  resource?: "experiment" | "feature";
}) => {
  const { demoExperimentId, demoFeatureId, exists } =
    useDemoDataSourceProject();
  const router = useRouter();
  const { apiCall } = useAuth();

  const permissionsUtils = usePermissionsUtil();

  const { mutateDefinitions } = useDefinitions();

  const gb = useGrowthBook();
  const useNewSampleData = gb.isOn("new-sample-data");

  const openSample = async () => {
    if (exists && demoExperimentId) {
      if (resource === "experiment") {
        router.push(`/experiment/${demoExperimentId}`);
      } else {
        router.push(`/features/${demoFeatureId}`);
      }
    } else {
      track("Create Sample Project", {
        source: "get-started",
      });
      const res = await apiCall<{
        project: ProjectInterface;
        experimentId: string;
      }>(
        useNewSampleData
          ? "/demo-datasource-project/new"
          : "/demo-datasource-project",
        {
          method: "POST",
        },
      );
      await mutateDefinitions();
      if (res.experimentId) {
        if (resource === "experiment") {
          router.push(`/experiment/${res.experimentId}`);
        } else {
          router.push(`/features/${demoFeatureId}`);
        }
      } else {
        throw new Error("Could not create sample experiment");
      }
    }
  };

  return (
    <Button
      variant="outline"
      onClick={openSample}
      disabled={
        (!exists || !demoExperimentId) && !permissionsUtils.canCreateProjects()
      }
    >
      View Sample {resource === "experiment" ? "Experiment" : "Feature"}
    </Button>
  );
};

export default ViewSampleDataButton;
