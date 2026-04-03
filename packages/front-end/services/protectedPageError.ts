export type ProtectedPageErrorState =
  | "none"
  | "sign_in_error"
  | "startup_network_error"
  | "connection_error";

export function isTransientNetworkError(error: string) {
  const normalized = error.trim().toLowerCase();
  return (
    normalized === "failed to fetch" || normalized.includes("networkerror")
  );
}

export function getProtectedPageErrorState({
  error,
  ready,
}: {
  error?: string;
  ready: boolean;
}): ProtectedPageErrorState {
  if (!error) return "none";
  if (!isTransientNetworkError(error)) return "sign_in_error";
  if (!ready) return "startup_network_error";
  return "connection_error";
}
