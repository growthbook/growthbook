import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type {
  ApiInterleavingInterface,
  InterleavingStatus,
} from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import VariationLabel from "@/ui/VariationLabel";
import SelectField from "@/components/Forms/SelectField";

const LABELS: Record<InterleavingStatus, string> = {
  draft: "Draft",
  running: "Running",
  stopped: "Stopped",
};

const REACHABLE: Record<InterleavingStatus, InterleavingStatus[]> = {
  draft: ["running"],
  running: ["stopped"],
  stopped: ["running"],
};

function statusOptions(current: InterleavingStatus) {
  return [current, ...REACHABLE[current]].map((value) => ({
    value,
    label: LABELS[value],
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
  const restApiCall = useRestApiCall();
  const [status, setStatus] = useState<InterleavingStatus>(il.status);

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-status"
      trackingEventModalSource="interleaving-more-menu"
      header="Change Interleaving Status"
      close={close}
      cta="Update"
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
        label="Status"
        value={status}
        onChange={(v) => setStatus(v as InterleavingStatus)}
        options={statusOptions(il.status)}
        sort={false}
      />
      {status === "stopped" && il.status === "running" && (
        <Callout status="warning">
          <Flex align="center" gap="1" wrap="wrap">
            Users will get
            <VariationLabel
              number={0}
              name={il.variations[0].name || il.variations[0].key}
              size="sm"
            />
            &apos;s list. Results stay available.
          </Flex>
        </Callout>
      )}
      {status === "running" && il.status !== "running" && (
        <Callout status="info">
          Both rankers start serving in the environments this experiment is
          enabled in.
        </Callout>
      )}
    </ModalStandard>
  );
}
