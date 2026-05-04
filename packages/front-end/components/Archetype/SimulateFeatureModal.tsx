import {
  ArchetypeAttributeValues,
  ArchetypeInterface,
} from "shared/types/archetype";
import React, { FC } from "react";
import { useForm } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useDefinitions } from "@/services/DefinitionsContext";

const SimulateFeatureModal: FC<{
  archetype: string;
  archetypeMap: Map<string, ArchetypeInterface>;
  attributes: ArchetypeAttributeValues;
  close: () => void;
  onSubmit: ({
    archetype,
    attributes,
  }: {
    archetype: string;
    attributes: ArchetypeAttributeValues;
  }) => void;
}> = ({ archetype, archetypeMap, attributes, close, onSubmit }) => {
  const simulateForm = useForm<{
    archetype: string;
    attributes: ArchetypeAttributeValues;
  }>({
    defaultValues: {
      archetype: archetype || "",
      attributes: attributes || "",
    },
  });
  const { project } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateArchetype({ projects: [project] });

  // get all the archetypes for use in the select field options
  const archetypeOptions: { value: string; label: string }[] = [];
  for (const [key, value] of archetypeMap) {
    archetypeOptions.push({
      value: key,
      label: value.name,
    });
  }

  return (
    <Modal
      trackingEventModalType=""
      close={() => {
        close();
      }}
      includeCloseCta={false}
      size="lg"
      header="Simulate features"
      open={true}
      cta={"Test User Attributes"}
      submit={() => {
        onSubmit(simulateForm.getValues());
      }}
    >
      {!canCreate ? (
        <div className="p-3 text-center">
          This feature is part of our enterprise plan.
        </div>
      ) : (
        <div>
          <div className="row">
            <div className="col mb-3">
              <h4>Select Archetype</h4>
              <SelectField
                value={simulateForm.watch("archetype")}
                options={archetypeOptions}
                onChange={(a) => {
                  try {
                    const attrsText = archetypeMap.get(a)?.attributes || "{}";
                    const attrs = JSON.parse(attrsText);
                    simulateForm.setValue("archetype", a);
                    simulateForm.setValue("attributes", attrs);
                  } catch (e) {
                    console.error(e);
                  }
                }}
              />
            </div>
          </div>
          <div className="row">
            <div className="col-12">
              <AttributeForm
                attributeValues={simulateForm.watch("attributes")}
                archetypeId={simulateForm.watch("archetype")}
                useJSONButton={false}
                onChange={(attrs) => {
                  simulateForm.setValue("attributes", attrs);
                  simulateForm.setValue("archetype", "");
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};
export default SimulateFeatureModal;
