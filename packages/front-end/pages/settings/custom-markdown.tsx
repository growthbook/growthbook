import { useEffect } from "react";
import { useRouter } from "next/router";

// Custom markdown now lives on the General settings page.
export default function CustomMarkdownRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings#markdown");
  }, [router]);
  return null;
}
