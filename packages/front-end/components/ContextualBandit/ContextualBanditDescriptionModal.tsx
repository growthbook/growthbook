import { contextualBanditEndpoints } from "shared/api-endpoints";
import { useForm } from "react-hook-form";
import { Trans, useLingui } from "@lingui/react/macro";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { ApiContextualBanditInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import Text from "@/ui/Text";

export default function ContextualBanditDescriptionModal({
  cb,
  mutate,
  close,
}: {
  cb: ApiContextualBanditInterface;
  mutate: () => void;
  close: () => void;
}) {
  const { t } = useLingui();
  const restApiCall = useRestApiCall();
  const form = useForm<{ description: string }>({
    defaultValues: {
      description: cb.description || "",
    },
  });

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-description"
      header={t`Edit Description`}
      subheader={
        <>
          <Text size="inherit" mr="1">
            <Trans>Use markdown to format your content.</Trans>
          </Text>
          <Link
            rel="noreferrer"
            target="_blank"
            weight="bold"
            href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          >
            <Trans>Learn More</Trans>
            <PiArrowSquareOutFill className="ml-1" />
          </Link>
        </>
      }
      size="lg"
      close={close}
      cta={t`Save`}
      submit={validatedSubmit(form, async ({ description }) => {
        await restApiCall(contextualBanditEndpoints.updateContextualBandit, {
          params: { id: cb.id },
          body: { description },
        });
        mutate();
      })}
    >
      <MarkdownInput
        value={form.watch("description")}
        setValue={(value) => form.setValue("description", value)}
        placeholder={t`Add context about this contextual bandit for your team`}
      />
    </ModalStandard>
  );
}
