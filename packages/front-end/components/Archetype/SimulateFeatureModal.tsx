import {
  ArchetypeAttributeValues,
  ArchetypeInterface,
} from "@back-end/types/archetype";
import React, { FC } from "react";
import { useForm } from "react-hook-form";
import SelectField from "@/components/Forms/SelectField";
import AttributeForm from "@/components/Archetype/AttributeForm";
import Modal from "@/components/Modal";

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
      <div>
        <div className="row">
          <div className="col mb-3">
            <h4>Select Archetype</h4>
            <SelectField
              value={archetype}
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
              initialValues={simulateForm.watch("attributes")}
              onChange={(attrs) => {
                simulateForm.setValue("attributes", attrs);
                simulateForm.setValue("archetype", "");
              }}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};
export default SimulateFeatureModal;
