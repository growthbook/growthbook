import { useForm } from "react-hook-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { ReportInterface } from "shared/types/report";
import { useAuth } from "@/services/auth";
import Field from "@/components/Forms/Field";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";

export default function EditTitleDescription({
  cancel,
  report,
  mutate,
}: {
  cancel: () => void;
  report: ReportInterface;
  mutate: () => void;
}) {
  const { t } = useLingui();
  const { apiCall } = useAuth();
  const form = useForm({
    defaultValues: {
      title: report.title,
      description: report.description,
    },
  });

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      submit={validatedSubmit(form, async (value) => {
        await apiCall(`/report/${report.id}`, {
          method: "PUT",
          body: JSON.stringify(value),
        });
        mutate();
      })}
      close={cancel}
      header={t`Edit Report`}
    >
      <Field size="legacy" label={t`Title`} {...form.register("title")} />
      <div className="form-group">
        <label>
          <Trans>Description</Trans>
        </label>
        <MarkdownInput
          setValue={(value) => {
            form.setValue("description", value);
          }}
          value={form.watch("description")}
        />
      </div>
    </ModalStandard>
  );
}
