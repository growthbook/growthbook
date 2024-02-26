import React, { useEffect, useState } from "react";
import Link from "next/link";
import IdLists from "@/components/SavedGroups/IdLists";
import ConditionGroups from "@/components/SavedGroups/ConditionGroups";
import { useUser } from "@/services/UserContext";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "../components/Modal";
import HistoryTable from "../components/HistoryTable";

export const getSavedGroupMessage = (
  featuresUsingSavedGroups: Set<string> | undefined
) => {
  return async () => {
    if (featuresUsingSavedGroups && featuresUsingSavedGroups?.size > 0) {
      return (
        <div>
          <p className="alert alert-danger">
            <strong>Whoops!</strong> Before you can delete this saved group, you
            will need to update the feature
            {featuresUsingSavedGroups.size > 1 && "s"} listed below by removing
            any targeting conditions that rely on this saved group.
          </p>
          <ul
            className="border rounded bg-light pt-3 pb-3 overflow-auto"
            style={{ maxHeight: "200px" }}
          >
            {[...featuresUsingSavedGroups].map((feature) => {
              return (
                <li key={feature}>
                  <div className="d-flex">
                    <Link href={`/features/${feature}`}>
                      <a className="btn btn-link pt-1 pb-1">{feature}</a>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      );
    }
    return null;
  };
};

export default function SavedGroupsPage() {
  const { mutateDefinitions, savedGroups, error } = useDefinitions();

  const [auditModal, setAuditModal] = useState(false);

  const { refreshOrganization } = useUser();

  const permissions = usePermissions();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();

  useEffect(() => {
    // Not using $groups attribute in a any saved groups
    if (
      !savedGroups?.some(
        (g) => g.type === "condition" && g.condition?.includes("$groups")
      )
    ) {
      return;
    }

    // Already has $groups attribute
    if (attributeSchema.some((a) => a.property === "$groups")) return;

    // If user has permissions to manage attributes, auto-add $groups attribute
    if (permissions.manageTargetingAttributes) {
      apiCall<{ added: boolean }>("/organization/auto-groups-attribute", {
        method: "POST",
      })
        .then((res) => {
          if (res.added) {
            refreshOrganization();
          }
        })
        .catch(() => {
          // Ignore errors
        });
    }
  }, [
    permissions.manageTargetingAttributes,
    apiCall,
    refreshOrganization,
    attributeSchema,
    savedGroups,
  ]);

  if (!savedGroups) return <LoadingOverlay />;

  return (
    <div className="p-3 container-fluid pagecontents">
      <div className="row">
        <div className="col">
          <h1>Saved Groups</h1>
        </div>
        <div className="col-auto">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setAuditModal(true);
            }}
          >
            View Audit Logs
          </a>
        </div>
      </div>
      <p>
        Reusable groups of users you can target from any feature flag rule or
        experiment. There are two ways to define Saved Groups - as an{" "}
        <strong>ID List</strong> or <strong>Targeting Condition</strong>.
      </p>

      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      ) : (
        <>
          <IdLists groups={savedGroups} mutate={mutateDefinitions} />
          <ConditionGroups groups={savedGroups} mutate={mutateDefinitions} />
        </>
      )}

      {auditModal && (
        <Modal
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="max"
          closeCta="Close"
        >
          <HistoryTable type="savedGroup" showName={true} showType={false} />
        </Modal>
      )}
    </div>
  );
}
