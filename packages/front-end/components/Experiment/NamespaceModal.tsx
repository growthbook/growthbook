import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Namespaces } from "shared/types/organization";
import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { Box } from "@radix-ui/themes";
import { Trans, useLingui } from "@lingui/react/macro";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import useSDKConnections from "@/hooks/useSDKConnections";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Callout from "@/ui/Callout";
import SDKCapabilityWarning from "@/components/Features/SDKCapabilityWarning";

type NamespaceFormValue = {
  label: string;
  description: string;
  status: "active" | "inactive";
  hashAttribute: string;
};

function MultiRangeNamespaceModal({
  close,
  onSuccess,
  existing,
}: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
  existing: {
    namespace: Namespaces;
    experiments: number;
  } | null;
}) {
  const { t } = useLingui();
  const existingNamespace = existing?.namespace;
  const existingNamespaceName = existingNamespace?.name;
  const hasExperiments = (existing?.experiments ?? 0) > 0;
  const settings = useOrgSettings();
  const attributes = useMemo(
    () => settings?.attributeSchema || [],
    [settings?.attributeSchema],
  );

  const form = useForm<NamespaceFormValue>({
    defaultValues: {
      label: existingNamespace?.label || existingNamespace?.name || "",
      description: existingNamespace?.description || "",
      status: existingNamespace?.status || "active",
      hashAttribute:
        (existingNamespace?.format === "multiRange"
          ? existingNamespace.hashAttribute
          : "") ||
        attributes.find((a) => a.hashAttribute)?.property ||
        "id",
    },
  });
  const { apiCall } = useAuth();
  const isNewNamespace = !existing;
  const { data: sdkConnectionsData } = useSDKConnections();
  const hasIncompatibleConnections = useMemo(
    () =>
      (sdkConnectionsData?.connections ?? []).some(
        (c) => !getConnectionSDKCapabilities(c).includes("namespacesV2"),
      ),
    [sdkConnectionsData],
  );
  const [useLegacyFormat, setUseLegacyFormat] = useState(
    () =>
      existingNamespace?.format === "legacy" ||
      (isNewNamespace && hasIncompatibleConnections) ||
      false,
  );
  useEffect(() => {
    if (isNewNamespace && hasIncompatibleConnections) setUseLegacyFormat(true);
  }, [isNewNamespace, hasIncompatibleConnections]);
  const selectedHashAttribute =
    (useWatch({
      control: form.control,
      name: "hashAttribute",
    }) as string | undefined) || "";

  const hashAttributeOptions = useMemo(() => {
    const options = attributes
      .filter((a) => !a.archived && a.hashAttribute)
      .map((a) => ({
        label: a.property,
        value: a.property,
      }));

    if (
      selectedHashAttribute &&
      !options.find((option) => option.value === selectedHashAttribute)
    ) {
      options.push({
        label: selectedHashAttribute,
        value: selectedHashAttribute,
      });
    }

    return options;
  }, [attributes, selectedHashAttribute]);

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
      cta={existing ? t`Update` : t`Create`}
      header={existing ? t`Edit Namespace` : t`Create Namespace`}
      submit={validatedSubmit(form, async (value) => {
        const isMultiRange = !useLegacyFormat && !!value.hashAttribute;
        const body = {
          label: value.label,
          description: value.description,
          status: value.status,
          format: isMultiRange ? "multiRange" : "legacy",
          ...(isMultiRange && { hashAttribute: value.hashAttribute }),
        };

        if (existing) {
          await apiCall(
            `/organization/namespaces/${encodeURIComponent(existingNamespace!.name)}`,
            {
              method: "PUT",
              body: JSON.stringify(body),
            },
          );
        } else {
          await apiCall(`/organization/namespaces`, {
            method: "POST",
            body: JSON.stringify(body),
          });
        }
        await onSuccess();
      })}
    >
      <Field
        size="legacy"
        label={t`Name`}
        maxLength={60}
        required
        {...form.register("label")}
      />
      {existingNamespace && (
        <Text color="text-mid" size="sm" as="p" mb="5" mt="-1">
          <Trans>
            ID: <strong>{existingNamespaceName}</strong>
            <br />
            Used as the namespace hash seed and cannot be changed.
          </Trans>
        </Text>
      )}
      <Field
        size="legacy"
        label={t`Description`}
        textarea
        {...form.register("description")}
      />

      {isNewNamespace && (
        <>
          <Checkbox
            label={t`Use legacy format`}
            description={t`For SDKs that don't support multi-range namespaces`}
            value={useLegacyFormat}
            setValue={setUseLegacyFormat}
            mb="3"
          />
          <SDKCapabilityWarning
            as={useLegacyFormat ? "helperText" : "callout"}
            capability="namespacesV2"
            someMessage={t`Some of your SDK Connections may not support multi-range namespaces.`}
            noneMessage={t`None of your SDK Connections support multi-range namespaces.`}
            mb="3"
          />
        </>
      )}

      {!useLegacyFormat && (
        <Box mt="4">
          <Text as="label" weight="semibold" mb="1">
            <Trans>Hash Attribute</Trans>
          </Text>
          <Text as="div" color="text-mid" mb="2">
            <Trans>The user attribute used for namespace allocation.</Trans>
          </Text>
          <SelectField
            size="legacy"
            required
            disabled={hasExperiments}
            options={hashAttributeOptions}
            value={selectedHashAttribute}
            onChange={(value) => {
              form.setValue("hashAttribute", value);
            }}
          />
          {hasExperiments && (
            <HelperText status="info" mt="1">
              <Trans>
                Cannot be changed while experiments are using this namespace.
              </Trans>
            </HelperText>
          )}
        </Box>
      )}
    </ModalStandard>
  );
}

