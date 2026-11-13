import { UseFormReturn } from "react-hook-form";
import React, { useCallback, useEffect, useState } from "react";
import { FaInfoCircle, FaQuestionCircle } from "react-icons/fa";
import { FaGear } from "react-icons/fa6";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { SDKAttribute } from "shared/types/organization";
import { Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAttributeSchema } from "@/services/features";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import { DocLink } from "@/components/DocLink";
import SelectField from "@/components/Forms/SelectField";
import Switch from "@/ui/Switch";
import {
  formatAttributeOptionLabel,
  toAttributeOption,
} from "@/components/Features/AttributeOptionTooltip";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SDKCapabilityWarning from "./SDKCapabilityWarning";

// Its options, and a reset that keeps it off the assignment attribute; the
// current value stays selectable when archived or out of scope, with its
// tooltip metadata.
export function useFallbackAttributeOptions({
  attributeSchema,
  hashAttribute,
  fallbackAttribute,
  setFallbackAttribute,
}: {
  attributeSchema: SDKAttribute[];
  hashAttribute: string | undefined;
  fallbackAttribute: string | undefined;
  setFallbackAttribute?: (v: string) => void;
}) {
  const allAttributeSchema = useAttributeSchema(true);

  useEffect(() => {
    if (hashAttribute && hashAttribute === fallbackAttribute) {
      setFallbackAttribute?.("");
    }
  }, [hashAttribute, fallbackAttribute, setFallbackAttribute]);

  const hasHashAttributes = attributeSchema.some((x) => x.hashAttribute);
  const options = [
    { label: "none", value: "" },
    ...attributeSchema
      .filter((s) => !hasHashAttributes || s.hashAttribute)
      .filter((s) => s.property !== hashAttribute)
      .map(toAttributeOption),
  ];
  if (
    fallbackAttribute &&
    !options.some((o) => o.value === fallbackAttribute)
  ) {
    const full = allAttributeSchema.find(
      (s) => s.property === fallbackAttribute,
    );
    options.push({
      label: fallbackAttribute,
      value: fallbackAttribute,
      description: full?.description,
      tags: full?.tags,
      datatype: full?.datatype,
      hashAttribute: full?.hashAttribute,
      projects: full?.projects,
    });
  }
  return options;
}

export function formatFallbackAttributeLabel(
  o: { label: string; value: string },
  meta: { context: string },
) {
  if (!o.value) {
    return (
      <Text fontStyle="italic" color="text-low">
        {o.label}
      </Text>
    );
  }
  return formatAttributeOptionLabel(o, meta);
}

export interface Props {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  attributeSchema: SDKAttribute[];
  extraIndicator?: React.ReactNode;
}

export default function FallbackAttributeSelector({
  form,
  attributeSchema,
  extraIndicator,
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

  const hashAttribute = form.watch("hashAttribute");
  const fallbackAttribute = form.watch("fallbackAttribute");
  const disableStickyBucketing = !!form.watch("disableStickyBucketing");
  const setFallbackAttribute = useCallback(
    (v: string) => form.setValue("fallbackAttribute", v),
    [form],
  );
  const fallbackAttributeOptions = useFallbackAttributeOptions({
    attributeSchema,
    hashAttribute,
    fallbackAttribute,
    setFallbackAttribute,
  });

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
        size="legacy"
        withRadixThemedPortal
        extraIndicator={extraIndicator}
        options={fallbackAttributeOptions}
        formatOptionLabel={formatFallbackAttributeLabel}
        sort={false}
        value={
          orgStickyBucketing && !disableStickyBucketing
            ? form.watch("fallbackAttribute") || ""
            : ""
        }
        onChange={setFallbackAttribute}
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
        <Text as="div" color="text-mid" size="sm" mt="1">
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
