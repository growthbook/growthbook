import { useCallback, useMemo } from "react";
import { contextualBanditEndpoints } from "shared/api-endpoints";
import {
  LinkedChangeEnvStates,
  LinkedFeatureInfo,
} from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { ApiContextualBanditInterface } from "shared/validators";
import { Box, Flex } from "@radix-ui/themes";
import { useRestApiCall } from "@/services/restApi";
import useSDKConnections from "@/hooks/useSDKConnections";
import { useEnvironments } from "@/services/features";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import LoadingSpinner from "@/components/LoadingSpinner";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";
import { VisualChangesetTable } from "@/components/Experiment/VisualChangesetTable";
import { contextualBanditVisualChangesetOwner } from "@/components/Experiment/visualChangesetOwner";
import AddLinkedChanges, {
  type LinkedChangeTarget,
} from "@/components/Experiment/LinkedChanges/AddLinkedChanges";
import AddLinkedChangeButton from "@/components/Experiment/LinkedChanges/AddLinkedChangeButton";
import ContextualBanditLinkedFeatureFlag from "./ContextualBanditLinkedFeatureFlag";

function useVisualChangesetEnvStates(project: string): LinkedChangeEnvStates {
  const environments = useEnvironments();
  const { data } = useSDKConnections();
  return useMemo(() => {
    const connections = data?.connections ?? [];
    const states: LinkedChangeEnvStates = {};
    for (const env of environments) {
      const active = connections.some(
        (c) =>
          c.environment === env.id &&
          c.includeVisualExperiments &&
          (!c.projects?.length || c.projects.includes(project)),
      );
      states[env.id] = active ? "active" : "no-sdk-connection";
    }
    return states;
  }, [environments, data, project]);
}

export default function ContextualBanditLinkedChanges({
  cb,
  linkedFeatures,
  visualChangesets,
  visualChangesetsLoading = false,
  visualChangesetsError,
  canAdd,
  canEditVisualChangesets,
  canRemoveVisualChangesets,
  setFeatureModal,
  setVisualChangesetModal,
  mutate,
}: {
  cb: ApiContextualBanditInterface;
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  visualChangesetsLoading?: boolean;
  visualChangesetsError?: Error;
  canAdd: boolean;
  canEditVisualChangesets: boolean;
  canRemoveVisualChangesets: boolean;
  setFeatureModal?: (open: boolean) => void;
  setVisualChangesetModal?: (open: boolean) => void;
  mutate: () => void;
}) {
  const restApiCall = useRestApiCall();
  const project = cb.project ?? "";
  const envStates = useVisualChangesetEnvStates(project);

  const numLinkedChanges = linkedFeatures.length + visualChangesets.length;
  const visualChangesetsSettled =
    !visualChangesetsLoading && !visualChangesetsError;

  const deleteVariation = useCallback(
    async (variationId: string) => {
      await restApiCall(
        contextualBanditEndpoints.updateContextualBanditVariations,
        {
          params: { id: cb.id },
          body: { removeVariationIds: [variationId] },
        },
      );
    },
    [restApiCall, cb.id],
  );
  const owner = useMemo(
    () =>
      contextualBanditVisualChangesetOwner(
        cb,
        canAdd ? deleteVariation : undefined,
      ),
    [cb, canAdd, deleteVariation],
  );

  const target: LinkedChangeTarget = {
    project,
    noun: "Contextual Bandit",
    types: ["feature-flag", "visual-editor"],
    extraSdkCapabilities: { "visual-editor": ["contextualBanditsAuto"] },
    sdkUnsupportedCopy: {
      "visual-editor":
        "The SDKs in this Project don't support visual changes on Contextual Bandits. Upgrade your SDK(s) or add a supported SDK.",
    },
  };

  return (
    <Frame>
      <Heading color="text-high" as="h4" size="sm" mb="4">
        Linked Changes
      </Heading>

      {visualChangesets.length > 0 ? (
        <SDKCapabilityWarning
          capability="contextualBanditsAuto"
          project={project}
          mx="1"
          mb="3"
          someMessage="Some SDKs in this Project don't support visual changes on Contextual Bandits. Their users see the original page and aren't counted."
          noneMessage="None of the SDKs in this Project support visual changes on Contextual Bandits, so these changes aren't served."
        />
      ) : null}

      {linkedFeatures.map((info) => (
        <ContextualBanditLinkedFeatureFlag
          key={info.feature.id}
          info={info}
          cb={cb}
          mutate={mutate}
        />
      ))}

      {visualChangesetsError ? (
        <Callout status="error" mx="1" my="2">
          Couldn&apos;t load this Contextual Bandit&apos;s visual changes (
          {visualChangesetsError.message}). Reload the page and try again.
        </Callout>
      ) : visualChangesetsLoading ? (
        <Box mx="1" my="2">
          <LoadingSpinner />
        </Box>
      ) : (
        <VisualChangesetTable
          owner={owner}
          visualChangesets={visualChangesets}
          mutate={mutate}
          canEditVisualChangesets={canEditVisualChangesets}
          canRemoveVisualChangesets={canRemoveVisualChangesets}
          environmentStates={envStates}
        />
      )}

      {canAdd &&
        visualChangesetsSettled &&
        numLinkedChanges > 0 &&
        setFeatureModal && (
          <Flex justify="between" px="1">
            <Text color="text-high" size="lg" weight="semibold">
              {setVisualChangesetModal
                ? "Add Feature Flag or AI Visual Editor"
                : "Add Feature Flag"}
            </Text>
            <AddLinkedChangeButton
              target={target}
              linkedFeatures={linkedFeatures}
              visualChangesets={visualChangesets}
              urlRedirects={[]}
              onFeatureFlag={() => setFeatureModal(true)}
              onVisualEditor={
                setVisualChangesetModal
                  ? () => setVisualChangesetModal(true)
                  : undefined
              }
            />
          </Flex>
        )}
      {visualChangesetsSettled && (
        <AddLinkedChanges
          target={target}
          canAdd={canAdd}
          numLinkedChanges={numLinkedChanges}
          setFeatureModal={setFeatureModal}
          setVisualEditorModal={setVisualChangesetModal}
        />
      )}
      {(!canAdd || !setFeatureModal) &&
      numLinkedChanges === 0 &&
      visualChangesetsSettled ? (
        <Box mx="1" my="2">
          <Text color="text-mid">
            <em>No changes are linked to this Contextual Bandit yet.</em>
          </Text>
        </Box>
      ) : null}
    </Frame>
  );
}
