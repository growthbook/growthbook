import { useState } from "react";
import { useRouter } from "next/router";
import { DEMO_DATASOURCE_ID } from "shared/demo-datasource";
import { useDemoDataSourceProject } from "@/hooks/useDemoDataSourceProject";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import track from "@/services/track";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export default function SampleDataSourceLink() {
  const { exists, projectId, demoDataSourceId } = useDemoDataSourceProject();
  const { apiCall } = useAuth();
  const { mutateDefinitions, setProject } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sampleExists = exists && !!demoDataSourceId;

  if (hasFileConfig()) return null;
  if (!sampleExists && !permissionsUtil.canCreateProjects()) return null;

  const createSampleDataSource = async () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await apiCall("/demo-datasource-project", { method: "POST" });
      track("Create Sample Project", { source: "sample-project-page" });
      if (projectId) setProject(projectId);
      await mutateDefinitions();
      await router.push(`/datasources/${DEMO_DATASOURCE_ID}`);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to create the sample Data Source.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <Text as="p" color="text-mid" mb="4">
        Just exploring?{" "}
        {sampleExists ? (
          <Link href={`/datasources/${demoDataSourceId}`}>
            Try the sample Data Source.
          </Link>
        ) : (
          <Link onClick={createSampleDataSource}>
            {creating
              ? "Creating the sample Data Source..."
              : "Try the sample Data Source."}
          </Link>
        )}
      </Text>
      {error && (
        <Callout status="error" mb="4">
          {error}
        </Callout>
      )}
    </>
  );
}
