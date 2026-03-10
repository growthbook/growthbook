import { useState } from "react";
import { useForm } from "react-hook-form";
import { TestQueryRow } from "shared/types/integrations";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";

export interface Props {
  close: () => void;
  sql: string;
  datasourceId: string;
  results: TestQueryRow[];
  dateLastRan?: Date;
  onSave?: () => void;
}

interface SaveQueryFormData {
  name: string;
  description: string;
}

export default function SaveQueryModal({
  close,
  sql,
  datasourceId,
  dateLastRan,
  results,
  onSave,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { apiCall } = useAuth();

  const form = useForm<SaveQueryFormData>({
    defaultValues: {
      name: "",
      description: "",
    },
  });

  const handleSubmit = async (data: SaveQueryFormData) => {
    setLoading(true);
    setError(null);
    try {
      await apiCall("/saved-queries", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || undefined,
          sql,
          datasourceId,
          dateLastRan,
          results,
        }),
      });

      onSave?.();
      close();
    } catch (error) {
      console.error("Failed to save query:", error);
      setError(error.message || "Failed to save query. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      trackingEventModalType="save-query"
      open
      header="Save Query"
      submit={form.handleSubmit(handleSubmit)}
      close={close}
      size="lg"
      cta="Save Query"
      ctaEnabled={!!form.watch("name")}
      loading={loading}
    >
      <div className="p-4">
        {error && <div className="alert alert-danger mb-3">{error}</div>}

        <Field
          label="Query Name"
          placeholder="Enter a name for your query"
          required
          {...form.register("name", { required: "Query name is required" })}
        />

        <Field
          label="Description"
          placeholder="Enter a description (optional)"
          textarea
          minRows={2}
          {...form.register("description")}
        />

        {results.length > 0 && (
          <div className="mt-3 p-3 bg-light rounded">
            <small className="text-muted">
              <strong>Query Results:</strong> {results.length} row
              {results.length !== 1 ? "s" : ""} will be saved with this query
            </small>
          </div>
        )}
      </div>
    </Modal>
  );
}
