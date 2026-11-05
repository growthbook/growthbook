import { Revision } from "shared/enterprise";
import { SDKConnectionRevisionSnapshot } from "shared/validators";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import { RevisionDiffConfig } from "@/components/Revision/useRevisionDiff";
import RevertModal from "@/components/Revision/RevertModal";

type LiveSnapshot = SDKConnectionRevisionSnapshot & { id: string };

const REVERTABLE_FIELDS = [
  "sdkConnection",
  "sdkWebhooks",
] as const satisfies readonly (keyof LiveSnapshot)[];

// The endpoint takes settings flat. Archive state is never restored by a
// revert; archiving has its own action.
function toRequestBody(
  changes: Record<string, unknown>,
): Record<string, unknown> {
  const { sdkConnection, sdkWebhooks } = changes as Partial<LiveSnapshot>;
  const settings: Record<string, unknown> = { ...(sdkConnection ?? {}) };
  delete settings.archived;
  return {
    ...settings,
    ...(sdkWebhooks !== undefined && { sdkWebhooks }),
  };
}

export default function SDKConnectionRevertModal({
  liveSnapshot,
  revision,
  allRevisions,
  diffConfig,
  approvalRequired,
  canBypassApproval,
  canRevert,
  close,
  onRevisionCreated,
}: {
  liveSnapshot: LiveSnapshot;
  revision: Revision;
  allRevisions: Revision[];
  diffConfig: RevisionDiffConfig<SDKConnectionRevisionSnapshot>;
  approvalRequired: boolean;
  canBypassApproval: boolean;
  canRevert: boolean;
  close: () => void;
  onRevisionCreated: (revision: Revision) => void;
}) {
  return (
    <RevertModal<LiveSnapshot>
      liveEntity={liveSnapshot}
      revertableFields={REVERTABLE_FIELDS}
      apiPathBase="/sdk-connections"
      toRequestBody={toRequestBody}
      revision={revision}
      allRevisions={allRevisions}
      // The diff reads only the snapshot; `id` is there for the endpoint path.
      diffConfig={diffConfig as unknown as RevisionDiffConfig<LiveSnapshot>}
      // The SDK connection endpoint has no revert-specific approval exemption.
      revertsBypassApproval={false}
      approvalRequired={approvalRequired}
      canBypassApproval={canBypassApproval}
      canRevert={canRevert}
      canDraft={canRevert}
      renderDraftSelector={({
        mode,
        setMode,
        canAutoPublish,
        approvalRequired: required,
      }) => (
        <RevisionDraftSelectorForChanges
          entityId={liveSnapshot.id}
          openRevisions={[]}
          allRevisions={allRevisions}
          mode={mode}
          setMode={setMode}
          selectedDraftId={null}
          setSelectedDraftId={() => undefined}
          canAutoPublish={canAutoPublish}
          approvalRequired={required}
          hideExisting
          defaultExpanded
          triggerPrefix="Revert will be"
        />
      )}
      close={close}
      onRevisionCreated={onRevisionCreated}
    />
  );
}
