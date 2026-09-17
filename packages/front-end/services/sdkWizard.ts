export function getWizardCommand({
  language,
  agent,
  apiHost,
}: {
  language: string;
  agent: string;
  apiHost: string | null;
}): string {
  const args = [
    "npx",
    "@growthbook/wizard",
    "--language",
    language,
    `--${agent}`,
  ];
  if (apiHost) args.push("--api-host", apiHost);

  return args
    .map((arg) =>
      /^[a-zA-Z0-9_/:.@=-]+$/.test(arg)
        ? arg
        : "'" + arg.replace(/'/g, "'\\''") + "'",
    )
    .join(" ");
}
