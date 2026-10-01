import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import track from "@/services/track";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function SampleDataSourceLink() {
  const { exists, projectId, demoDataSourceId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { mutateDefinitions, setProject } = useDefinitions();

  if (hasFileConfig()) return null;

  const createSampleDataSource = async () => {
    try {
      await apiCall("/demo-datasource-project", { method: "POST" });
      track("Create Sample Project", { source: "sample-project-page" });
      if (projectId) setProject(projectId);
      await mutateDefinitions();
    } catch (e: unknown) {
      console.error(e);
    }
  };

  return (
    <Text as="p" color="text-mid" mb="4">
      Just exploring?{" "}
      {exists && demoDataSourceId ? (
        <Link href={`/datasources/${demoDataSourceId}`}>
          Try the sample Data Source.
        </Link>
      ) : (
        <Link onClick={createSampleDataSource}>
          Try the sample Data Source.
        </Link>
      )}
    </Text>
  );
}
