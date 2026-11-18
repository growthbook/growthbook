import { Flex, Grid } from "@radix-ui/themes";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";

export default function RecoveryCodes({ codes }: { codes: string[] }) {
  const text = codes.join("\n");
  return (
    <Flex direction="column" gap="3">
      <Callout status="warning">
        Save these recovery codes somewhere safe. Each one works once, in place
        of an authentication code, if you lose your authenticator app. You
        won&apos;t see them again.
      </Callout>
      <Grid columns="2" gap="2">
        {codes.map((code) => (
          <code key={code}>{code}</code>
        ))}
      </Grid>
      <Flex gap="2">
        <Button
          variant="outline"
          onClick={() => navigator.clipboard.writeText(text)}
        >
          Copy
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
              new Blob([text], { type: "text/plain" }),
            );
            a.download = "growthbook-recovery-codes.txt";
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Download
        </Button>
      </Flex>
    </Flex>
  );
}
