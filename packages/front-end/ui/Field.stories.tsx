import { Flex } from "@radix-ui/themes";
import Field from "@/components/Forms/Field";
import { StoryMeta } from "@/ui/storyMeta";

export const meta: StoryMeta = {
  name: "Field",
  category: "inputs",
  status: "legacy",
  replacedBy: "TextField",
  summary:
    "Bootstrap-based text input. Prefer TextField for new work; this component remains for legacy forms and textareas.",
  useWhen: ["Editing an existing legacy form that already uses it."],
  avoidWhen: [
    {
      reason: "Any new single-line text input.",
      use: "TextField",
    },
    {
      reason: "Multi-line formatted text.",
      use: "RichTextEditor",
    },
  ],
  related: ["TextField"],
};

function TextInputSizesStory() {
  return (
    <Flex direction="column" gap="3" maxWidth="360px">
      <Field label="Size legacy (default)" placeholder="Text input" />
      <Field label="Size sm" size="sm" placeholder="Text input" />
      <Field label="Size md" size="md" placeholder="Text input" />
      <Field label="Size lg" size="lg" placeholder="Text input" />
    </Flex>
  );
}

function TextareaStory() {
  return (
    <Flex direction="column" gap="3" maxWidth="360px">
      <Field
        label="Textarea — legacy (default)"
        textarea
        placeholder="Multi-line text…"
      />
      <Field
        label="Textarea — sm"
        size="sm"
        textarea
        placeholder="Multi-line text…"
      />
      <Field
        label="Textarea — md"
        size="md"
        textarea
        placeholder="Multi-line text…"
      />
      <Field
        label="Textarea — lg"
        size="lg"
        textarea
        placeholder="Multi-line text…"
      />
    </Flex>
  );
}

function StatesStory() {
  return (
    <Flex direction="column" gap="3" maxWidth="360px">
      <Field
        label="With help text"
        placeholder="Enter a value"
        helpText="This is some helpful context for the field."
      />
      <Field
        label="With error"
        placeholder="Enter a value"
        error="This field is required."
      />
      <Field
        label="With warning"
        placeholder="Enter a value"
        error="Value looks unusual."
        errorLevel="warning"
      />
      <Field label="Disabled" placeholder="Cannot edit" disabled />
      <Field label="With prepend" placeholder="0.00" prepend="$" />
      <Field
        label="With append"
        placeholder="Duration"
        append="days"
        type="number"
        min="1"
      />
      <Field
        label="Character count"
        placeholder="Type something…"
        maxLength={80}
        currentLength={23}
      />
      <Field label="Required mark" placeholder="Enter a value" markRequired />
    </Flex>
  );
}

export default function FieldStories() {
  return (
    <Flex direction="column" gap="6">
      <TextInputSizesStory />
      <TextareaStory />
      <StatesStory />
    </Flex>
  );
}
