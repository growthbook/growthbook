import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { isURLTargeted } from "@growthbook/growthbook";
import {
  FaExclamationCircle,
  FaExclamationTriangle,
  FaExternalLinkAlt,
} from "react-icons/fa";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { URLRedirectInterface } from "back-end/types/url-redirect";
import clsx from "clsx";
import { FaTriangleExclamation } from "react-icons/fa6";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import Toggle from "@/components/Forms/Toggle";
import MinSDKVersionsList from "@/components/Features/MinSDKVersionsList";

function validateUrl(
  urlString: string
): { isValid: boolean; message?: string } {
  try {
    const url = new URL(urlString);
    if (url.pathname.includes("*")) {
      return { isValid: false, message: "Please remove any wildcards" };
    }
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { isValid: true };
    }

    return {
      isValid: false,
      message: `Incomplete URL. Specify a valid URL starting with "http:// or "https://"`,
    };
  } catch (_) {
    if (!urlString.startsWith("http") && !urlString.startsWith("https")) {
      return {
        isValid: false,
        message: `Incomplete URL. Specify a valid URL starting with "http:// or "https://"`,
      };
    }
    return { isValid: false, message: "Invalid URL" };
  }
}

const UrlRedirectSdkAlert = ({
  hasSDKWithRedirects,
}: {
  hasSDKWithRedirects: boolean;
}) => {
  return (
    <div
      className={`mb-3 mt-2 alert ${
        hasSDKWithRedirects ? "alert-warning" : "alert-danger"
      }`}
    >
      <div>
        <FaExclamationTriangle className="mr-1" />
        {hasSDKWithRedirects ? (
          <>
            Some of your{" "}
            <a href="/sdks" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
            in this project may not support URL redirects.
          </>
        ) : (
          <>
            None of your{" "}
            <a href="/sdks" className="text-normal" target="_blank">
              SDK Connections <FaExternalLinkAlt />
            </a>{" "}
            in this project support URL redirects. Either upgrade your SDKs or
            add a supported SDK.
          </>
        )}{" "}
        <Tooltip
          body={
            <>
              URL Redirects are only supported in the following SDKs and
              versions:
              <MinSDKVersionsList capability="redirects" />
            </>
          }
        />
      </div>
    </div>
  );
};

