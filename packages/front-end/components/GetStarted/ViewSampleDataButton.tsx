import { ProjectInterface } from "@back-end/types/project";
import { useRouter } from "next/router";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import Button from "@/components/Button";
import track from "@/services/track";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useAuth } from "@/services/auth";

const ViewSampleDataButton = () => {
  const {
    projectId: demoDataSourceProjectId,
    demoExperimentId,
  } = useDemoDataSourceProject();
  const router = useRouter();
  const { apiCall } = useAuth();

  const { mutateDefinitions } = useDefinitions();

  const openSampleExperiment = async () => {
    if (demoDataSourceProjectId && demoExperimentId) {
      router.push(`/experiment/${demoExperimentId}`);
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
        router.push(`/experiment/${res.experimentId}`);
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
      onClick={openSampleExperiment}
    >
      View Sample Data
    </Button>
  );
};

export default ViewSampleDataButton;
