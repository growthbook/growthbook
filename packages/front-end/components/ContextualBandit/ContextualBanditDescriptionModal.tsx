import { useForm } from "react-hook-form";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { ApiContextualBanditInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import Link from "@/ui/Link";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
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
  const { apiCall } = useAuth();
  const form = useForm<{ description: string }>({
    defaultValues: {
      description: cb.description || "",
    },
  });

  return (
    <ModalStandard
      open
      trackingEventModalType="cb-edit-description"
      header="Edit Description"
      subheader={
        <>
          <Text size="inherit" mr="1">
            Use markdown to format your content.
          </Text>
          <Link
            rel="noreferrer"
            target="_blank"
            weight="bold"
            href="https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax"
          >
            Learn More
            <PiArrowSquareOutFill className="ml-1" />
          </Link>
        </>
      }
      size="lg"
      close={close}
      cta="Save"
      submit={form.handleSubmit(async ({ description }) => {
        await apiCall(`/api/v1/contextual-bandits/${cb.id}`, {
          method: "PUT",
          body: JSON.stringify({ description }),
        });
        mutate();
      })}
    >
      <MarkdownInput
        value={form.watch("description")}
        setValue={(value) => form.setValue("description", value)}
        placeholder="Add context about this contextual bandit for your team"
      />
    </ModalStandard>
  );
}
