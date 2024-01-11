import { UseFormReturn } from "react-hook-form";
import React, { useEffect, useState } from "react";
import {
  FaExclamationCircle,
  FaExternalLinkAlt,
  FaInfoCircle,
  FaQuestionCircle,
} from "react-icons/fa";
import { FaGear } from "react-icons/fa6";
import { getConnectionsSDKCapabilities } from "shared/dist/sdk-versioning";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAttributeSchema } from "@/services/features";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import usePermissions from "@/hooks/usePermissions";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import SelectField from "../Forms/SelectField";
import Toggle from "../Forms/Toggle";

export interface Props {
  // eslint-disable-next-line
  form: UseFormReturn<any>;
}

export default function FallbackAttributeSelector({ form }: Props) {
  const [showSBToggle, setShowSBToggle] = useState(false);

  const { apiCall } = useAuth();
  const { refreshOrganization, hasCommercialFeature } = useUser();

  const permissions = usePermissions();
  const settings = useOrgSettings();
  const orgStickyBucketing = settings.useStickyBucketing;
  const hasStickyBucketFeature = hasCommercialFeature("sticky-bucketing");

  const { data: sdkConnectionsData } = useSDKConnections();
  const hasSDKWithStickyBucketing = getConnectionsSDKCapabilities(
    sdkConnectionsData?.connections || []
  ).includes("stickyBucketing");

  const attributeSchema = useAttributeSchema();
  const hasHashAttributes =
    attributeSchema.filter((x) => x.hashAttribute).length > 0;

  const hashAttribute = form.watch("hashAttribute");
  const fallbackAttribute = form.watch("fallbackAttribute");
  useEffect(() => {
    if (hashAttribute && hashAttribute === fallbackAttribute) {
      form.setValue("fallbackAttribute", "");
    }
  }, [hashAttribute, fallbackAttribute, form]);

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

  return (
    <SelectField
      containerClassName="flex-1"
      label="Fallback attribute"
      labelClassName="font-weight-bold"
      options={[
        { label: "none", value: "" },
        ...attributeSchema
          .filter((s) => !hasHashAttributes || s.hashAttribute)
          .filter((s) => s.property !== form.watch("hashAttribute"))
          .map((s) => ({ label: s.property, value: s.property })),
      ]}
      formatOptionLabel={({ value, label }) => {
        if (!value) {
          return <em className="text-muted">{label}</em>;
        }
        return label;
      }}
      sort={false}
      value={orgStickyBucketing ? form.watch("fallbackAttribute") || "" : ""}
      onChange={(v) => {
        form.setValue("fallbackAttribute", v);
      }}
      helpText={
        <>
          <div>
            If the user&apos;s assignment attribute is not available the
            fallback attribute may be used instead.
          </div>
          {(!orgStickyBucketing || showSBToggle) && (
            <div className="d-flex mt-1">
              <div className="text-warning-orange">
                <FaInfoCircle /> Requires Sticky Bucketing
              </div>
              <div className="flex-1" />
              {!showSBToggle ? (
                <>
                  {!orgStickyBucketing && <span>(disabled by org)</span>}
                  {permissions.organizationSettings && (
                    <a
                      role="button"
                      className="a ml-2"
                      onClick={() => setShowSBToggle(true)}
                    >
                      <FaGear size={13} />
                    </a>
                  )}
                </>
              ) : (
                <>
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
                        <span style={{ lineHeight: "14px" }}>
                          Enable Sticky Bucketing for org <FaQuestionCircle />
                        </span>
                      </PremiumTooltip>
                      <Toggle
                        id="orgStickyBucketingToggle"
                        value={!!orgStickyBucketing}
                        setValue={setOrgStickyBucketingToggle}
                        disabled={
                          !hasStickyBucketFeature || !hasSDKWithStickyBucketing
                        }
                        className="ml-2"
                        style={{ width: 70 }}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {showSBToggle && (
            <StickyBucketingToggleWarning
              hasSDKWithStickyBucketing={hasSDKWithStickyBucketing}
              iconSize={30}
            />
          )}
        </>
      }
      disabled={!orgStickyBucketing}
    />
  );
}

export function StickyBucketingTooltip() {
  return (
    <>
      <div className="mb-2">
        Sticky bucketing allows you to persist a user&apos;s assigned variation
        if any of the following change:
        <ol className="mt-1 mb-2" type="a">
          <li>the user logs in or logs out</li>
          <li>experiment targeting conditions change</li>
          <li>experiment traffic rules change</li>
        </ol>
      </div>
      <div>
        Enabling sticky bucketing also allows you to set fine controls over
        bucketing behavior, such as:
        <ul className="mt-1 mb-2">
          <li>
            assigning variations based on both a <code>user_id</code> and{" "}
            <code>anonymous_id</code>
          </li>
          <li>invalidating existing buckets</li>
        </ul>
      </div>
      <div className="mb-2">
        Sticky Bucketing is only supported in the following SDKs and versions:
        <ul className="mb-1">
          <li>Javascript &gt;= 0.32.0</li>
          <li>React &gt;= 0.22.0</li>
        </ul>
        Unsupported SDKs will fall back to standard hash-based bucketing.
      </div>
      <div className="text-warning-orange">
        <FaExclamationCircle /> You must enable this feature in your SDK
        integration code for it to take effect.
      </div>
    </>
  );
}

export function StickyBucketingToggleWarning({
  hasSDKWithStickyBucketing,
  iconSize,
}: {
  hasSDKWithStickyBucketing: boolean;
  iconSize?: number;
}) {
  return (
    <>
      {!hasSDKWithStickyBucketing ? (
        <div className="alert alert-danger px-2 pt-1 pb-2 mt-2 mb-0 d-flex align-items-center">
          <FaExclamationCircle className="ml-1 mr-2" size={iconSize} />
          <div className="mt-2 ml-1">
            <div className="mb-2">
              At least one SDK Connection with a compatible SDK is required to
              use Sticky Bucketing.
              <span className="mt-1">
                <a href="/sdks" className="a ml-1" target="_blank">
                  SDK Connections <FaExternalLinkAlt />
                </a>
              </span>
            </div>
            <div>
              Also ensure that Sticky Bucketing is correctly integrated with
              your SDK in your app codebase before using.
            </div>
          </div>
        </div>
      ) : (
        <div className="alert alert-warning px-2 py-2 mt-2 mb-0 d-flex align-items-center">
          <FaExclamationCircle className="ml-1 mr-2" size={iconSize} />
          <div className="ml-1">
            Ensure that Sticky Bucketing is correctly integrated with your SDK
            in your app codebase before using.
          </div>
        </div>
      )}
    </>
  );
}
