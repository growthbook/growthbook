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
import HeaderWithEdit from "@/components/Layout/HeaderWithEdit";
import Modal from "@/components/Modal";
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
  addBox = true,
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
  // try {
  //   const customFieldStrings = target?.customFields ?? "{}";
  //   currentCustomFields = customFieldStrings
  //     ? JSON.parse(customFieldStrings)
  //     : {};
  // } catch (e) {
  //   console.error(e);
  // }
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-exp-metadata");
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
            canEdit && hasCustomFieldAccess
              ? () => {
                  setEditModal(true);
                }
              : undefined
          }
          containerClassName="mb-2"
        >
          {label}
        </HeaderWithEdit>
      )}
      {currentCustomFields && Object.keys(currentCustomFields).length > 0 && (
        <div className={`${addBox ? "appbox p-3" : ""} ${className}`}>
          {Array.from(customFieldsMap.values()).map((v: CustomField) => {
            // these two loops are used to make sure the order is correct with the stored order of custom fields.
            return Object.keys(currentCustomFields ?? {}).map((fid, i) => {
              if (v.id === fid) {
                const f = currentCustomFields?.[fid] ?? "";
                const displayValue =
                  v.type === "multiselect" ? JSON.parse(f).join(", ") : f;
                if (displayValue) {
                  return (
                    <div className="mb-3 row" key={i}>
                      <div className="text-muted col-sm-2 col-md-2 col-lg-2 col-3">
                        {v.name}
                      </div>
                      <div className="col">
                        {v.type === "markdown" ? (
                          <Markdown className="card-text">
                            {displayValue || ""}
                          </Markdown>
                        ) : v.type === "textarea" ? (
                          <div style={{ whiteSpace: "pre" }}>
                            {displayValue}
                          </div>
                        ) : v.type === "url" ? (
                          <a
                            href={displayValue}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {displayValue}
                          </a>
                        ) : (
                          <> {displayValue}</>
                        )}
                      </div>
                    </div>
                  );
                }
              }
            });
          })}
        </div>
      )}
    </div>
  );
};

export default CustomFieldDisplay;
