import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { validateAndFixCondition } from "shared/util";
import { useRestApiCall } from "@/services/restApi";
import { useEnvironments } from "@/services/features";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Field from "@/components/Forms/Field";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";

export default function EditInterleavingTargetingModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const environments = useEnvironments();

  const [hashAttribute, setHashAttribute] = useState(il.hashAttribute);
  const [coverage, setCoverage] = useState(il.coverage ?? 1);
  const [condition, setCondition] = useState(il.condition ?? "");
  const [conditionKey, setConditionKey] = useState(0);
  const [savedGroups, setSavedGroups] = useState(il.savedGroups ?? []);
  const [prerequisites, setPrerequisites] = useState(il.prerequisites ?? []);
  const [prereqSdkIssues, setPrereqSdkIssues] = useState(false);

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-targeting"
      header="Edit Targeting"
      close={close}
      cta="Save"
      size="lg"
      submit={async () => {
        if (prereqSdkIssues) {
          throw new Error(
            "Some prerequisites aren't supported by your SDK versions.",
          );
        }
        let fixedCondition = condition;
        validateAndFixCondition(condition, (fixed) => {
          fixedCondition = fixed;
          setConditionKey((k) => k + 1);
        });
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: {
            hashAttribute,
            coverage,
            condition: fixedCondition,
            savedGroups,
            prerequisites,
          },
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
      <Flex gap="3">
        <Field
          label="Hash attribute"
          value={hashAttribute}
          onChange={(e) => setHashAttribute(e.target.value)}
          containerClassName="flex-1"
        />
        <Field
          label="Coverage (%)"
          type="number"
          min={0}
          max={100}
          value={Math.round(coverage * 100)}
          onChange={(e) =>
            setCoverage(Math.min(1, Math.max(0, Number(e.target.value) / 100)))
          }
          containerClassName="flex-1"
        />
      </Flex>
      <TargetingFieldsGroup
        project={il.project ?? ""}
        environments={environments.map((e) => e.id)}
        condition={condition}
        setCondition={setCondition}
        conditionKey={conditionKey}
        savedGroups={savedGroups}
        setSavedGroups={setSavedGroups}
        prerequisites={prerequisites}
        setPrerequisites={setPrerequisites}
        setPrerequisiteTargetingSdkIssues={setPrereqSdkIssues}
      />
    </ModalStandard>
  );
}
