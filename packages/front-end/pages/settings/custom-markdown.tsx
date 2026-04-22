import Link from "next/link";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { GBCircleArrowLeft } from "@/components/Icons";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import { OrganizationSettingsWithMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import { useUser } from "@/services/UserContext";
import TempMessage from "@/components/TempMessage";
import { useAuth } from "@/services/auth";
import Modal from "@/components/Modal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { DocLink } from "@/components/DocLink";

const SaveMessage = ({ showMessage, close }) => {
  return (
    <div className="flex-grow-1 mr-4">
      {showMessage && (
        <TempMessage
          className="mb-0 py-2"
          close={() => {
            close();
          }}
        >
          Settings saved
        </TempMessage>
      )}
    </div>
  );
};

const CustomMarkdown: React.FC = () => {
  const { refreshOrganization, settings } = useUser();
  const { apiCall } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const [saveMsg, setSaveMsg] = useState(false);

  const form = useForm<OrganizationSettingsWithMetricDefaults>({
    defaultValues: {
      featureListMarkdown: settings.featureListMarkdown || "",
      featurePageMarkdown: settings.featurePageMarkdown || "",
      experimentListMarkdown: settings.experimentListMarkdown || "",
      experimentPageMarkdown: settings.experimentPageMarkdown || "",
      metricListMarkdown: settings.metricListMarkdown || "",
      metricPageMarkdown: settings.metricPageMarkdown || "",
    },
  });

  useEffect(() => {
    // If settings change, update the form default values
    if (settings) {
      form.reset({
        featureListMarkdown: settings.featureListMarkdown || "",
        featurePageMarkdown: settings.featurePageMarkdown || "",
        experimentListMarkdown: settings.experimentListMarkdown || "",
        experimentPageMarkdown: settings.experimentPageMarkdown || "",
        metricListMarkdown: settings.metricListMarkdown || "",
        metricPageMarkdown: settings.metricPageMarkdown || "",
      });
    }
  }, [form, settings]);

  const saveSettings = form.handleSubmit(async (value) => {
    await apiCall(`/organization`, {
      method: "PUT",
      body: JSON.stringify({
        settings: value,
      }),
    });
    refreshOrganization();

    // show the user that the settings have saved:
    setSaveMsg(true);
  });

  if (!permissionsUtil.canManageOrgSettings()) {
    return (
      <div className="container-fluid pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid pagecontents">
      <div className="mb-4">
        <Link href="/settings">
          <GBCircleArrowLeft className="mr-1" />
          Back to General Settings
        </Link>
      </div>
      <h1>Add Custom Markdown</h1>
      <p>
        Custom markdown allows you to provide organization-specific guidance and
        documentation to your team on key pages within GrowthBook.
        <br />
        <DocLink docSection={"customMarkdown"}>View Documentation &gt;</DocLink>
      </p>
      <Modal
        trackingEventModalType=""
        cta={"Save"}
        header={false}
        open
        inline
        submit={async () => await saveSettings()}
        secondaryCTA={
          <SaveMessage showMessage={saveMsg} close={() => setSaveMsg(false)} />
        }
      >
        <h3 className="mb-3">Features List</h3>
        <MarkdownInput
          value={form.watch("featureListMarkdown") || ""}
          setValue={(value) => form.setValue("featureListMarkdown", value)}
        />
        <h3 className="my-3">Feature Page</h3>
        <MarkdownInput
          value={form.watch("featurePageMarkdown") || ""}
          setValue={(value) => form.setValue("featurePageMarkdown", value)}
        />
        <hr />
        <h3 className="mb-3">Experiments List</h3>
        <MarkdownInput
          value={form.watch("experimentListMarkdown") || ""}
          setValue={(value) => form.setValue("experimentListMarkdown", value)}
        />
        <h3 className="my-3">Experiment Page</h3>
        <MarkdownInput
          value={form.watch("experimentPageMarkdown") || ""}
          setValue={(value) => form.setValue("experimentPageMarkdown", value)}
        />
        <hr />
        <h3 className="mb-3">Metrics List</h3>
        <MarkdownInput
          value={form.watch("metricListMarkdown") || ""}
          setValue={(value) => form.setValue("metricListMarkdown", value)}
        />
        <h3 className="my-3">Metric Page</h3>
        <MarkdownInput
          value={form.watch("metricPageMarkdown") || ""}
          setValue={(value) => form.setValue("metricPageMarkdown", value)}
        />
      </Modal>
    </div>
  );
};

export default CustomMarkdown;
