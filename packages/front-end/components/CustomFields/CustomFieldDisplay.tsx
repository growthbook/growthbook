import React, { FC, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { useForm } from "react-hook-form";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { FeatureInterface } from "shared/types/feature";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import {
  useCustomFields,
  filterCustomFieldsForSectionAndProject,
} from "@/hooks/useCustomFields";
import Markdown from "@/components/Markdown/Markdown";
import Modal from "@/components/Modal";
import DataList, { DataListItem } from "@/ui/DataList";
import Button from "@/ui/Button";
import Frame from "@/ui/Frame";
import CustomFieldInput from "./CustomFieldInput";

const CustomFieldDisplay: FC<{
  label?: string;
  canEdit?: boolean;
  mutate?: () => void;
  className?: string;
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
}> = ({
  label = "Additional Fields",
  canEdit = true,
  mutate,
  className = "",
  section,
  target,
}) => {
  const [editModal, setEditModal] = useState(false);
  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    target.project,
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
    ]),
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

  if (!hasCustomFieldAccess) return null;

  return (
    <Box>
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
              section={section}
              project={target.project}
              setCustomFields={(value) => {
                form.setValue("customFields", value);
              }}
              currentCustomFields={form.watch("customFields") || {}}
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
        <Frame className={className} my="3">
          <Box>
            <Flex justify="between" align="center">
              <Heading as="h4" size="3">
                {label ? label : ""}
              </Heading>
              <div className="flex-1" />
              {canEdit && hasCustomFieldAccess ? (
                <>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditModal(true);
                    }}
                  >
                    Edit
                  </Button>
                </>
              ) : (
                <></>
              )}
            </Flex>
            <DataList data={displayFieldsObj} maxColumns={3} />
          </Box>
        </Frame>
      )}
    </Box>
  );
};

export default CustomFieldDisplay;
