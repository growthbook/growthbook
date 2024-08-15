import { useForm } from "react-hook-form";
import { ReportInterface } from "back-end/types/report";
import { useAuth } from "@front-end/services/auth";
import Field from "@front-end/components/Forms/Field";
import MarkdownInput from "@front-end/components/Markdown/MarkdownInput";
import Modal from "@front-end/components/Modal";

export default function EditTitleDescription({
  cancel,
  report,
  mutate,
}: {
  cancel: () => void;
  report: ReportInterface;
  mutate: () => void;
}) {
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      title: report.title,
      description: report.description,
    },
  });

  return (
    <Modal
      open={true}
      submit={form.handleSubmit(async (value) => {
        await apiCall(`/report/${report.id}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      close={cancel}
      header="Edit Report"
    >
      <Field label="Title" {...form.register("title")} />
      <div className="form-group">
        <label>Description</label>
        <MarkdownInput
          setValue={(value) => {
            form.setValue("description", value);
          }}
          value={form.watch("description")}
        />
      </div>
    </Modal>
  );
}
