// A plan change must not alter an existing connection's payload, so a premium
// setting that is already on stays on without the feature. It can still be
// turned off, but only an org with the feature can turn it on.
export function resolvePremiumSdkSetting({
  requested,
  existing,
  hasFeature,
}: {
  requested: boolean | undefined;
  existing: boolean | undefined;
  hasFeature: boolean;
}): boolean {
  const current = existing ?? false;
  const wanted = requested ?? current;
  if (hasFeature) return wanted;
  return current && wanted;
}
