import { useState } from "react";
import isEqual from "lodash/isEqual";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";
import { SDKConnectionFieldsValue } from "@/components/Features/SDKConnections/SDKConnectionFields";
import {
  advancedValueFromConnection,
  connectionCapabilities,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";
import {
  SdkConnectionRevisionProps,
  useSdkConnectionRevisionFlow,
} from "@/components/Features/SDKConnections/edit-modals/useSdkConnectionRevisionFlow";

export type SDKConnectionFormValue = SDKConnectionFieldsValue &
  SDKConnectionAdvancedValue;

export function valueFromConnection(
  connection: SDKConnectionInterface,
): SDKConnectionFormValue {
  return {
    name: connection.name,
    languages: connection.languages,
    sdkVersion: connection.sdkVersion,
    environment: connection.environment,
    projects: connection.projects,
    includeReferencedPrerequisites: !!connection.includeReferencedPrerequisites,
    delivery: deliveryModeFromConnection(connection),
    encryptPayload: !!connection.encryptPayload,
    hashSecureAttributes: !!connection.hashSecureAttributes,
    ...advancedValueFromConnection(connection),
  };
}

// What a form value saves as.
export function sdkConnectionBody(
  v: SDKConnectionFormValue,
): Record<string, unknown> {
  const { latestCaps: latestCapabilities, currentCaps: currentCapabilities } =
    connectionCapabilities(v);
  // An SDK that can't read a secured payload gets a plain one, whatever
  // was chosen before it was picked.
  const plain =
    v.delivery === "plain" || !shouldShowPayloadSecurity(v.languages);
  return {
    name: v.name,
    languages: v.languages,
    sdkVersion: v.sdkVersion,
    environment: v.environment,
    projects: v.projects,
    includeReferencedPrerequisites: v.includeReferencedPrerequisites,
    encryptPayload: plain ? false : v.encryptPayload,
    hashSecureAttributes: plain ? false : v.hashSecureAttributes,
    // The server refuses turning it on without the plan; turning it off
    // must still go through after the plan lapses.
    remoteEvalEnabled:
      !plain &&
      v.delivery === "remote" &&
      latestCapabilities.includes("remoteEval"),
    ...sanitizeAdvancedForSave(v, {
      latestCapabilities,
      currentCapabilities,
    }),
  };
}

// The saved settings two bodies differ in.
export function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return Object.keys(after).filter(
    (k) => !isEqual(after[k] ?? null, before[k] ?? null),
  );
}

// The connection's name, the one setting not edited in place, saved into a
// draft or published as the feature page's row modals are.
export default function SDKConnectionEditModal({
  connection,
  mutate,
  close,
  ...revisionProps
}: {
  // As viewed: the selected draft's changes over live.
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
  close: () => void;
} & SdkConnectionRevisionProps) {
  const [name, setName] = useState(connection.name);
  const flow = useSdkConnectionRevisionFlow({
    connection,
    mutate,
    proposedScope: {
      projects: connection.projects,
      environment: connection.environment,
    },
    ...revisionProps,
  });

  return (
    <ModalStandard
      trackingEventModalType="edit-sdk-connection-name"
      header="Edit Name"
      open={true}
      close={close}
      size="md"
      cta={flow.mode === "publish" ? "Save" : "Save to draft"}
      ctaEnabled={!!name.trim() && name.trim() !== connection.name}
      submit={async () => {
        await flow.save({ name: name.trim() });
      }}
    >
      <RevisionDraftSelectorForChanges
        entityId={connection.id}
        openRevisions={revisionProps.openRevisions ?? []}
        allRevisions={revisionProps.allRevisions ?? []}
        mode={flow.mode}
        setMode={flow.setMode}
        selectedDraftId={flow.selectedDraftId}
        setSelectedDraftId={flow.setSelectedDraftId}
        canAutoPublish={flow.canAutoPublish}
        approvalRequired={flow.approvalRequired}
        metadataOnly={flow.metadataOnly}
      />
      <Field
        label="Name"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
    </ModalStandard>
  );
}
