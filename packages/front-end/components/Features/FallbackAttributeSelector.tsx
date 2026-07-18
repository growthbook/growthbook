import { UseFormReturn } from "react-hook-form";
import React, { useEffect, useState } from "react";
import { FaInfoCircle, FaQuestionCircle } from "react-icons/fa";
import { FaGear } from "react-icons/fa6";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKAttribute } from "shared/types/organization";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import useOrgSettings from "@/hooks/useOrgSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import { DocLink } from "@/components/DocLink";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import {
  AttributeOptionWithTooltip,
  type AttributeOptionForTooltip,
} from "@/components/Features/AttributeOptionTooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SDKCapabilityWarning from "./SDKCapabilityWarning";

export interface Props {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  attributeSchema: SDKAttribute[];
}

export default function FallbackAttributeSelector({
  form,
  attributeSchema,
}: Props) {
  const [showSBInformation, setShowSBInformation] = useState(false);

  const { apiCall } = useAuth();
  const { refreshOrganization, hasCommercialFeature } = useUser();

  const permissionsUtil = usePermissionsUtil();
  const settings = useOrgSettings();
  const orgStickyBucketing = settings.useStickyBucketing;
  const orgFallbackAttribute = settings.useFallbackAttributes;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections || [],
  }).includes("stickyBucketing");

  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttribute = form.watch("hashAttribute");
  const fallbackAttribute = form.watch("fallbackAttribute");
  const disableStickyBucketing = !!form.watch("disableStickyBucketing");

  useEffect(() => {
    if (hashAttribute && hashAttribute === fallbackAttribute) {
      form.setValue("fallbackAttribute", "");
    }
  }, [hashAttribute, fallbackAttribute, form]);

  useEffect(() => {
    if (disableStickyBucketing && fallbackAttribute) {
      form.setValue("fallbackAttribute", "");
    }
  }, [disableStickyBucketing, fallbackAttribute, form]);

  const setOrgStickyBucketingToggle = async (v: boolean) => {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: {
          useStickyBucketing: v,
        },
      }),
    });
    await refreshOrganization();
  };

  if (!orgFallbackAttribute) {
    return null;
  }

  const fallbackAttributeOptions = [
    { label: "none", value: "" },
    ...attributeSchema
      .filter((s) => !hasHashAttributes || s.hashAttribute)
      .filter((s) => s.property !== form.watch("hashAttribute"))
      .map((s) => ({
        label: s.property,
        value: s.property,
        description: s.description,
        tags: s.tags,
        datatype: s.datatype,
        hashAttribute: s.hashAttribute,
      })),
  ];

  // If the current fallbackAttribute isn't in the list (it was archived or has been project-scoped), add it for backwards compatibility
  if (
    fallbackAttribute &&
    !fallbackAttributeOptions.find((o) => o.value === fallbackAttribute)
  ) {
    fallbackAttributeOptions.push({
      label: fallbackAttribute,
      value: fallbackAttribute,
      description: undefined,
      tags: undefined,
      datatype: undefined,
      hashAttribute: undefined,
    });
  }

  return (
    <Flex direction="column" flexGrow="1" mt="4">
      <Text as="label" color="text-high" weight="semibold" mb="1">
        Fallback Attribute
      </Text>
      <Text as="div" color="text-mid" mb="2">
        If the user&apos;s assignment attribute is not available the fallback
        attribute may be used instead.
      </Text>
      <SelectField
        withRadixThemedPortal
        options={fallbackAttributeOptions}
        formatOptionLabel={(o, meta) => {
          if (!o.value) {
            return <em className="text-muted">{o.label}</em>;
          }
          return (
            <AttributeOptionWithTooltip
              option={o as AttributeOptionForTooltip}
              context={meta.context}
            >
              {o.label}
            </AttributeOptionWithTooltip>
          );
        }}
        sort={false}
        value={
          orgStickyBucketing && !disableStickyBucketing
            ? form.watch("fallbackAttribute") || ""
            : ""
        }
        onChange={(v) => {
          form.setValue("fallbackAttribute", v);
        }}
        disabled={!orgStickyBucketing || disableStickyBucketing}
        helpText={
          <>
            {/* todo: so long as `settings.useFallbackAttributes` gates this field, we should never see these embedded controls. Keeping them here for now in case we stop gating this field.*/}
            {(!orgStickyBucketing || showSBInformation) && (
              <div className="d-flex mt-1">
                <div className="text-warning-orange">
                  <FaInfoCircle /> Requires Sticky Bucketing
                </div>
                <div className="flex-1" />
                {!showSBInformation ? (
                  <>
                    {!orgStickyBucketing && <span>(disabled by org)</span>}
                    {permissionsUtil.canManageOrgSettings() && (
                      <a
                        role="button"
                        className="a ml-2"
                        onClick={() => setShowSBInformation(true)}
                      >
                        <FaGear size={13} />
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    {hasSDKWithStickyBucketing && (
                      <div
                        className="position-relative"
                        style={{ top: 1, maxWidth: 180 }}
                      >
                        <div className="d-flex align-items-center justify-content-end">
                          <PremiumTooltip
                            commercialFeature={"sticky-bucketing"}
                            usePortal={true}
                            className="text-right"
                            innerClassName="text-left"
                            body={<StickyBucketingTooltip />}
                          >
                            <div
                              className="d-inline-block"
                              style={{ lineHeight: "14px" }}
                            >
                              Enable Sticky Bucketing for org{" "}
                              <FaQuestionCircle />
                            </div>
                          </PremiumTooltip>
                          <Switch
                            id="orgStickyBucketingToggle"
                            value={!!orgStickyBucketing}
                            onChange={setOrgStickyBucketingToggle}
                            disabled={
                              !hasStickyBucketFeature ||
                              !hasSDKWithStickyBucketing
                            }
                            ml="2"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        }
      />
      {disableStickyBucketing ? (
        <Text as="div" color="text-mid" size="small" mt="1">
          Fallback attributes require Sticky Bucketing, which is disabled for
          this experiment.
        </Text>
      ) : (
        (orgStickyBucketing || showSBInformation) && (
          <SDKCapabilityWarning
            as={fallbackAttribute ? "callout" : "helperText"}
            capability="stickyBucketing"
            icon={fallbackAttribute ? undefined : null}
            popoverTriggerText={
              fallbackAttribute ? undefined : "Show incompatible SDKs"
            }
            someMessage={
              fallbackAttribute ? (
                "Some of your SDK Connections do not support Sticky Bucketing."
              ) : (
                <>
                  Ensure that Sticky Bucketing is correctly integrated (
                  <DocLink
                    useRadix={false}
                    docSection="stickyBucketing"
                    className="underline"
                  >
                    see docs
                  </DocLink>
                  ) with your SDK.
                </>
              )
            }
            noneMessage="None of your SDK Connections support Sticky Bucketing."
            mt="1"
          />
        )
      )}
    </Flex>
  );
}

export function StickyBucketingTooltip() {
  return (
    <>
      Sticky Bucketing prevents users from flipping between variations when you
      make changes to a running experiment. It does this by persisting the first
      variation each user is exposed to.
    </>
  );
}
