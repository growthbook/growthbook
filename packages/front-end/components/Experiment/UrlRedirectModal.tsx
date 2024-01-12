import { VisualChangesetInterface } from "@/../back-end/types/visual-changeset";
import { FC } from "react";
import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { useAuth } from "@/services/auth";
import Field from "../Forms/Field";
import Modal from "../Modal";
import Tooltip from "../Tooltip/Tooltip";

const defaultType = "simple";

const UrlRedirectModal: FC<{
  mode: "add" | "edit";
  experiment: ExperimentInterfaceStringDates;
  visualChangeset?: VisualChangesetInterface;
  mutate: () => void;
  close: () => void;
  onCreate?: (vc: VisualChangesetInterface) => void;
  cta?: string;
}> = ({ mode, experiment, visualChangeset, mutate, close, onCreate, cta }) => {
  const { apiCall } = useAuth();

  const form = useForm({
    defaultValues: {
      originUrl: visualChangeset?.urlRedirects[0].url ?? "",
      destinationUrls: visualChangeset?.urlPatterns.map((p) => p.pattern) ?? [],
      urlPatterns: visualChangeset?.urlPatterns ?? [
        { pattern: "", type: defaultType, include: true },
      ],
      persistQueryString: false,
    },
  });

  const onSubmit = form.handleSubmit(async (value) => {
    const payload = {
      editorUrl: value.originUrl,
      urlPatterns: value.urlPatterns,
    };
    if (mode === "add") {
      const res = await apiCall<{ visualChangeset: VisualChangesetInterface }>(
        `/experiments/${experiment.id}/visual-changeset`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );
      mutate();
      res.visualChangeset && onCreate && onCreate(res.visualChangeset);
    } else {
      await apiCall(`/visual-changesets/${visualChangeset?.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      mutate();
    }
  });

  return (
    <Modal
      open
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
    >
      <div className="mx-3 mt-3">
        <div className="d-flex align-items-baseline">
          <h4>Original URL</h4>
          <Tooltip
            body={
              "Currently, we support simple redirects for full URL paths. For Regex, use Feature Flags."
            }
            className="ml-1"
          />
        </div>

        <Field
          required
          placeholder="Ex: https://www.example.com/pricing"
          containerClassName="mb-2"
          {...form.register("originUrl", {
            required: true,
          })}
        />
        <hr className="mt-4 mb-3" />
        <div className="mt-3">
          <h4>Destination URLs</h4>
          <p className="text-muted">
            Leave blank if no redirect is desired for a variation.
          </p>
          {experiment.variations.map((v, i) => (
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
              </div>

              <div>
                <Field
                  required
                  placeholder="Enter destination URL for users in this variation"
                  containerClassName="mb-2"
                  {...form.register(`destinationUrls.${i}`, {
                    required: true,
                  })}
                />
              </div>
            </div>
          ))}
        </div>
        <hr className="mt-4" />
        <div className="d-flex align-items-baseline my-1">
          <input
            type="checkbox"
            {...form.register("persistQueryString")}
            id={"toggle-persistQueryString"}
          />
          <div className="text-muted ml-2">
            <b>Persist Query String</b>
            <p>
              Keep this enabled to allow users’ queries, such as search terms,
              to carry over when redirecting.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default UrlRedirectModal;
