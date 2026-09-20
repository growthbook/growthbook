import React, { FC, useState } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { CustomField, CustomFieldSection } from "shared/types/custom-fields";
import { FeatureInterface } from "shared/types/feature";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { useUser } from "@/services/UserContext";
import { useCustomFields } from "@/hooks/useCustomFields";
import {
  filterCustomFieldsForSectionAndProject,
  isCustomFieldBooleanTrue,
  toCustomFieldBooleanString,
} from "@/services/customFields";
import Markdown from "@/components/Markdown/Markdown";
import DataList, { DataListItem } from "@/ui/DataList";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import CustomFieldEditModal, {
  CustomFieldDraftInfo,
} from "./CustomFieldEditModal";

const CustomFieldDisplay: FC<{
  label?: string;
  canEdit?: boolean;
  mutate?: () => void;
  className?: string;
  section: CustomFieldSection;
  target: ExperimentInterfaceStringDates | FeatureInterface;
  mt?: "1" | "2" | "3" | "4" | "5" | "6";
  /** When provided, the edit modal shows a draft callout and "Save to Draft" CTA. */
  draftInfo?: CustomFieldDraftInfo;
  /**
   * With every field empty, collapse to a "+ {label}" button. A required field
   * is always shown, so it can't be missed behind the button.
   */
  collapseWhenEmpty?: boolean;
  /** Label above each value, to sit alongside other metadata in a narrow column. */
  stacked?: boolean;
}> = ({
  label = "Additional Fields",
  canEdit = true,
  mutate,
  className = "",
  section,
  target,
  mt,
  draftInfo,
  collapseWhenEmpty,
  stacked,
}) => {
  const [editModal, setEditModal] = useState(false);

  const customFields = filterCustomFieldsForSectionAndProject(
    useCustomFields(),
    section,
    target.project,
  );

  const currentCustomFields = target.customFields || {};
  const { hasCommercialFeature } = useUser();
  const hasCustomFieldAccess = hasCommercialFeature("custom-metadata");

  if (!customFields?.length || !hasCustomFieldAccess) {
    return null;
  }

  const displayFieldsObj: DataListItem[] = [];
  const currentValueMap = new Map(
    Object.entries(currentCustomFields ?? {}).map(([fid, cValue]) => [
      fid,
      cValue ?? "",
    ]),
  );
  const hasAnyValue = customFields.some((v) => {
    const cValue = currentValueMap.get(v.id);
    return typeof cValue === "boolean" ? true : !!String(cValue ?? "").trim();
  });
  // Stacked mode gives every field its own metadata row, edited from whatever
  // owns the column, so there is nothing to collapse behind a button.
  const showAddButton =
    !stacked &&
    !!collapseWhenEmpty &&
    !hasAnyValue &&
    !customFields.some((v) => v.required);

  const getMultiSelectValue = (value: string) => {
    try {
      return JSON.parse(value).join(", ");
    } catch (e) {
      return value;
    }
  };
  const getDisplayValue = (v: CustomField, cValue: unknown) => {
    const stringValue =
      typeof cValue === "boolean"
        ? toCustomFieldBooleanString(cValue)
        : String(cValue ?? "");

    switch (v.type) {
      case "multiselect":
        return getMultiSelectValue(stringValue);
      case "markdown":
        return <Markdown className="card-text">{stringValue}</Markdown>;
      case "textarea":
        return <div style={{ whiteSpace: "pre" }}>{stringValue}</div>;
      case "url":
        if (stringValue !== "") {
          return (
            <a href={stringValue} target="_blank" rel="noreferrer">
              {stringValue}
            </a>
          );
        }
        break;
      case "boolean":
        return <>{isCustomFieldBooleanTrue(cValue) ? "yes" : "no"}</>;
      case "date":
        if (stringValue) {
          return new Date(stringValue).toLocaleDateString();
        }
        break;
      case "datetime":
        if (stringValue) {
          return new Date(stringValue).toLocaleString();
        }
        break;
      case "text":
      case "enum":
      case "number":
        break;
      default: {
        const exhaustiveCheck: never = v.type;
        return exhaustiveCheck;
      }
    }

    return stringValue || <Text color="text-mid">--</Text>;
  };

  customFields.forEach((v) => {
    displayFieldsObj.push({
      label: v.name,
      value: getDisplayValue(v, currentValueMap.get(v.id) ?? ""),
      tooltip: v.description,
    });
  });

  if (showAddButton) {
    return canEdit ? (
      <>
        {editModal && (
          <CustomFieldEditModal
            section={section}
            target={target}
            close={() => setEditModal(false)}
            mutate={mutate}
            draftInfo={draftInfo}
          />
        )}
        <Box py="1">
          <Link onClick={() => setEditModal(true)}>
            <Flex align="center" gap="1">
              <PiPlus size="15" />
              <Text weight="semibold">{label}</Text>
            </Flex>
          </Link>
        </Box>
      </>
    ) : null;
  }

  const editLink = canEdit ? (
    <Link onClick={() => setEditModal(true)}>
      <Text weight="semibold">Edit</Text>
    </Link>
  ) : null;

  const editModalNode = editModal ? (
    <CustomFieldEditModal
      section={section}
      target={target}
      close={() => setEditModal(false)}
      mutate={mutate}
      draftInfo={draftInfo}
    />
  ) : null;

  if (stacked) {
    return (
      <>
        {editModalNode}
        <Flex direction="column" gap="4">
          {customFields.map((field) => {
            const value = currentValueMap.get(field.id) ?? "";
            return (
              <Metadata
                stacked
                key={field.id}
                label={field.name}
                value={
                  value === "" ? (
                    <Text weight="regular" color="text-mid">
                      None
                    </Text>
                  ) : (
                    getDisplayValue(field, value)
                  )
                }
              />
            );
          })}
        </Flex>
      </>
    );
  }

  return (
    <>
      {editModal && (
        <CustomFieldEditModal
          section={section}
          target={target}
          close={() => setEditModal(false)}
          mutate={mutate}
          draftInfo={draftInfo}
        />
      )}
      {section === "feature" ? (
        <>
          <Flex justify="between" align="center" mt={mt}>
            <Flex align="center" gap="1">
              <Heading as="h4" size="sm" mb="0">
                {label ? label : ""}
              </Heading>
            </Flex>
            <div className="flex-1" />
            {editLink}
          </Flex>
          <DataList data={displayFieldsObj} maxColumns={3} />
        </>
      ) : (
        <Frame className={className} my="3">
          <Box>
            <Flex justify="between" align="center" mb="3">
              <Heading color="text-high" as="h4" size="sm" mb="0">
                {label ? label : ""}
              </Heading>
              <div className="flex-1" />
              {editLink}
            </Flex>
            <DataList data={displayFieldsObj} maxColumns={3} />
          </Box>
        </Frame>
      )}
    </>
  );
};

export default CustomFieldDisplay;
