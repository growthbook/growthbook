import React, { useState, useEffect } from "react";
import Link from "next/link";
import { FeatureInterface } from "back-end/types/feature";
import { SavedGroupInterface } from "back-end/types/saved-group";
import { getMatchingRules } from "shared/util";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import InlineGroupsList from "@/components/SavedGroups/InlineGroupsList";
import { useEnvironments, useFeaturesList } from "@/services/features";
import { useExperiments } from "@/hooks/useExperiments";
import usePermissions from "@/hooks/usePermissions";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import LoadingOverlay from "../components/LoadingOverlay";
import { useDefinitions } from "../services/DefinitionsContext";
import Modal from "../components/Modal";
import HistoryTable from "../components/HistoryTable";

export function SavedGroupUsageList({
  usage,
}: {
  usage: SavedGroupUsageRef[];
}) {
  return (
    <ul
      className="border rounded bg-light pt-3 pb-3 overflow-auto"
      style={{ maxHeight: "200px" }}
    >
      {usage.map((ref, i) => {
        return (
          <li key={i}>
            <strong>{ref.type}</strong>: <Link href={ref.url}>{ref.name}</Link>
          </li>
        );
      })}
    </ul>
  );
}

export const getSavedGroupMessage = (usage: SavedGroupUsageRef[]) => {
  return async () => {
    if (usage.length > 0) {
      return (
        <div>
          <p className="alert alert-danger">
            <strong>Whoops!</strong> The following features and experiments
            reference this saved group. You must update the targeting conditions
            and remove references from all of them before you delete this saved
            group.
          </p>
          <SavedGroupUsageList usage={usage} />
        </div>
      );
    }
    return null;
  };
};

// TODO: support experiments
export type SavedGroupUsageRef = {
  type: "feature" | "experiment";
  name: string;
  url: string;
};
export type SavedGroupUsageMap = Map<
  string,
  {
    all: SavedGroupUsageRef[];
    legacy: SavedGroupUsageRef[];
  }
>;

export function getSavedGroupUsageMap(
  features: FeatureInterface[],
  experiments: ExperimentInterfaceStringDates[],
  savedGroups: SavedGroupInterface[],
  environments: string[]
): SavedGroupUsageMap {
  const map: SavedGroupUsageMap = new Map();

  features.forEach((feature) => {
    const ref: SavedGroupUsageRef = {
      type: "feature",
      name: feature.id,
      url: `/features/${feature.id}`,
    };

    savedGroups.forEach((group) => {
      map.set(
        group.id,
        map.get(group.id) || {
          all: [],
          legacy: [],
        }
      );
      const entry = map.get(group.id);
      if (!entry) return;

      // If there are legacy references using attribute targeting
      const conditionTargeting = getMatchingRules(
        feature,
        (rule) => {
          return rule.condition?.includes(group.id) || false;
        },
        environments
      );
      if (conditionTargeting.length > 0) {
        entry.all.push(ref);
        entry.legacy.push(ref);
      }
      // If there are newer references using saved group targeting
      else {
        // First add newer savedGroup Targeting references
        const savedGroupTageting = getMatchingRules(
          feature,
          (rule) => {
            return (
              rule.savedGroups?.some((g) => g.ids.includes(group.id)) || false
            );
          },
          environments
        );
        if (savedGroupTageting.length > 0) {
          entry.all.push(ref);
        }
      }
    });
  });

  experiments
    .filter((exp) => !exp.archived)
    .forEach((experiment) => {
      const ref: SavedGroupUsageRef = {
        type: "experiment",
        name: experiment.name,
        url: `/experiment/${experiment.id}`,
      };

      const phase = experiment.phases[experiment.phases.length - 1];
      if (!phase) return;

      savedGroups.forEach((group) => {
        map.set(
          group.id,
          map.get(group.id) || {
            all: [],
            legacy: [],
          }
        );
        const entry = map.get(group.id);
        if (!entry) return;

        // Legacy attribute targeting rules
        if (phase.condition?.includes(group.id)) {
          entry.all.push(ref);
          entry.legacy.push(ref);
        }
        // Newer saved group targeting rules
        else if (phase.savedGroups?.some((g) => g.ids.includes(group.id))) {
          entry.all.push(ref);
        }
      });
    });

  return map;
}

export default function SavedGroupsPage() {
  const { mutateDefinitions, savedGroups, error } = useDefinitions();

  const [auditModal, setAuditModal] = useState(false);

  const { features } = useFeaturesList();
  const { experiments } = useExperiments();
  const environments = useEnvironments();

  const { refreshOrganization } = useUser();

  const permissions = usePermissions();
  const { apiCall } = useAuth();

  useEffect(() => {
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
  }, [permissions.manageTargetingAttributes, apiCall, refreshOrganization]);

  if (!savedGroups) return <LoadingOverlay />;

  const savedGroupUsage = getSavedGroupUsageMap(
    features,
    experiments,
    savedGroups,
    environments.map((e) => e.id)
  );

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
        Reusable groups of users (based on targeting conditions) you can
        reference from any feature flag rule or experiment.
      </p>

      {error ? (
        <div className="alert alert-danger">
          There was an error loading the list of groups.
        </div>
      ) : (
        <InlineGroupsList
          groups={savedGroups}
          mutate={mutateDefinitions}
          usage={savedGroupUsage}
        />
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
