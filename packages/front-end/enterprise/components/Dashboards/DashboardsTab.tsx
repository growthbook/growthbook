import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import React, { useState } from "react";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import Button from "@/components/Radix/Button";
import { useAuth } from "@/services/auth";
import Link from "@/components/Radix/Link";
import DashboardEditor from "./DashboardEditor";

interface Props {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
}

export default function DashboardsTab({ experiment, mutate }: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [dashboard, setDashboard] = useState<
    DashboardInstanceInterface | undefined
  >(undefined);
  const { apiCall } = useAuth();

  if (isEditing || dashboard) {
    return (
      <DashboardEditor
        back={() => {
          setDashboard(undefined);
          setIsEditing(false);
        }}
        cancel={() => setIsEditing(false)}
        setEditing={setIsEditing}
        submit={async (
          dashboardData: Pick<DashboardInstanceInterface, "title" | "blocks">
        ) => {
          const res = await apiCall<{
            status: number;
            dashboard: DashboardInstanceInterface;
          }>(
            `/experiments/${experiment.id}/dashboards/${dashboard?.id || ""}`,
            {
              method: dashboard ? "PUT" : "POST",
              body: JSON.stringify(dashboardData),
            }
          );
          if (res.status === 200) {
            setDashboard(res.dashboard);
            setIsEditing(false);
            mutate();
          } else {
            console.error(res);
          }
        }}
        experiment={experiment}
        dashboard={dashboard}
        isEditing={isEditing}
        mutate={mutate}
      />
    );
  }

  if ((experiment?.dashboards?.length || 0) === 0) {
    return (
      <div className="mt-3">
        <div className="appbox mx-3 p-4">
          <div className="text-center">
            <h3>No Dashboards Yet</h3>
            <p className="text-muted mb-4">
              Create your first dashboard to analyze and share experiment
              results.
            </p>
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Create New Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="appbox mx-3 p-4">
        <div className="text-center">
          <h3>Choose a Dashboard</h3>
          <p className="text-muted mb-4">Select a dashboard to view or edit.</p>
          <div className="d-flex flex-column gap-2">
            {experiment.dashboards!.map((r) => (
              <Link key={r.id} onClick={() => setDashboard(r)}>
                {r.title}
              </Link>
            ))}
            <Button
              onClick={() => {
                setIsEditing(true);
              }}
            >
              Create New Dashboard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
