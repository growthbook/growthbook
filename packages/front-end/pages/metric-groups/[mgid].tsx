import { useRouter } from "next/router";
import React, { useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import MetricGroupDetails from "@/components/Metrics/MetricGroupDetails";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import MetricGroupModal from "@/components/Metrics/MetricGroupModal";
import Button from "@/ui/Button";
import PageHead from "@/components/Layout/PageHead";

export default function MetricGroupDetailPage() {
  const router = useRouter();
  const { mgid } = router.query;
  const { getMetricGroupById, mutateDefinitions } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateMetricGroup();
  const group = getMetricGroupById(mgid as string);
  const [openEditModal, setOpenEditModal] = useState(false);

  if (!group) {
    return <div>Group not found</div>;
  }
  return (
    <>
      <PageHead
        breadcrumb={[
          {
            display: "Metrics",
            href: `/metrics`,
          },
          {
            display: "Metric Groups",
            href: `/metrics#metricgroups`,
          },
          { display: group.name },
        ]}
      />
      <div className="container-fluid pagecontents">
        <div className="d-flex align-items-center mb-3">
          <div>
            <h1>{group.name}</h1>
            <p>{group.description}</p>
          </div>
          <div style={{ flex: 1 }} />
          <div className="">
            {canCreate && (
              <Button
                variant="outline"
                onClick={() => {
                  setOpenEditModal(true);
                }}
              >
                Edit Metric Group
              </Button>
            )}
          </div>
        </div>
        <div>
          <div className="table appbox gbtable table-hover">
            <MetricGroupDetails
              metricGroup={group}
              mutate={mutateDefinitions}
            />
          </div>
        </div>
        {openEditModal && (
          <MetricGroupModal
            existingMetricGroup={group}
            close={() => setOpenEditModal(false)}
            mutate={mutateDefinitions}
          />
        )}
      </div>
    </>
  );
}
