import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { SavedGroupInterface } from "shared/src/types";
import { FaExternalLinkAlt } from "react-icons/fa";
import IdLists from "@/components/SavedGroups/IdLists";
import ConditionGroups from "@/components/SavedGroups/ConditionGroups";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { useAttributeSchema } from "@/services/features";
import LoadingOverlay from "@/components/LoadingOverlay";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "@/components/Modal";
import HistoryTable from "@/components/HistoryTable";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ControlledTabs from "@/components/Tabs/ControlledTabs";
import Tab from "@/components/Tabs/Tab";

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
                    <Link
                      href={`/features/${feature}`}
                      className="btn btn-link pt-1 pb-1"
                    >
                      {feature}
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

  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();
  const [tab, setTab] = useState<string | null>("conditionGroups");
  const [idLists, conditionGroups] = useMemo(() => {
    const idLists: SavedGroupInterface[] = [];
    const conditionGroups: SavedGroupInterface[] = [];
    savedGroups.forEach((savedGroup) => {
      if (savedGroup.type === "condition") {
        conditionGroups.push(savedGroup);
      }
      if (savedGroup.type === "list") {
        idLists.push(savedGroup);
      }
    });
    return [idLists, conditionGroups];
  }, [savedGroups]);

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
    //TODO: When we make Saved Groups a project-level feature, we should pass in the Saved Groups projects below
    if (permissionsUtil.canCreateAttribute({})) {
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
    apiCall,
    refreshOrganization,
    attributeSchema,
    savedGroups,
    permissionsUtil,
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
        Create reusable groups of users to use as targets for feature flag rules
        or experiments. Choose to define groups as an ID List or a Targeting
        Condition.
      </p>
      <div className="alert alert-info mt-2">
        Learn more about the differences between using ID Lists or Targeting
        Conditions.{" "}
        <a
          href="https://docs.growthbook.io/features/targeting#saved-groups"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View docs <FaExternalLinkAlt />
        </a>
      </div>

      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      ) : (
        <>
          <ControlledTabs
            orientation="horizontal"
            defaultTab="conditionGroups"
            tabContentsClassName="tab-content-full"
            active={tab}
            setActive={(tab) => {
              setTab(tab);
            }}
          >
            <Tab
              id="conditionGroups"
              padding={false}
              anchor="conditionGroups"
              display={
                <>
                  Condition Groups{" "}
                  <span className="round-text-background text-color-main">
                    {conditionGroups.length}
                  </span>
                </>
              }
            >
              <ConditionGroups
                groups={savedGroups}
                mutate={mutateDefinitions}
              />
            </Tab>
            <Tab
              id="idLists"
              padding={false}
              anchor="idLists"
              display={
                <>
                  ID Lists{" "}
                  <span className="round-text-background text-color-main">
                    {idLists.length}
                  </span>
                </>
              }
            >
              <IdLists groups={savedGroups} mutate={mutateDefinitions} />
            </Tab>
          </ControlledTabs>
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
