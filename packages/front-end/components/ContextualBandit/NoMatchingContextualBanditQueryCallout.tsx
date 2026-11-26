import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import {
  ContextualBanditQuerySurface,
  managedWarehouseHashAttributeHint,
} from "@/services/contextualBandits";

export default function NoMatchingContextualBanditQueryCallout({
  hashAttribute,
  surface,
}: {
  hashAttribute: string | undefined;
  surface: ContextualBanditQuerySurface;
}) {
  return (
    <Callout status="warning" mt="3">
      No generated Contextual Bandit query matches the hash attribute{" "}
      <code>{hashAttribute || "id"}</code>. Mark it as an identifier under{" "}
      <Link href="/attributes" external>
        Settings → Attributes
      </Link>
      , or {managedWarehouseHashAttributeHint(surface)}.
    </Callout>
  );
}
