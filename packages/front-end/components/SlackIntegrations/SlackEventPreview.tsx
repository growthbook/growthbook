import { useEffect, useState } from "react";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import SlackMessagePreview from "./SlackMessagePreview";

type Preview = {
  image: string | null;
  message: {
    text: string;
    blocks: {
      type: string;
      text?: { text?: string };
      elements?: { text?: string }[];
    }[];
  };
};
export default function SlackEventPreview({
  eventName,
  format,
}: {
  eventName: string;
  format: "none" | "compact" | "detailed";
}) {
  const { apiCall } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setError(null);
    apiCall<Preview>("/integrations/slack/preview", {
      method: "POST",
      body: JSON.stringify({ eventName, format }),
    })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "Could not render preview",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [eventName, format, apiCall, attempt]);
  if (error)
    return (
      <>
        <HelperText status="error">{error}</HelperText>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAttempt(attempt + 1)}
        >
          Retry preview
        </Button>
      </>
    );
  if (!preview) return <Text>Rendering preview…</Text>;
  return preview.image ? (
    <img
      src={preview.image}
      alt={
        eventName.startsWith("digest:")
          ? "Sample digest preview"
          : "Sample results card preview"
      }
      style={{ display: "block", width: "100%", borderRadius: 10 }}
    />
  ) : (
    <SlackMessagePreview message={preview.message} />
  );
}