const UrlRedirectModal: FC<{
  mode: "add" | "edit";
  experiment: ExperimentInterfaceStringDates;
  urlRedirect?: URLRedirectInterface;
  mutate: () => void;
  close: () => void;
  cta?: string;
}> = ({ mode, experiment, urlRedirect, mutate, close, cta }) => {
  const { apiCall } = useAuth();
  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithRedirects = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: experiment.project ?? "",
  }).includes("redirects");

  const form = useForm({
    defaultValues: {
      originUrl: urlRedirect?.urlPattern ?? "",
      destinationUrls: urlRedirect?.destinationURLs?.map((r) => r.url) ?? [""],
      persistQueryString: urlRedirect?.persistQueryString || true,
      circularDependencyCheck: true,
    },
  });
  const {
    formState: { errors },
  } = form;

  const [redirectToggle, setRedirectToggle] = useState<boolean[]>(
    form.watch("originUrl")
      ? form.watch("destinationUrls").map((u) => !!u)
      : () => {
          const initialArray = Array(experiment.variations.length).fill(true);
          initialArray[0] = false;
          return initialArray;
        }
  );

  const onSubmit = form.handleSubmit(async (value) => {
    const payload = {
      urlPattern: value.originUrl,
      destinationURLs: experiment.variations.map((v, i) => {
        return {
          variation: v.id,
          url: value.destinationUrls[i],
        };
      }),
      persistQueryString: value.persistQueryString,
    };
    if (mode === "add") {
      await apiCall<{ urlRedirect: URLRedirectInterface }>(
        `/url-redirects/?circularDependencyCheck=${value.circularDependencyCheck}`,
        {
          method: "POST",
          body: JSON.stringify({ ...payload, experiment: experiment.id }),
        }
      );
      mutate();
    } else {
      await apiCall(
        `/url-redirects/${urlRedirect?.id}/?circularDependencyCheck=${value.circularDependencyCheck}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        }
      );
      mutate();
    }
    close();
  });

  const handleRedirectToggle = (i: number, enabled: boolean) => {
    const newArray = [...redirectToggle];
    newArray[i] = enabled;
    if (!enabled) {
      form.setValue(`destinationUrls.${i}`, "");
    }
    setRedirectToggle(newArray);
  };

  return (
    <Modal
      autoCloseOnSubmit={false}
      open
      disabledMessage={
        !hasSDKWithRedirects
          ? "None of the SDK connections in this project support URL redirects"
          : undefined
      }
      close={close}
      size="lg"
      header={
        <div className="mx-3">
          <h3>{mode === "add" ? "Add" : "Modify"} URL Redirects</h3>
          <p className="mb-0" style={{ fontWeight: 400 }}>
            Send visitors to any URL when landing on another URL.
          </p>
        </div>
      }
      submit={onSubmit}
      cta={cta}
      ctaEnabled={hasSDKWithRedirects}
    >
      <div className="mx-3">
        <UrlRedirectSdkAlert hasSDKWithRedirects={hasSDKWithRedirects} />
        <div className="d-flex align-items-baseline mt-3">
          <h4>Original URL</h4>
          <Tooltip
            body={
              "Currently, we support simple redirects for full URL paths. For Regex, use Feature Flags."
            }
            className="ml-1"
            tipPosition="top"
          />
        </div>

        <Field
          required
          placeholder="Ex: https://www.example.com/pricing"
          containerClassName="mb-2"
          {...form.register("originUrl", {
            required: true,
            validate: {
              isValidUrl: (v) => {
                const validator = validateUrl(v);
                return validator.isValid ? true : validator.message;
              },
            },
          })}
        />
        {errors.originUrl && errors.originUrl.message && (
          <div className="alert alert-warning mt-3">
            <FaExclamationCircle /> {errors.originUrl.message}
          </div>
        )}

        <hr className="mt-4 mb-3" />
        <div className="mt-3">
          <h4>Destination URLs</h4>
          {experiment.variations.map((v, i) => {
            let warning: string | undefined;
            const destinationMatchesOrigin =
              !!form.watch("originUrl") &&
              form.watch(`destinationUrls.${i}`) &&
              (isURLTargeted(form.watch("originUrl"), [
                {
                  include: true,
                  type: "simple",
                  pattern: form.watch(`destinationUrls.${i}`),
                },
              ]) ||
                form.watch("originUrl") === form.watch(`destinationUrls.${i}`));
            try {
              const originUrl = new URL(form.watch("originUrl"));
              const variantUrl = new URL(form.watch(`destinationUrls.${i}`));
              if (originUrl.protocol !== variantUrl.protocol) {
                warning = `Destination URL is using "${variantUrl.protocol}" and the origin URL is using "${originUrl.protocol}"`;
              }
              if (originUrl.host !== variantUrl.host) {
                warning = `Destination URL is "${variantUrl.host}" and the origin URL is "${originUrl.host}"`;
              }
            } catch (e) {
              //ts-ignore
            }

            return (
              <div
                className={`mb-4 variation with-variation-label variation${i}`}
                key={v.key}
              >
                <div className="d-flex align-items-baseline">
                  <span
                    className="label"
                    style={{
                      width: 18,
                      height: 18,
                    }}
                  >
                    {i}
                  </span>{" "}
                  <h5>{v.name}</h5>
                  <div className="ml-auto">
                    <Toggle
                      id={`${v.name}_toggle_create`}
                      label={"Redirect"}
                      className="mr-3"
                      value={redirectToggle[i]}
                      setValue={(enabled) => handleRedirectToggle(i, enabled)}
                      type="toggle"
                    />
                    <label
                      htmlFor={`${v.name}_toggle_redirect`}
                      className={clsx("mr-2", {
                        "text-dark": redirectToggle[i],
                      })}
                    >
                      Redirect
                    </label>
                  </div>
                </div>

                <div>
                  <Field
                    required
                    className={clsx({
                      "border-danger":
                        errors.destinationUrls?.[i] &&
                        errors.destinationUrls?.[i]?.message,
                    })}
                    disabled={
                      redirectToggle[i] !== undefined && !redirectToggle[i]
                    }
                    placeholder={
                      !redirectToggle[i]
                        ? form.watch("originUrl")
                        : "Enter destination URL for users in this variation"
                    }
                    containerClassName="mb-2"
                    {...form.register(`destinationUrls.${i}`, {
                      required: !redirectToggle[i]
                        ? false
                        : "Please enter a destination URL or disable 'Redirect'",
                      validate: {
                        doesNotMatchOrigin: (_v) =>
                          !destinationMatchesOrigin ||
                          "This destination url matches the original URL and will not result in a redirect",
                        isValidUrl: (v) => {
                          if (!redirectToggle[i]) return true;
                          const validator = validateUrl(v);
                          return validator.isValid ? true : validator.message;
                        },
                      },
                    })}
                    value={!redirectToggle ? "" : undefined}
                  />
                  {errors.destinationUrls?.[i] &&
                    errors.destinationUrls?.[i]?.message && (
                      <div className="text-danger mt-2">
                        <FaExclamationCircle />{" "}
                        {errors.destinationUrls?.[i]?.message}
                      </div>
                    )}
                  {!errors.destinationUrls?.[i] && !!warning && (
                    <div className="text-warning-orange mt-2">
                      <FaTriangleExclamation /> {warning}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <hr className="mt-4" />
        <div className="d-flex align-items-baseline my-1">
          <input
            type="checkbox"
            {...form.register("persistQueryString")}
            id={"toggle-persistQueryString"}
          />
          <label
            htmlFor="toggle-persistQueryString"
            className="text-muted ml-2"
          >
            <b>Persist Query String</b>
            <p>
              Keep this enabled to allow users’ queries, such as search terms,
              to carry over when redirecting.
            </p>
          </label>
          <input
            type="checkbox"
            {...form.register("circularDependencyCheck")}
            id={"toggle-circularDependencyCheck"}
          />
          <label
            htmlFor="toggle-circularDependencyCheck"
            className="text-muted ml-2"
          >
            <b>Circular Dependency Check</b>
            <p>
              Keep this enabled to make sure your redirect does not conflict
              with any existing redirects
            </p>
          </label>
        </div>
      </div>
    </Modal>
  );
};

export default UrlRedirectModal;
