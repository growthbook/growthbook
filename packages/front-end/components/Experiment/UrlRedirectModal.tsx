import { FC, useState } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { getVariationsForPhase } from "shared/experiments";
import { isURLTargeted } from "@growthbook/growthbook";
import { FaExclamationCircle } from "react-icons/fa";
import { getConnectionsSDKCapabilities } from "shared/sdk-versioning";
import { URLRedirectInterface } from "shared/types/url-redirect";
import clsx from "clsx";
import { FaTriangleExclamation } from "react-icons/fa6";
import { Box, Flex } from "@radix-ui/themes";
import { PiArrowSquareOutFill } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import useSDKConnections from "@/hooks/useSDKConnections";
import Field from "@/components/Forms/Field";
import Modal from "@/components/Modal";
import Tooltip from "@/components/Tooltip/Tooltip";
import { DocLink } from "@/components/DocLink";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";

function validateUrl(urlString: string): {
  isValid: boolean;
  message?: string;
} {
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

const UrlRedirectModal: FC<{
  mode: "add" | "edit";
  experiment: ExperimentInterfaceStringDates;
  urlRedirect?: URLRedirectInterface;
  mutate: () => void;
  close: () => void;
  source?: string;
}> = ({ mode, experiment, urlRedirect, mutate, close, source }) => {
  const { apiCall } = useAuth();
  const variations = getVariationsForPhase(experiment, null);
  const { data: sdkConnectionsData } = useSDKConnections();

  const hasSDKWithRedirects = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: experiment.project ?? "",
  }).includes("redirects");
  const hasSDKWithNoRedirects = getConnectionsSDKCapabilities({
    connections: sdkConnectionsData?.connections ?? [],
    project: experiment.project ?? "",
    mustMatchAllConnections: true,
  }).includes("redirects");

  const form = useForm({
    defaultValues: {
      originUrl: urlRedirect?.urlPattern ?? "",
      destinationUrls: urlRedirect?.destinationURLs?.map((r) => r.url) ?? [""],
      persistQueryString:
        mode === "add" ? true : !!urlRedirect?.persistQueryString,
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
          const initialArray = Array(variations.length).fill(true);
          initialArray[0] = false;
          return initialArray;
        },
  );

  const onSubmit = form.handleSubmit(async (value) => {
    const payload = {
      urlPattern: value.originUrl,
      destinationURLs: variations.map((v, i) => {
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
        },
      );
      mutate();
    } else {
      await apiCall(
        `/url-redirects/${urlRedirect?.id}/?circularDependencyCheck=${value.circularDependencyCheck}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
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
      trackingEventModalType="url-redirect-modal"
      trackingEventModalSource={source}
      autoCloseOnSubmit={false}
      open
      disabledMessage={
        !hasSDKWithRedirects
          ? "None of the SDK connections in this project support URL redirects"
          : undefined
      }
      close={close}
      size="lg"
      header={`
       ${mode === "add" ? "Add" : "Edit"} URL Redirects`}
      submit={onSubmit}
      ctaEnabled={hasSDKWithRedirects}
    >
      <div className="mx-3">
        {hasSDKWithNoRedirects ? (
          <Callout status={hasSDKWithRedirects ? "warning" : "error"}>
            <Box as="span" pr="1">
              {hasSDKWithRedirects
                ? "Some of your SDK Connections in this project may not support URL Redirects."
                : "None of your SDK Connections in this project support URL Redirects. Either upgrade your SDKs or add a supported SDK."}
              <Link
                href={"/sdks"}
                weight="bold"
                className="pl-2"
                rel="noreferrer"
                target="_blank"
              >
                View SDKs
                <PiArrowSquareOutFill className="ml-1" />
              </Link>
            </Box>
          </Callout>
        ) : null}

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
          {variations.map((v, i) => {
            let warning: string | JSX.Element | undefined;
            const destinationMatchesOrigin =
              !!form.watch("originUrl") &&
              form.watch(`destinationUrls.${i}`) &&
              (isURLTargeted(form.watch(`destinationUrls.${i}`), [
                {
                  include: true,
                  type: "simple",
                  pattern: form.watch("originUrl"),
                },
              ]) ||
                form.watch("originUrl") === form.watch(`destinationUrls.${i}`));
            try {
              const originUrl = new URL(form.watch("originUrl"));
              const variantUrl = new URL(form.watch(`destinationUrls.${i}`));
              if (originUrl.protocol !== variantUrl.protocol) {
                warning = `Destination URL is using "${variantUrl.protocol}" and the original URL is using "${originUrl.protocol}"`;
              }
              if (originUrl.host !== variantUrl.host) {
                warning = `Destination URL is "${variantUrl.host}" and the original URL is "${originUrl.host}"`;
              }
              // Check for query parameters in destination that are not in origin when base URLs match
              if (
                destinationMatchesOrigin &&
                Array.from(variantUrl.searchParams.keys()).some(
                  (k) => !originUrl.searchParams.has(k),
                )
              ) {
                warning = (
                  <>
                    Destination URL has query parameters the original URL does
                    not have. See{" "}
                    <DocLink docSection="url_redirects">our docs</DocLink> for
                    more info on how to handle this kind of redirect.
                  </>
                );
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
                  <div className="ml-auto d-flex align-items-center">
                    <Checkbox
                      label="Redirect"
                      disabled={i === 0}
                      disabledMessage={
                        i === 0 ? "You can not edit the control" : ""
                      }
                      value={redirectToggle[i]}
                      setValue={() =>
                        handleRedirectToggle(i, !redirectToggle[i])
                      }
                    />
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
        <Flex align="baseline" my="1">
          <Checkbox
            label="Persist Query String"
            description="Allow user's queries, such as search terms, to carry over
                  when redirecting"
            value={form.watch("persistQueryString")}
            setValue={(v) => form.setValue("persistQueryString", v === true)}
          />
          <Checkbox
            label="Circular Dependency Check"
            description="Make sure redirects don't conflict with any existing
                  redirects"
            value={form.watch("circularDependencyCheck")}
            setValue={(v) =>
              form.setValue("circularDependencyCheck", v === true)
            }
          />
        </Flex>
      </div>
    </Modal>
  );
};

export default UrlRedirectModal;
