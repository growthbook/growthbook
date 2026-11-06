import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

export default function NoMatchingContextualBanditQueryCallout({
  hashAttribute,
}: {
  hashAttribute: string | undefined;
}) {
  return (
    <Callout status="warning" mt="3">
      No generated Contextual Bandit query matches the hash attribute{" "}
      <code>{hashAttribute || "id"}</code>. Mark it as an identifier under{" "}
      <Link href="/attributes" external>
        Settings → Attributes
      </Link>
      , or choose a different hash attribute.
    </Callout>
  );
}
