import { useRouter } from "next/router";
import { useEffect } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";

// Auth0's "Initiate Login URI" sends IdP-initiated logins to /login?iss=<issuer>.
// Redirect to "/" so AuthProvider runs the normal auth flow.
export default function Login() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return <LoadingOverlay />;
}

Login.preAuth = true;
