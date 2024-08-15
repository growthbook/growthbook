import { ProjectInterface } from "@back-end/types/project";
import { useRouter } from "next/router";
import { useDemoDataSourceProject } from "@front-end/hooks/useDemoDataSourceProject";
import Button from "@front-end/components/Button";
import track from "@front-end/services/track";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import { useAuth } from "@front-end/services/auth";
import usePermissionsUtil from "@front-end/hooks/usePermissionsUtils";

const ViewSampleDataButton = ({
  resource = "experiment",
}: {
  resource?: "experiment" | "feature";
}) => {
  const {
    demoExperimentId,
    demoFeatureId,
    exists,
  } = useDemoDataSourceProject();
  const router = useRouter();
  const { apiCall } = useAuth();

  const permissionsUtils = usePermissionsUtil();

  const { mutateDefinitions } = useDefinitions();

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
      }>("/demo-datasource-project", {
        method: "POST",
      });
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
      style={{
        width: "250px",
        background: "#EDE9FE",
        color: "#5746AF",
        fontWeight: 400,
        border: "1px solid #C4B8F3",
      }}
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
