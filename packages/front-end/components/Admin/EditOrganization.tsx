import { useState, FC } from "react";
import isEqual from "lodash/isEqual";
import { OrganizationInterface } from "shared/types/organization";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

// One modal per card, so an edit only touches the fields that card shows
const EditOrganization: FC<{
  onEdit: () => void;
  close: () => void;
  currentOrg: OrganizationInterface;
  section: "account" | "license";
}> = ({ onEdit, close, currentOrg, section }) => {
  const [name, setName] = useState(currentOrg.name);
  const [owner, setOwner] = useState(currentOrg.ownerEmail);
  const [externalId, setExternalId] = useState(currentOrg.externalId || "");
  const [licenseKey, setLicenseKey] = useState(currentOrg.licenseKey || "");
  const [freeSeats, setFreeSeats] = useState(currentOrg.freeSeats ?? 3);
  const [legacyEnterprise, setLegacyEnterprise] = useState(
    currentOrg.enterprise || false,
  );
  const [disableSelfServeBilling, setDisableSelfServeBilling] = useState(
    currentOrg.disableSelfServeBilling || false,
  );

  const values = {
    name,
    externalId,
    licenseKey,
    ownerEmail: owner,
    enterprise: legacyEnterprise,
    freeSeats,
    disableSelfServeBilling,
  };
  // Snapshot from the first render, to diff against on submit
  const [initialValues] = useState(values);

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    // Send only what this admin changed, so a stale value for a field they
    // didn't touch can't overwrite another admin's edit or fail a permission check
    const changes = Object.fromEntries(
      Object.entries(values).filter(
        ([k, v]) => !isEqual(v, initialValues[k as keyof typeof values]),
      ),
    );
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/organization", {
      method: "PUT",
      body: JSON.stringify({ orgId: currentOrg.id, ...changes }),
    });
    onEdit();
  };

  return (
    <ModalStandard
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header={section === "account" ? "Edit Account" : "Edit License"}
      subheader={currentOrg.name}
      cta="Save"
      close={close}
    >
      {section === "account" ? (
        <Flex direction="column" gap="4">
          <TextField
            label="Name"
            value={name}
            required
            minLength={3}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            label="Owner email"
            type="email"
            value={owner}
            required
            onChange={(e) => setOwner(e.target.value)}
          />
          {!isCloud() && (
            <TextField
              label="External ID"
              value={externalId}
              minLength={3}
              helpText="Identifies the organization within your company."
              onChange={(e) => setExternalId(e.target.value)}
            />
          )}
        </Flex>
      ) : (
        <Flex direction="column" gap="4">
          <TextField
            label="License key"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
          />
          <TextField
            label="Free seats"
            type="number"
            min={0}
            value={freeSeats}
            helpText="Seats available on a free plan. The default is 3."
            onChange={(e) => setFreeSeats(parseInt(e.target.value))}
          />
          <Checkbox
            id="disableSelfServeBilling"
            label="Disable self-serve billing"
            description="Prevents members from managing their own subscription."
            value={disableSelfServeBilling}
            setValue={setDisableSelfServeBilling}
          />
          <Callout status="warning">
            <Flex direction="column" gap="2">
              <Text>
                Legacy Enterprise doesn&apos;t expire or limit seats, and
                isn&apos;t billed. Uncheck it and set a license key in Retool
                instead.
              </Text>
              <Checkbox
                id="legacyEnterpriseToggle"
                label="Enable legacy Enterprise"
                value={legacyEnterprise}
                setValue={setLegacyEnterprise}
              />
            </Flex>
          </Callout>
        </Flex>
      )}
    </ModalStandard>
  );
};

export default EditOrganization;
