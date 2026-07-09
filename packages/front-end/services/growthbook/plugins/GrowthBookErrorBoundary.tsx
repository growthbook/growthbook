import React from "react";
import { GrowthBookContext } from "@growthbook/growthbook-react";
import { captureError } from "shared/error-tracking";

export type GrowthBookErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode | ((args: { error: Error }) => React.ReactNode);
};

type GrowthBookErrorBoundaryState = { error: Error | null };

/**
 * Reports React render errors via {@link captureError}. Requires
 * `growthbookTrackingPlugin` before `growthbookErrorTrackingPlugin` on the
 * same GrowthBook instance.
 *
 * Temporary front-end copy until published in `@growthbook/growthbook-react`.
 */
export class GrowthBookErrorBoundary extends React.Component<
  GrowthBookErrorBoundaryProps,
  GrowthBookErrorBoundaryState
> {
  static contextType = GrowthBookContext;
  declare context: React.ContextType<typeof GrowthBookContext>;

  state: GrowthBookErrorBoundaryState = { error: null };

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const gb = this.context?.growthbook;
    if (gb) {
      void captureError({
        gb,
        error,
        props: {
          errorType: "react",
          handled: false,
          contexts: {
            react: {
              componentStack: info.componentStack,
            },
          },
        },
      });
    }
    this.setState({ error });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { fallback } = this.props;
    if (typeof fallback === "function") {
      return fallback({ error });
    }
    if (fallback != null) {
      return fallback;
    }

    return (
      <div role="alert">
        <p>Something went wrong.</p>
      </div>
    );
  }
}
