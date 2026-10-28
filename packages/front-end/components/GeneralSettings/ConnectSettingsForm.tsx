import { ReactNode } from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";

// Hands the General settings form to a render function.
export function ConnectSettingsForm({
  children,
}: {
  children: (methods: UseFormReturn) => ReactNode;
}) {
  const methods = useFormContext();
  return <>{children({ ...methods })}</>;
}
