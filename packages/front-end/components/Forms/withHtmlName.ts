import type { ChangeHandler, UseFormRegisterReturn } from "react-hook-form";

export const RESOURCE_TITLE_HTML_NAME = "resourceTitle";

// Passing autoComplete (other than "off") means the caller wants browser
// autofill — e.g. Welcome.tsx uses autoComplete="name" for a person's name.
export function shouldDisableNameAutofill(
  name: string | undefined,
  autoComplete: string | undefined,
): boolean {
  return (
    name === "name" && (autoComplete === undefined || autoComplete === "off")
  );
}

type NamedTarget = {
  name?: string;
  type?: string;
  value?: string;
};

export function eventForRegisteredName<
  E extends { type?: string; target: NamedTarget },
>(event: E, registeredName: string): E {
  return {
    ...event,
    target: {
      name: registeredName,
      type: event.target.type || "text",
      value: event.target.value ?? "",
    },
  };
}

// RHF 7 looks up the field from event.target.name, so a different DOM name
// must be rewritten on change/blur.
export function withHtmlName<TFieldName extends string>(
  registration: UseFormRegisterReturn<TFieldName>,
  htmlName: string,
): Omit<UseFormRegisterReturn<TFieldName>, "name"> & { name: string } {
  const retarget =
    (handler: ChangeHandler): ChangeHandler =>
    (event) =>
      handler(eventForRegisteredName(event, registration.name));

  return {
    ...registration,
    name: htmlName,
    onChange: retarget(registration.onChange),
    onBlur: retarget(registration.onBlur),
  };
}