function LegacyNamespaceModal({
  close,
  onSuccess,
  existing,
}: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
  existing: {
    namespace: Namespaces;
    experiments: number;
  };
}) {
  const { t } = useLingui();
  const existingNamespace = existing.namespace;
  const existingNamespaceName = existingNamespace.name;

  const form = useForm<Omit<NamespaceFormValue, "hashAttribute">>({
    defaultValues: {
      label: existingNamespace.label || existingNamespace.name || "",
      description: existingNamespace.description || "",
      status: existingNamespace.status || "active",
    },
  });
  const { apiCall } = useAuth();

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
      cta={t`Update`}
      header={t`Edit Legacy Namespace`}
      submit={validatedSubmit(form, async (value) => {
        const body = {
          ...value,
          format: "legacy",
        };

        await apiCall(
          `/organization/namespaces/${encodeURIComponent(
            existingNamespace.name,
          )}`,
          {
            method: "PUT",
            body: JSON.stringify(body),
          },
        );
        await onSuccess();
      })}
    >
      <Callout status="info" mb="3">
        <Trans>
          This is a legacy namespace. To use the new multi-range features,
          create a new namespace.
        </Trans>
      </Callout>
      <Field
        size="legacy"
        label={t`Name`}
        maxLength={60}
        required
        {...form.register("label")}
      />
      <Text color="text-mid" size="sm" as="p" mb="5" mt="-1">
        <Trans>
          ID: <strong>{existingNamespaceName}</strong>
          <br />
          Used as the namespace hash seed and cannot be changed.
        </Trans>
      </Text>
      <Field
        size="legacy"
        label={t`Description`}
        textarea
        {...form.register("description")}
      />
    </ModalStandard>
  );
}

export default function NamespaceModal(props: {
  close: () => void;
  onSuccess: () => Promise<void> | void;
  existing: {
    namespace: Namespaces;
    experiments: number;
  } | null;
}) {
  const existingNamespace = props.existing?.namespace;

  if (existingNamespace && existingNamespace.format !== "multiRange") {
    return (
      <LegacyNamespaceModal
        {...props}
        existing={
          props.existing as { namespace: Namespaces; experiments: number }
        }
      />
    );
  }

  return <MultiRangeNamespaceModal {...props} />;
}
