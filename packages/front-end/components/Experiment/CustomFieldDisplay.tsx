import React, { FC, useState } from "react";
import {
  CustomExperimentField,
  ExperimentInterfaceStringDates,
} from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { CustomField, CustomFieldSection } from "back-end/types/organization";
import { useUser } from "@/services/UserContext";
import {
  filterCustomFieldsForSectionAndProject,
  useCustomFields,
} from "@/services/experiments";
import { useAuth } from "@/services/auth";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import HeaderWithEdit from "../Layout/HeaderWithEdit";
import Modal from "../Modal";
import CustomFieldInput from "./CustomFieldInput";

const CustomFieldDisplay: FC<{
  label?: string;
  canEdit?: boolean;
  mutate?: () => void;
  section: CustomFieldSection;
  experiment: ExperimentInterfaceStringDates;
}> = ({
  label = "Additional Fields",
  canEdit = true,
  mutate,
  section,
  experiment,
}) => {
  const [editModal, setEditModal] = useState(false);
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    experiment.project
  );
  const customFieldsMap = new Map();
  const defaultFields: CustomExperimentField = {};
  if (customFields && customFields.length) {
    customFields.map((v) => {
      defaultFields[v.id] =
        v.type === "boolean"
          ? JSON.stringify(!!v.defaultValue)
          : v.type === "multiselect"
          ? JSON.stringify([v?.defaultValue ? v.defaultValue : ""])
          : "" + (v?.defaultValue ? v.defaultValue : "");
      customFieldsMap.set(v.id, v);
    });
  }

  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-exp-metadata");
  const form = useForm<Partial<ExperimentInterfaceStringDates>>({
    defaultValues: {
      customFields: experiment?.customFields || defaultFields,
    },
  });
  const { apiCall } = useAuth();
  if (customFields?.length) {
    return (
      <div className="mb-4">
        {editModal && (
          <Modal
            header={"Edit Custom Fields"}
            open={editModal}
            close={() => {
              setEditModal(false);
            }}
            size="lg"
            submit={form.handleSubmit(async (value) => {
              await apiCall(`/experiment/${experiment.id}`, {
                method: "POST",
                body: JSON.stringify({ ...value }),
              });

              if (mutate) mutate();
            })}
            cta="Save"
          >
            {hasCustomFieldAccess ? (
              <CustomFieldInput
                customFields={customFields}
                form={form}
                section={section}
                project={experiment.project}
              />
            ) : (
              <div className="text-center">
                <PremiumTooltip commercialFeature={"custom-exp-metadata"}>
                  Custom fields are available as part of the enterprise plan
                </PremiumTooltip>
              </div>
            )}
          </Modal>
        )}
        {label && (
          <HeaderWithEdit
            edit={
              canEdit &&
              hasCustomFieldAccess &&
              (() => {
                setEditModal(true);
              })
            }
            outerClassName="mb-2"
          >
            {label}
          </HeaderWithEdit>
        )}
        {experiment?.customFields && (
          <div className="">
            {Array.from(customFieldsMap.values()).map((v: CustomField) => {
              // these two loops are used to make sure the order is correct with the stored order of custom fields.
              return Object.keys(experiment?.customFields ?? {}).map(
                (fid, i) => {
                  if (v.id === fid) {
                    const f = experiment?.customFields?.[fid] ?? "";
                    const displayValue =
                      v.type === "multiselect" ? JSON.parse(f).join(", ") : f;
                    if (displayValue) {
                      if (v.type === "textarea" || v.type === "markdown") {
                        return (
                          <div className="mb-1 row" key={i}>
                            <div className="text-muted col-auto">{v.name}</div>
                            <div className="col">{displayValue}</div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="mb-1" key={i}>
                            <span className="text-muted">{v.name}</span>
                            {": "}
                            {displayValue}
                          </div>
                        );
                      }
                    }
                  }
                }
              );
            })}
          </div>
        )}
      </div>
    );
  }
};

export default CustomFieldDisplay;
