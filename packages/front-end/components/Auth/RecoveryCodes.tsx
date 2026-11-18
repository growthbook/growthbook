import { Code, Flex, Grid } from "@radix-ui/themes";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { saveAs } from "@/services/files";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

export default function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });
  return (
    <Flex direction="column" gap="3">
      <Callout status="warning">
        Save these recovery codes somewhere safe. Each one works once, in place
        of an authentication code, if you lose your authenticator app. You
        won&apos;t see them again.
      </Callout>
      <Grid columns="2" gap="2">
        {codes.map((code) => (
          <Code key={code} variant="ghost">
            {code}
          </Code>
        ))}
      </Grid>
      <Flex gap="2">
        {copySupported && (
          <Button variant="outline" onClick={() => performCopy(text)}>
            {copySuccess ? "Copied" : "Copy"}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() =>
            saveAs({
              textContent: text,
              fileName: "growthbook-recovery-codes.txt",
            })
          }
        >
          Download
        </Button>
      </Flex>
    </Flex>
  );
}
