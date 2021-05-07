/* 
Track anonymous usage statistics using Plausible.io
- No cookies or identifiable information are sent.
- Helps us figure out what features are the most popular 
  and which ones need more work.
- For example, if people start creating a metric and then 
  abandon the form, that tells us the UI needs improvement.
- You can disable this tracking completely by setting 
  NEXT_PUBLIC_DISABLE_TELEMETRY=1 in your env.
*/

declare global {
  interface Window {
    // eslint-disable-next-line
    plausible: any;
  }
}

export default function track(
  event: string,
  props: Record<string, unknown> = {}
): void {
  if (process.env.NEXT_PUBLIC_DISABLE_TELEMETRY) return;
  if (typeof window === "undefined") return;

  if (window.location.origin.match(/localhost/)) {
    console.log("Track Event", event, props);
  }

  window.plausible =
    window.plausible ||
    function (...args) {
      (window.plausible.q = window.plausible.q || []).push(args);
    };
  window.plausible(event, props);
}
