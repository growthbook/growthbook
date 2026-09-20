import { useRef, useState } from "react";
import { Flex, Grid } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import RichTextEditor, { RichTextEditorHandle } from "./RichTextEditor";

const SAMPLE = `## Hypothesis

If we **shorten** the checkout form, more people will finish it.

- Fewer fields to read
- Less to type on a phone

See the [prior test](https://example.com) for context.`;

export default function RichTextEditorStories() {
  const [md, setMd] = useState(SAMPLE);
  const [small, setSmall] = useState("A shorter note.");
  const editor = useRef<RichTextEditorHandle>(null);

  return (
    <Flex direction="column" gap="5">
      <Grid columns="1fr 1fr" gap="4">
        <Flex direction="column" gap="2">
          <Text weight="medium">md, height 200</Text>
          <RichTextEditor
            ref={editor}
            value={md}
            onChange={setMd}
            height={200}
            placeholder="What do you expect to happen, and why?"
          />
          <Flex gap="2">
            <Button
              variant="outline"
              onClick={() => editor.current?.setMarkdown(SAMPLE)}
            >
              Reset content
            </Button>
            <Button variant="outline" onClick={() => editor.current?.focus()}>
              Focus
            </Button>
          </Flex>
        </Flex>

        <Flex direction="column" gap="2">
          <Text weight="medium">Markdown it emits</Text>
          <pre
            style={{
              margin: 0,
              padding: "var(--space-3)",
              borderRadius: "var(--radius-3)",
              background: "var(--gray-a3)",
              fontSize: "var(--font-size-1)",
              whiteSpace: "pre-wrap",
              height: 200,
              overflowY: "auto",
            }}
          >
            {md}
          </pre>
        </Flex>
      </Grid>

      <Grid columns="1fr 1fr" gap="4">
        <Flex direction="column" gap="2">
          <Text weight="medium">sm, auto-grows from 60</Text>
          <RichTextEditor
            size="sm"
            value={small}
            onChange={setSmall}
            height={60}
            autoGrow
            placeholder="Add a note"
          />
        </Flex>

        <Flex direction="column" gap="2">
          <Text weight="medium">Read only</Text>
          <RichTextEditor readOnly value={md} height={120} />
        </Flex>
      </Grid>
    </Flex>
  );
}
