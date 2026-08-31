import type { ChangeHandler, UseFormRegisterReturn } from "react-hook-form";

// RHF 7 looks up the field from event.target.name, so a different DOM name
// (to avoid browser contact autofill) must be rewritten on change/blur.
export function withHtmlName<TFieldName extends string>(
  registration: UseFormRegisterReturn<TFieldName>,
  htmlName: string,
): Omit<UseFormRegisterReturn<TFieldName>, "name"> & { name: string } {
  const retarget =
    (handler: ChangeHandler): ChangeHandler =>
    (event) => {
      const target = event.target as {
        type?: string;
        value?: string;
      };
      return handler({
        type: event.type,
        target: {
          name: registration.name,
          type: target.type || "text",
          value: target.value ?? "",
        },
      });
    };

  return {
    ...registration,
    name: htmlName,
    onChange: retarget(registration.onChange),
    onBlur: retarget(registration.onBlur),
  };
}
