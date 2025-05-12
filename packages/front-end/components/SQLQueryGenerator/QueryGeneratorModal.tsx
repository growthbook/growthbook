import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { InformationSchemaInterface } from "back-end/src/types/Integration";
import Modal from "@/components/Modal";
import Field from "@/components/Forms/Field";
import { useAuth } from "@/services/auth";

interface QueryGeneratorModalProps {
  open: boolean;
  datasourceType: string;
  informationSchema: InformationSchemaInterface | undefined;
  close: () => void;
  setSql: (value: string) => void;
  format?: (value: string) => string;
}

interface GenerateSqlResponse {
  sql: string;
}

const QueryGeneratorModal: FC<QueryGeneratorModalProps> = ({
  open,
  datasourceType,
  informationSchema,
  close,
  setSql,
  format,
}) => {
  const { apiCall } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const { handleSubmit, register } = useForm({
    defaultValues: {
      naturalLanguage: "",
    },
  });

  const onSubmit = async (data: { naturalLanguage: string }) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await apiCall<GenerateSqlResponse>("/generate-sql", {
        method: "POST",
        body: JSON.stringify({
          naturalLanguage: data.naturalLanguage,
          datasourceType,
          informationSchema,
        }),
      });

      if (format) {
        setSql(format(response.sql));
      } else {
        setSql(response.sql);
      }
      close();
    } catch (e) {
      const errorMessage =
        e.response?.message || e.message || "Failed to generate SQL query";
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      close={close}
      header="Generate SQL Query"
      submit={handleSubmit(onSubmit)}
      cta="Generate Query"
      ctaEnabled={!loading}
      error={error}
      loading={loading}
      size="lg"
      trackingEventModalType="sql-query-generator"
    >
      <div className="mb-4">
        <p className="text-muted">
          Describe what data you want to query in natural language, and
          we&apos;ll help you generate the SQL query.
        </p>
      </div>

      <Field
        label="What would you like to query?"
        textarea
        {...register("naturalLanguage", { required: true })}
        placeholder="Example: Show me the total revenue by product category for the last 30 days"
      />
    </Modal>
  );
};

export default QueryGeneratorModal;
