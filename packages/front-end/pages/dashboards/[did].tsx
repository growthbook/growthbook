import React from "react";
import { useRouter } from "next/router";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import DashboardEditor from "@/enterprise/components/Dashboards/DashboardEditor";
import DashboardSnapshotProvider from "@/enterprise/components/Dashboards/DashboardSnapshotProvider";

export default function SingleDashboardPage() {
  const router = useRouter();
  const { did } = router.query;
  const { data, isLoading, error, mutate } = useApi<{
    dashboard: DashboardInterface;
  }>(`/dashboards/${did}`);
  const dashboard = data?.dashboard;

  if (isLoading) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }

  if (!dashboard) {
    router.replace("/404");
    return null;
  }

  return (
    <DashboardSnapshotProvider dashboard={dashboard} mutateDefinitions={mutate}>
      <DashboardEditor
        isTabActive
        isEditing={false}
        title={dashboard.title}
        blocks={dashboard.blocks}
        enableAutoUpdates={dashboard.enableAutoUpdates}
        editSidebarDirty={false}
        focusedBlockIndex={undefined}
        stagedBlockIndex={undefined}
        scrollAreaRef={null}
        setBlock={() => {}}
        moveBlock={() => {}}
        addBlockType={() => {}}
        editBlock={() => {}}
        duplicateBlock={() => {}}
        deleteBlock={() => {}}
        mutate={mutate}
      />
    </DashboardSnapshotProvider>
  );
}
