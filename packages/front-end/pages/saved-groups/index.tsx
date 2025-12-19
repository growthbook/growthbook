import React, { useEffect, useMemo, useState } from "react";
import { SavedGroupInterface } from "shared/types/groups";
import { FaExternalLinkAlt } from "react-icons/fa";
import { FeatureInterface } from "back-end/types/feature";
import {
  ExperimentInterface,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { isEmpty } from "lodash";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";

export const getSavedGroupMessage = (
  featuresUsingSavedGroups?: FeatureInterface[],
  experimentsUsingSavedGroups?: Array<
    ExperimentInterface | ExperimentInterfaceStringDates
  >,
) => {
  return async () => {
    if (
      isEmpty(featuresUsingSavedGroups) &&
      isEmpty(experimentsUsingSavedGroups)
    ) {
      return null;
    }

    return (
      <div>
        <p className="alert alert-danger">
          <strong>Whoops!</strong> Before you can delete this saved group, you
          will need to update the item
          {(featuresUsingSavedGroups?.length || 0) +
            (experimentsUsingSavedGroups?.length || 0) >
            1 && "s"}{" "}
          listed below by removing any targeting conditions that rely on this
          saved group.
        </p>
        {getListOfReferences(
          featuresUsingSavedGroups,
          experimentsUsingSavedGroups,
        )}
      </div>
    );
  };
};

export const getListOfReferences = (
  featuresUsingSavedGroups?: FeatureInterface[],
  experimentsUsingSavedGroups?: Array<
    ExperimentInterface | ExperimentInterfaceStringDates
  >,
) => {
  if (
    isEmpty(featuresUsingSavedGroups) &&
    isEmpty(experimentsUsingSavedGroups)
  ) {
    return null;
  }

  return (
    <ul
      className="border rounded bg-light pt-3 pb-3 overflow-auto"
      style={{ maxHeight: "200px" }}
    >
      {(featuresUsingSavedGroups || []).map((feature) => {
        return (
          <li key={feature.id}>
            <div className="d-flex">
              <Link href={`/features/${feature.id}`} className="pt-1 pb-1">
                {feature.id}
              </Link>
            </div>
          </li>
        );
      })}

      {(experimentsUsingSavedGroups || []).map((experiment) => {
        return (
          <li key={experiment.id}>
            <div className="d-flex">
              <Link href={`/experiment/${experiment.id}`} className="pt-1 pb-1">
                {experiment.name}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default function SavedGroupsPage() {
  const { mutateDefinitions, savedGroups, error } = useDefinitions();

  const [auditModal, setAuditModal] = useState(false);

  const { refreshOrganization } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const { apiCall } = useAuth();
  const attributeSchema = useAttributeSchema();
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
        (g) => g.type === "condition" && g.condition?.includes("$groups"),
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
      <div>
        Create reusable user groups as targets for feature flags or experiments.
      </div>
      <Callout status="info" my="3">
        Learn more about using Condition Groups and ID Lists.{" "}
        <a
          href="https://docs.growthbook.io/features/targeting#saved-groups"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          View docs <FaExternalLinkAlt />
        </a>
      </Callout>

      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      ) : (
        <>
          <Tabs defaultValue="conditionGroups">
            <TabsList>
              <TabsTrigger value="conditionGroups">
                Condition Groups
                <span className="ml-2 round-text-background text-main">
                  {conditionGroups.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="idLists">
                ID Lists
                <span className="ml-2 round-text-background text-main">
                  {idLists.length}
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="conditionGroups">
              <ConditionGroups
                groups={savedGroups}
                mutate={mutateDefinitions}
              />
            </TabsContent>

            <TabsContent value="idLists">
              <IdLists groups={savedGroups} mutate={mutateDefinitions} />
            </TabsContent>
          </Tabs>
        </>
      )}

      {auditModal && (
        <Modal
          trackingEventModalType=""
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
