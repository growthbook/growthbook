import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SDKAttribute, SDKAttributeSchema } from "back-end/types/organization";
import { ArchetypeAttributeValues } from "shared/types/archetype";
import isEqual from "lodash/isEqual";
import format from "date-fns/format";
import { useAttributeSchema } from "@/services/features";
import Field from "@/components/Forms/Field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import Switch from "@/ui/Switch";
import SelectField from "@/components/Forms/SelectField";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import DatePicker from "@/components/DatePicker";
import styles from "./AttributeForm.module.scss";

export interface Props {
  onChange: (attributes: ArchetypeAttributeValues) => void;
  attributeValues: ArchetypeAttributeValues;
  archetypeId?: string;
  jsonCTA?: string;
  hideTitle?: boolean;
  useJSONButton?: boolean;
}

export default function AttributeForm({
  onChange,
  attributeValues = {},
  archetypeId,
  jsonCTA = "Test Attributes",
  hideTitle = false,
  useJSONButton = true,
}: Props) {
  const [formValues, setFormValues] = useState({});
  const [jsonAttributes, setJsonAttributes] = useState<string>(
    JSON.stringify(formValues),
  );
  const [jsonErrors, setJsonErrors] = useState<string | null>();
  const [activeTab, setActiveTab] = useState<"simple" | "adv">("simple");

  const attributeSchema = useAttributeSchema(true);

  const orderedAttributes = useMemo<SDKAttributeSchema>(
    () => [
      ...attributeSchema.filter((o) => !o.archived),
      ...attributeSchema.filter((o) => o.archived),
    ],
    [attributeSchema],
  );

  const attributesMap = useMemo(() => {
    return new Map(
      orderedAttributes.map((attr) => {
        const defaultValue = attributeValues[attr.property]
          ? attributeValues[attr.property]
          : attr.datatype === "boolean"
            ? false
            : attr.datatype === "string[]" || attr.datatype === "number[]"
              ? []
              : undefined;
        return [
          attr.property,
          {
            ...attr,
            defaultValue,
            value: attributeValues[attr.property] ?? defaultValue,
          },
        ];
      }),
    );
  }, [orderedAttributes, attributeValues]);

  const attributeFormValues = useMemo(() => {
    return new Map(
      orderedAttributes.map((attr) => [
        attr.property,
        attributeValues[attr.property] ??
          attributesMap.get(attr.property)?.defaultValue ??
          "",
      ]),
    );
  }, [orderedAttributes, attributeValues, attributesMap]);

  // filter out empty values (for some types at least)
  const updateFormValues = useCallback(
    (skipJsonUpdate = false) => {
      const filteredValues = Array.from(attributeFormValues.entries())
        .filter(([key, value]) => {
          if (
            attributesMap.get(key)?.datatype === "string" ||
            attributesMap.get(key)?.datatype === "number"
          ) {
            return value !== "";
          } else if (
            attributesMap.get(key)?.datatype === "string[]" ||
            attributesMap.get(key)?.datatype === "number[]"
          ) {
            return !(Array.isArray(value) && value.length === 0);
          } else if (attributesMap.get(key)?.datatype === "enum") {
            return value !== "";
          } else {
            return true;
          }
        })
        .reduce((obj, [key, value]) => {
          return { ...obj, [key]: value };
        }, {});
      const newValues = filteredValues ?? {};
      if (!isEqual(newValues, formValues)) {
        setFormValues(newValues);
        if (!skipJsonUpdate)
          setJsonAttributes(JSON.stringify(filteredValues, null, 2));
        onChange(filteredValues);
      }
    },
    [attributeFormValues, attributesMap, formValues, onChange],
  );

  useEffect(() => {
    // When the archetype changes, update the form values (this makes sure the JSON tab works correctly)
    updateFormValues();
  }, [archetypeId, updateFormValues]);

  const attributeInput = (attribute: SDKAttribute, i: number) => {
    if (attribute.archived) return null;
    let value = attributeFormValues.get(attribute.property);
    let dateValue = "";
    let options: { value: string; label: string }[] = [];
    if (
      attribute.datatype === "string[]" ||
      attribute.datatype === "number[]"
    ) {
      // prep for use in MultiSelectField
      if (Array.isArray(value)) {
        options = value.map((v: string) => ({ value: v, label: v }));
      } else if (typeof value === "string") {
        options = [{ value: value, label: value }];
        value = [value];
      }
    } else if (attribute.datatype === "string") {
      if (attribute.format === "date") {
        dateValue = typeof value === "string" ? value : "";
      }
    }
    return (
      <div className="" key={"formInput" + i}>
        <div
          className={`d-flex flex-row align-items-center justify-content-between p-1`}
        >
          <div className="col-6">{attribute.property}</div>
          <div className="col-6">
            {attribute.datatype === "boolean" ? (
              <Switch
                my="1"
                id={"form-toggle" + attribute.property}
                value={!!attributeFormValues.get(attribute.property)}
                onChange={(value) => {
                  attributeFormValues.set(attribute.property, value);
                  updateFormValues();
                }}
              />
            ) : attribute.datatype === "enum" ? (
              <SelectField
                value={value as string}
                onChange={(v) => {
                  // on change here does not trigger the form to change
                  attributeFormValues.set(attribute.property, v);
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
                options={options}
                value={Array.isArray(value) ? value : []}
                onChange={(value) => {
                  attributeFormValues.set(attribute.property, value);
                  updateFormValues();
                }}
                creatable={true}
              />
            ) : attribute.datatype === "string" ? (
              <>
                {attribute.format === "date" ? (
                  <DatePicker
                    precision="datetime"
                    date={dateValue ? new Date(dateValue) : undefined}
                    setDate={(v) => {
                      attributeFormValues.set(
                        attribute.property,
                        v ? format(v, "yyyy-MM-dd'T'HH:mm") : "",
                      );
                      updateFormValues();
                    }}
                  />
                ) : (
                  <Field
                    className=""
                    value={value as string}
                    onChange={(e) => {
                      attributeFormValues.set(
                        attribute.property,
                        e.target.value,
                      );
                      updateFormValues();
                    }}
                  />
                )}
              </>
            ) : attribute.datatype === "number" ? (
              <Field
                className=""
                type="number"
                value={value as string}
                onChange={(e) => {
                  attributeFormValues.set(attribute.property, e.target.value);
                  updateFormValues();
                }}
              />
            ) : (
              <Field
                className=""
                value={value as string}
                onChange={(e) => {
                  attributeFormValues.set(attribute.property, e.target.value);
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
        {!hideTitle && <h4>Attributes</h4>}
        <Tabs
          value={activeTab}
          onValueChange={(v: "simple" | "adv") => {
            setActiveTab(v);
            if (v === "adv") {
              try {
                const parsed = JSON.parse(jsonAttributes);
                setFormValues(parsed);
                onChange(parsed);
              } catch (e) {
                setJsonErrors(e.message);
              }
            } else {
              updateFormValues(true);
            }
          }}
        >
          <TabsList>
            <TabsTrigger value="simple">Form</TabsTrigger>
            <TabsTrigger value="adv">JSON</TabsTrigger>
          </TabsList>

          <div
            className={`${styles.attributeBox} pb-2 round appbox`}
            style={{ borderTopRightRadius: 0 }}
          >
            <TabsContent value="simple">
              <div className=" form-group ">
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
            </TabsContent>

            <TabsContent value="adv">
              <div className="p-2">
                <div className="form-group rounded">
                  <Field
                    label="JSON Values"
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
                    helpText="Enter user attributes in JSON format."
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
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </>
  );
}
