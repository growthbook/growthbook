import { useState } from "react";
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";

import { interleavingEndpoints } from "shared/api-endpoints";
import type {
  ApiInterleavingInterface,
  InterleavingStatus,
} from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import SelectField from "@/components/Forms/SelectField";
import StopInterleavingWarning from "./StopInterleavingWarning";

const LABELS: Record<InterleavingStatus, MessageDescriptor> = {
  draft: msg`Draft`,
  running: msg`Running`,
  stopped: msg`Stopped`,
};

const REACHABLE: Record<InterleavingStatus, InterleavingStatus[]> = {
  draft: ["running"],
  running: ["stopped"],
  stopped: ["running"],
};

function statusOptions(
  current: InterleavingStatus,
  archived: boolean,
  i18n: I18n,
) {
  const reachable = archived
    ? REACHABLE[current].filter((status) => status !== "running")
    : REACHABLE[current];
  return [current, ...reachable].map((value) => ({
    value,
    label: i18n._(LABELS[value]),
  }));
}

export default function EditInterleavingStatusModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const { t, i18n } = useLingui();
  const restApiCall = useRestApiCall();
  const [status, setStatus] = useState<InterleavingStatus>(il.status);

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-status"
      trackingEventModalSource="interleaving-more-menu"
      header={t`Change Interleaving Status`}
      close={close}
      cta={t`Update`}
      ctaColor={status === "stopped" ? "red" : undefined}
      ctaEnabled={status !== il.status}
      submit={async () => {
        await restApiCall(
          status === "running"
            ? interleavingEndpoints.startInterleaving
            : interleavingEndpoints.stopInterleaving,
          { params: { id: il.id } },
        );
        await mutate();
      }}
    >
      <SelectField
        label={t`Status`}
        value={status}
        onChange={(v) => setStatus(v as InterleavingStatus)}
        options={statusOptions(il.status, il.archived, i18n)}
        sort={false}
      />
      {il.archived && (
        <Callout status="info">
          <Trans>
            This interleaving experiment is archived. Unarchive it to start it
            again.
          </Trans>
        </Callout>
      )}
      {status === "stopped" && il.status === "running" && (
        <Callout status="warning">
          <StopInterleavingWarning />
        </Callout>
      )}
      {status === "running" && il.status !== "running" && (
        <Callout status="info">
          <Trans>
            Both rankers start serving in the environments this experiment is
            enabled in.
          </Trans>
        </Callout>
      )}
    </ModalStandard>
  );
}
