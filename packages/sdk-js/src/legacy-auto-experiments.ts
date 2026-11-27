import type {
  ApplyDomChangesCallback,
  NavigateCallback,
  Plugin,
} from "./types/growthbook";
import { visualEditorPlugin } from "./plugins/visual-editor";
import { urlRedirectsPlugin } from "./plugins/url-redirects";

// The GrowthBook options that controlled visual editor and URL redirect
// experiments before 3.0
export type LegacyAutoExperimentOptions = {
  disableVisualExperiments?: boolean;
  disableJsInjection?: boolean;
  jsInjectionNonce?: string;
  applyDomChangesCallback?: ApplyDomChangesCallback;
  disableUrlRedirectExperiments?: boolean;
  disableCrossOriginUrlRedirectExperiments?: boolean;
  navigate?: NavigateCallback;
  navigateDelay?: number;
  maxNavigateDelay?: number;
};

// The plugins that run those experiments the way the SDK did before 3.0: on
// unless one of the old options turns them off. Only for the bundles that sites
// load from a CDN without a version (auto.min.js and dist/bundles/index*), which
// get every new release whether or not they changed their code.
export function legacyAutoExperimentPlugins(
  options: LegacyAutoExperimentOptions,
): Plugin[] {
  const plugins: Plugin[] = [];
  if (!options.disableVisualExperiments) {
    plugins.push(
      visualEditorPlugin({
        allowCustomJs: !options.disableJsInjection,
        jsInjectionNonce: options.jsInjectionNonce,
        applyDomChangesCallback: options.applyDomChangesCallback,
      }),
    );
  }
  if (!options.disableUrlRedirectExperiments) {
    plugins.push(
      urlRedirectsPlugin({
        allowCrossOriginRedirects:
          !options.disableCrossOriginUrlRedirectExperiments,
        navigate: options.navigate,
        navigateDelay: options.navigateDelay,
        maxNavigateDelay: options.maxNavigateDelay,
      }),
    );
  }
  return plugins;
}
