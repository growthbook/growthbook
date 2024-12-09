import React, { FC, useState } from "react";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useForm } from "react-hook-form";
import { CustomField, CustomFieldSection } from "back-end/types/custom-fields";
import { FeatureInterface } from "back-end/types/feature";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  useCustomFields,
  filterCustomFieldsForSectionAndProject,
} from "@/hooks/useCustomFields";
import Markdown from "@/components/Markdown/Markdown";
import Modal from "@/components/Modal";
import DataList, { DataListItem } from "@/components/Radix/DataList";
import CustomFieldInput from "./CustomFieldInput";

const CustomFieldDisplay: FC<{
  label?: string;
  canEdit?: boolean;
  mutate?: () => void;
  addBox?: boolean;
  className?: string;
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
}> = ({
  label = "Additional Fields",
  canEdit = true,
  mutate,
  addBox = false,
  className = "",
  section,
  target,
}) => {
  const [editModal, setEditModal] = useState(false);
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    target.project
  );
  const customFieldsMap = new Map();
  const defaultFields: Record<string, string> = {};
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

  const currentCustomFields = target?.customFields || {};
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");
  const form = useForm<
    Partial<ExperimentInterfaceStringDates | FeatureInterface>
  >({
    defaultValues: {
      customFields: target?.customFields || defaultFields,
    },
  });
  const { apiCall } = useAuth();
  const submitForm = async (value) => {
    if (section === "experiment") {
      await apiCall(`/experiment/${target.id}`, {
        method: "POST",
        body: JSON.stringify({ ...value }),
      });
    } else if (section === "feature") {
      await apiCall(`/feature/${target.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...value }),
      });
    }
    if (mutate) mutate();
  };
  if (!customFields || customFields?.length === 0) {
    return <></>;
  }

  const displayFieldsObj: DataListItem[] = [];
  const currentValueMap = new Map(
    Object.entries(currentCustomFields ?? {}).map(([fid, cValue]) => [
      fid,
      cValue ?? "",
    ])
  );
  const getMultiSelectValue = (value: string) => {
    try {
      return JSON.parse(value).join(", ");
    } catch (e) {
      return value;
    }
  };
  const getDisplayValue = (v: CustomField, cValue: string) => {
    return v.type === "multiselect" ? (
      getMultiSelectValue(cValue)
    ) : v.type === "markdown" ? (
      <Markdown className="card-text">{cValue ?? ""}</Markdown>
    ) : v.type === "textarea" ? (
      <div style={{ whiteSpace: "pre" }}>{cValue ?? ""}</div>
    ) : v.type === "url" && cValue !== "" ? (
      <a href={cValue} target="_blank" rel="noreferrer">
        {cValue ?? ""}
      </a>
    ) : v.type === "boolean" ? (
      <>{cValue ? "yes" : "no"}</>
    ) : cValue ? (
      cValue
    ) : (
      <em className="text-muted">none</em>
    );
  };

  Array.from(customFieldsMap.values()).forEach((v: CustomField) => {
    displayFieldsObj.push({
      label: v.name,
      value: getDisplayValue(v, currentValueMap.get(v.id) ?? ""),
      tooltip: v.description,
    });
  });

  return (
    <div className="mb-4">
      {editModal && (
        <Modal
          trackingEventModalType="edit-custom-fields"
          header={"Edit Custom Fields"}
          open={editModal}
          close={() => {
            setEditModal(false);
          }}
          size="lg"
          submit={form.handleSubmit(async (value) => {
            await submitForm(value);
          })}
          cta="Save"
        >
          {hasCustomFieldAccess ? (
            <CustomFieldInput
              customFields={customFields}
              form={form}
              section={section}
              project={target.project}
            />
          ) : (
            <div className="text-center">
              <PremiumTooltip commercialFeature={"custom-metadata"}>
                Custom fields are available as part of the enterprise plan
              </PremiumTooltip>
            </div>
          )}
        </Modal>
      )}
      {displayFieldsObj && (
        <div className={`${addBox ? "appbox px-4 py-3" : ""} ${className}`}>
          <div className="d-flex flex-row align-items-center justify-content-between text-dark mb-4">
            <h4 className="m-0">{label ? label : ""}</h4>
            <div className="flex-1" />
            {canEdit && hasCustomFieldAccess ? (
              <>
                <button
                  className="btn p-0 link-purple"
                  onClick={() => {
                    setEditModal(true);
                  }}
                >
                  <span className="text-purple">Edit</span>
                </button>
              </>
            ) : (
              <></>
            )}
          </div>
          <DataList data={displayFieldsObj} maxColumns={3} />
        </div>
      )}
    </div>
  );
};

export default CustomFieldDisplay;
