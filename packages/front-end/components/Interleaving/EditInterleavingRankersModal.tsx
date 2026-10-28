import { useState } from "react";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import InterleavingVariationsInput, {
  getRankersError,
  InterleavingRankers,
} from "./InterleavingVariationsInput";

export function rankersOf(il: ApiInterleavingInterface): InterleavingRankers {
  const [a, b] = il.variations.map(({ key, name, description, config }) => ({
    key,
    name,
    description,
    config,
  }));
  return [a, b];
}

export default function EditInterleavingRankersModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const [rankers, setRankers] = useState(() => rankersOf(il));

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-rankers"
      header="Edit Rankers"
      close={close}
      cta="Save"
      size="lg"
      submit={async () => {
        const error = getRankersError(rankers, il.jsonSchema);
        if (error) throw new Error(error);
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: { variations: rankers },
        });
        await mutate();
      }}
    >
      {il.status === "running" && (
        <Callout status="warning" mb="3">
          This experiment is running. Saved changes apply to live traffic
          immediately.
        </Callout>
      )}
      <InterleavingVariationsInput
        value={rankers}
        setValue={setRankers}
        jsonSchema={il.jsonSchema}
      />
    </ModalStandard>
  );
}
