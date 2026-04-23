import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Namespaces } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";

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
  const existingNamespace = existing?.namespace;
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
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
      useRadixButton={true}
      cta={existing ? "Update" : "Create"}
      header={existing ? "Edit Namespace" : "Create Namespace"}
      submit={form.handleSubmit(async (value) => {
        const body = {
          label: value.label,
          description: value.description,
          status: value.status,
          hashAttribute: value.hashAttribute,
          format: "multiRange",
        };

        if (existing) {
          await apiCall(
            `/organization/namespaces/${
              existingNamespace?.name
                ? encodeURIComponent(existingNamespace.name)
                : ""
            }`,
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
      <Field label="Name" maxLength={60} required {...form.register("label")} />
      {existingNamespace && (
        <Text color="text-mid" size="small" as="p" mb="5" mt="-1">
          ID: <strong>{existingNamespace.name}</strong>
          <br />
          Used as the namespace hash seed and cannot be changed.
        </Text>
      )}
      <Field label="Description" textarea {...form.register("description")} />

      <SelectField
        label="Hash Attribute"
        required
        disabled={hasExperiments}
        options={hashAttributeOptions}
        value={selectedHashAttribute}
        onChange={(value) => {
          form.setValue("hashAttribute", value);
        }}
      />
      {hasExperiments ? (
        <HelperText status="info" mt="1">
          Cannot be changed while experiments are using this namespace.
        </HelperText>
      ) : (
        <HelperText status="info" mt="1">
          The user attribute used for namespace allocation.
        </HelperText>
      )}
    </Modal>
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
  const existingNamespace = existing.namespace;

  const form = useForm<Omit<NamespaceFormValue, "hashAttribute">>({
    defaultValues: {
      label: existingNamespace.label || existingNamespace.name || "",
      description: existingNamespace.description || "",
      status: existingNamespace.status || "active",
    },
  });
  const { apiCall } = useAuth();

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
      useRadixButton={true}
      cta="Update"
      header="Edit Legacy Namespace"
      submit={form.handleSubmit(async (value) => {
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
        This is a legacy namespace. To use the new multi-range features, create
        a new namespace.
      </Callout>
      <Field label="Name" maxLength={60} required {...form.register("label")} />
      <Text color="text-mid" size="small" as="p" mb="5" mt="-1">
        ID: <strong>{existingNamespace.name}</strong>
        <br />
        Used as the namespace hash seed and cannot be changed.
      </Text>
      <Field label="Description" textarea {...form.register("description")} />
    </Modal>
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
