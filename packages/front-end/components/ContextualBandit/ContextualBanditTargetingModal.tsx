import { useState } from "react";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Field from "@/components/Forms/Field";

/** CB-native targeting editor (coverage + condition). PUTs to the CB endpoint. */
export default function ContextualBanditTargetingModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const [coveragePercent, setCoveragePercent] = useState<number>(
    Math.round((cb.coverage ?? 1) * 100),
  );
  const [condition, setCondition] = useState<string>(cb.condition ?? "");

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-targeting"
      header="Edit Targeting"
      close={close}
      cta="Save"
      submit={async () => {
        const coverage = Math.min(1, Math.max(0, coveragePercent / 100));
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({ coverage, condition }),
        });
        mutate();
      }}
    >
      <Field
        label="Traffic Coverage (%)"
        type="number"
        min={0}
        max={100}
        value={coveragePercent}
        onChange={(e) => setCoveragePercent(Number(e.target.value))}
        helpText="Percentage of eligible traffic included in the bandit."
      />
      <Field
        label="Targeting Condition (JSON)"
        textarea
        minRows={3}
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        helpText={'Optional MongoDB-style condition, e.g. {"country": "US"}.'}
      />
    </ModalStandard>
  );
}
