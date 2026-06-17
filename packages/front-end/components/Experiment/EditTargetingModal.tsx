import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Separator } from "@radix-ui/themes";
import { useAttributeSchema, useEnvironments } from "@/services/features";
import TargetingFieldsGroup from "@/components/Features/TargetingFieldsGroup";
import FallbackAttributeSelector from "@/components/Features/FallbackAttributeSelector";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import useOrgSettings from "@/hooks/useOrgSettings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HashVersionSelector, {
  allConnectionsSupportBucketingV2,
} from "./HashVersionSelector";
import MakeChangesFlow from "./MakeChangesFlow";
import { useExperimentTargetingForm } from "./useExperimentTargetingForm";
import useSDKConnections from "@/hooks/useSDKConnections";

export interface Props {
  close: () => void;
  experiment: ExperimentInterfaceStringDates;
  mutate: () => void;
  safeToEdit: boolean;
}

export default function EditTargetingModal({
  close,
  experiment,
  mutate,
  safeToEdit,
}: Props) {
  const {
    form,
    defaultValues,
    conditionKey,
    setPrerequisiteTargetingSdkIssues,
    canSubmit,
    onSubmit,
  } = useExperimentTargetingForm(experiment);

  const environments = useEnvironments();
  const envs = environments.map((e) => e.id);

  const attributeSchema = useAttributeSchema(false, experiment.project);
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttributeOptions: AttributeOptionForTooltip[] = attributeSchema
    .filter((s) => !hasHashAttributes || s.hashAttribute)
    .map((s) => ({
      label: s.property,
      value: s.property,
      description: s.description,
      tags: s.tags,
      datatype: s.datatype,
      hashAttribute: s.hashAttribute,
    }));

  // If the current hashAttribute isn't in the list, add it for backwards
  // compatibility (e.g. the attribute was archived or removed from the
  // experiment's project after creation).
  if (
    form.watch("hashAttribute") &&
    !hashAttributeOptions.find((o) => o.value === form.watch("hashAttribute"))
  ) {
    hashAttributeOptions.push({
      label: form.watch("hashAttribute"),
      value: form.watch("hashAttribute"),
    });
  }

  const disableStickyBucketing = !!form.watch("disableStickyBucketing");

  const settings = useOrgSettings();

  const orgStickyBucketing = !!settings.useStickyBucketing;

  if (safeToEdit) {
    return (
      <ModalStandard
        trackingEventModalType=""
        open={true}
        close={close}
        header="Edit Targeting"
        ctaEnabled={canSubmit}
        submit={onSubmit(mutate, "targeting")}
        size="lg"
      >
        <div className="pt-2">
          <SelectField
            withRadixThemedPortal
            containerClassName="flex-1"
            label="Assignment Attribute"
            labelClassName="font-weight-bold"
            options={hashAttributeOptions}
            sort={false}
            value={form.watch("hashAttribute")}
            onChange={(v) => {
              form.setValue("hashAttribute", v);
            }}
            formatOptionLabel={(o, meta) => {
              return (
                <AttributeOptionWithTooltip
                  option={o as AttributeOptionForTooltip}
                  context={meta.context}
                >
                  {o.label}
                </AttributeOptionWithTooltip>
              );
            }}
            helpText={
              "Will be hashed together with the Tracking Key to determine which variation to assign"
            }
          />
          {orgStickyBucketing ? (
            <Switch
              mt="4"
              mb="2"
              label="Disable Sticky Bucketing"
              description="Do not persist variation assignments for this experiment (overrides your organization settings)"
              value={!!form.watch("disableStickyBucketing")}
              onChange={(v) => {
                form.setValue("disableStickyBucketing", v);
              }}
            />
          ) : null}
          {!disableStickyBucketing && (
            <FallbackAttributeSelector
              form={form}
              attributeSchema={attributeSchema}
            />
          )}
          <HashVersionSelector
            value={form.watch("hashVersion")}
            onChange={(v) => form.setValue("hashVersion", v)}
            project={experiment.project}
          />

          <Separator size="4" my="5" />

          <TargetingFieldsGroup
            project={experiment.project || ""}
            environments={envs}
            savedGroups={form.watch("savedGroups") || []}
            setSavedGroups={(v) => form.setValue("savedGroups", v)}
            condition={form.watch("condition")}
            setCondition={(condition) => form.setValue("condition", condition)}
            conditionKey={conditionKey}
            prerequisites={form.watch("prerequisites") || []}
            setPrerequisites={(prerequisites) =>
              form.setValue("prerequisites", prerequisites)
            }
            setPrerequisiteTargetingSdkIssues={
              setPrerequisiteTargetingSdkIssues
            }
          />
        </div>
      </ModalStandard>
    );
  }

  return (
    <MakeChangesFlow
      experiment={experiment}
      form={form}
      defaultValues={defaultValues}
      onSubmit={(scope) => onSubmit(mutate, scope)()}
      close={close}
      canSubmit={canSubmit}
      conditionKey={conditionKey}
      setPrerequisiteTargetingSdkIssues={setPrerequisiteTargetingSdkIssues}
    />
  );
}
