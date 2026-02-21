import { useForm } from "react-hook-form";
import { Namespaces } from "shared/types/organization";
import { useAuth } from "@/services/auth";
import useOrgSettings from "@/hooks/useOrgSettings";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";

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
  const settings = useOrgSettings();
  const attributes = settings?.attributeSchema || [];

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

  const hashAttributeOptions = attributes
    .filter((a) => !a.archived)
    .map((a) => ({
      label: a.property,
      value: a.property,
    }));

  return (
    <Modal
      trackingEventModalType=""
      open={true}
      close={close}
      size="md"
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
      <Field label="Description" textarea {...form.register("description")} />

      <SelectField
        label="Hash Attribute"
        helpText="The user attribute to hash for namespace allocation. Uses v2 hashing algorithm."
        required
        options={hashAttributeOptions}
        value={form.watch("hashAttribute")}
        onChange={(value) => {
          form.setValue("hashAttribute", value);
        }}
      />
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
      <div className="alert alert-info">
        This is a legacy namespace. To use the new multi-range features, create
        a new namespace.
      </div>
      <Field label="Name" maxLength={60} required {...form.register("label")} />
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
