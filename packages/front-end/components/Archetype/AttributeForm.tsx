import React, { useMemo, useState } from "react";
import { SDKAttribute, SDKAttributeSchema } from "back-end/types/organization";
import { useForm } from "react-hook-form";
import { ArchetypeAttributeValues } from "back-end/types/archetype";
import { useAttributeSchema } from "@/services/features";
import Field from "@/components/Forms/Field";
import TabButton from "@/components/Tabs/TabButton";
import TabButtons from "@/components/Tabs/TabButtons";
import SelectField from "@/components/Forms/SelectField";
import Toggle from "@/components/Forms/Toggle";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import styles from "./AttributeForm.module.scss";

export interface Props {
  onChange: (attributes: ArchetypeAttributeValues) => void;
  initialValues?: ArchetypeAttributeValues;
  jsonCTA?: string;
  useJSONButton?: boolean;
}

export default function AttributeForm({
  onChange,
  initialValues = {},
  jsonCTA = "Test Attributes",
  useJSONButton = true,
}: Props) {
  const [formValues, setFormValues] = useState({});
  const [jsonAttributes, setJsonAttributes] = useState<string>(
    JSON.stringify(formValues),
  );
  const [jsonErrors, setJsonErrors] = useState<string | null>();
  const [tab, setTab] = useState<"simple" | "adv">("simple");

  const attributeSchema = useAttributeSchema(true);

  const orderedAttributes = useMemo<SDKAttributeSchema>(
    () => [
      ...attributeSchema.filter((o) => !o.archived),
      ...attributeSchema.filter((o) => o.archived),
    ],
    [attributeSchema],
  );

  const attributesMap = new Map();
  const defaultValues = orderedAttributes
    .filter((o) => !o.archived)
    .reduce((list, attr) => {
      attributesMap.set(attr.property, attr);
      const defaultValue = initialValues[attr.property]
        ? initialValues[attr.property]
        : attr.datatype === "boolean"
          ? false
          : undefined;
      return { ...list, [attr.property]: defaultValue };
    }, {});

  // eslint-disable-next-line
  const attributeForm = useForm<any>({
    defaultValues: defaultValues,
  });

  // filter out empty values (for strings, at least)
  const updateFormValues = (skipJsonUpdate = false) => {
    const filteredValues = Object.entries(attributeForm.getValues())
      .filter(([key, value]) => {
        if (
          attributesMap.get(key)?.datatype === "string" ||
          attributesMap.get(key)?.datatype === "number"
        ) {
          return value !== "";
        } else {
          return true;
        }
      })
      .reduce((obj, [key, value]) => {
        return { ...obj, [key]: value };
      }, {});
    setFormValues(filteredValues ?? {});
    if (!skipJsonUpdate)
      setJsonAttributes(JSON.stringify(filteredValues, null, 2));
    onChange(filteredValues);
  };

  const attributeInput = (attribute: SDKAttribute, i: number) => {
    if (attribute.archived) return null;
    return (
      <div className="" key={"formInput" + i}>
        <div
          className={`d-flex flex-row align-items-center justify-content-between p-1`}
        >
          <div className="col-6">{attribute.property}</div>
          <div className="col-6">
            {attribute.datatype === "boolean" ? (
              <Toggle
                id={"form-toggle" + attribute.property}
                value={!!attributeForm.watch(attribute.property)}
                setValue={(value) => {
                  attributeForm.setValue(attribute.property, value);
                  updateFormValues();
                }}
              />
            ) : attribute.datatype === "enum" ? (
              <SelectField
                value={attributeForm.watch(attribute.property)}
                onChange={(v) => {
                  // on change here does not trigger the form to change
                  attributeForm.setValue(attribute.property, v);
                  updateFormValues();
                }}
                placeholder="Select..."
                options={
                  attribute?.enum?.split(",").map((d) => ({
                    value: d.trim(),
                    label: d.trim(),
                  })) ?? []
                }
                className=""
              />
            ) : attribute.datatype === "string[]" ? (
              <MultiSelectField
                options={
                  (attribute.enum
                    ? attribute.enum
                        .split(",")
                        .map((v) => ({ value: v.trim(), label: v.trim() }))
                    : attributeForm
                        .watch(attribute.property)
                        ?.map((v: string) => ({ value: v, label: v }))) || []
                }
                value={attributeForm.watch(attribute.property) || []}
                onChange={(value) => {
                  attributeForm.setValue(attribute.property, value);
                  updateFormValues();
                }}
                creatable={!attribute.enum}
              />
            ) : (
              <Field
                className=""
                {...attributeForm.register(attribute.property)}
                onChange={(e) => {
                  attributeForm.setValue(attribute.property, e.target.value);
                  updateFormValues();
                }}
              />
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div>
        <h4>Attributes</h4>
        <TabButtons className="mb-0 pb-0">
          <TabButton
            active={tab === "simple"}
            display={<>Form</>}
            anchor="simple"
            onClick={() => {
              setTab("simple");
              updateFormValues(true);
            }}
            newStyle={false}
            activeClassName="active-tab"
          />
          <TabButton
            active={tab === "adv"}
            display={<>JSON</>}
            anchor="adv"
            onClick={() => {
              setTab("adv");
              try {
                const parsed = JSON.parse(jsonAttributes);
                setFormValues(parsed);
                onChange(parsed);
              } catch (e) {
                setJsonErrors(e.message);
              }
            }}
            newStyle={false}
            activeClassName="active-tab"
            last={false}
          />
        </TabButtons>

        <div
          className={`border border-secondary rounded ${styles.attributeBox} pb-2 bg-light`}
        >
          {tab === "simple" ? (
            <div className=" form-group rounded">
              <div
                className={`${styles.attrHeader} d-flex flex-row align-items-center justify-content-between small border-bottom p-1 mb-2 sticky-top`}
              >
                <div className="col-6">
                  <strong>Name</strong>
                </div>
                <div className="col-6">
                  <strong>Value</strong>
                </div>
              </div>
              {orderedAttributes.length ? (
                orderedAttributes.map((attribute, i) =>
                  attributeInput(attribute, i),
                )
              ) : (
                <>No attributes defined yet</>
              )}
            </div>
          ) : (
            <div className="p-2">
              <div className=" form-group rounded">
                <Field
                  label={`JSON Values`}
                  value={jsonAttributes}
                  onChange={(e) => {
                    setJsonAttributes(e.target.value);
                    setJsonErrors(null);
                  }}
                  onBlur={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      setFormValues(parsed);
                      onChange(parsed);
                    } catch (e) {
                      setJsonErrors(e.message);
                    }
                  }}
                  textarea={true}
                  minRows={30}
                  containerClassName="mb-0"
                  helpText={`Enter user attributes in JSON format.`}
                />
                {jsonErrors && (
                  <div className="text-danger">
                    Error parsing JSON: {jsonErrors}
                  </div>
                )}
                {useJSONButton && (
                  <div className="text-right">
                    <button
                      type="submit"
                      className="btn btn-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        try {
                          const parsed = JSON.parse(jsonAttributes);
                          setFormValues(parsed);
                          onChange(parsed);
                        } catch (e) {
                          setJsonErrors(e.message);
                        }
                      }}
                    >
                      {jsonCTA}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
