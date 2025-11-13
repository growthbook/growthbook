import { Box, Flex, Text, Separator } from "@radix-ui/themes";
import {
  AddressElement,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { TaxIdType, StripeAddress } from "shared/src/types";
import { PiCaretRight } from "react-icons/pi";
import { useStripeContext } from "@/hooks/useStripeContext";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import PagedModal from "@/components/Modal/PagedModal";
import Page from "@/components/Modal/Page";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import { GBInfo } from "@/components/Icons";
import Checkbox from "@/ui/Checkbox";
import Modal from "@/components/Modal";

export const taxIdTypeOptions: { label: string; value: TaxIdType }[] = [
  { label: "US EIN", value: "us_ein" },
  { label: "AD NRT", value: "ad_nrt" },
  { label: "AE TRN", value: "ae_trn" },
  { label: "AL TIN", value: "al_tin" },
  { label: "AM TIN", value: "am_tin" },
  { label: "AO TIN", value: "ao_tin" },
  { label: "AR CUIT", value: "ar_cuit" },
  { label: "AU ABN", value: "au_abn" },
  { label: "AU ARN", value: "au_arn" },
  { label: "BA TIN", value: "ba_tin" },
  { label: "BB TIN", value: "bb_tin" },
  { label: "BG UIC", value: "bg_uic" },
  { label: "BH VAT", value: "bh_vat" },
  { label: "BO TIN", value: "bo_tin" },
  { label: "BR CNPJ", value: "br_cnpj" },
  { label: "BR CPF", value: "br_cpf" },
  { label: "BS TIN", value: "bs_tin" },
  { label: "BY TIN", value: "by_tin" },
  { label: "CA BN", value: "ca_bn" },
  { label: "CA GST HST", value: "ca_gst_hst" },
  { label: "CA PST BC", value: "ca_pst_bc" },
  { label: "CA PST MB", value: "ca_pst_mb" },
  { label: "CA PST SK", value: "ca_pst_sk" },
  { label: "CA QST", value: "ca_qst" },
  { label: "CD NIF", value: "cd_nif" },
  { label: "CH UID", value: "ch_uid" },
  { label: "CH VAT", value: "ch_vat" },
  { label: "CL TIN", value: "cl_tin" },
  { label: "CN TIN", value: "cn_tin" },
  { label: "CO NIT", value: "co_nit" },
  { label: "CR TIN", value: "cr_tin" },
  { label: "DE STN", value: "de_stn" },
  { label: "DO RCN", value: "do_rcn" },
  { label: "EC RUC", value: "ec_ruc" },
  { label: "EG TIN", value: "eg_tin" },
  { label: "ES CIF", value: "es_cif" },
  { label: "EU OSS VAT", value: "eu_oss_vat" },
  { label: "EU VAT", value: "eu_vat" },
  { label: "GB VAT", value: "gb_vat" },
  { label: "GE VAT", value: "ge_vat" },
  { label: "GN NIF", value: "gn_nif" },
  { label: "HK BR", value: "hk_br" },
  { label: "HR OIB", value: "hr_oib" },
  { label: "HU TIN", value: "hu_tin" },
  { label: "ID NPWP", value: "id_npwp" },
  { label: "IL VAT", value: "il_vat" },
  { label: "IN GST", value: "in_gst" },
  { label: "IS VAT", value: "is_vat" },
  { label: "JP CN", value: "jp_cn" },
  { label: "JP RN", value: "jp_rn" },
  { label: "JP TRN", value: "jp_trn" },
  { label: "KE PIN", value: "ke_pin" },
  { label: "KH TIN", value: "kh_tin" },
  { label: "KR BRN", value: "kr_brn" },
  { label: "KZ BIN", value: "kz_bin" },
  { label: "LI UID", value: "li_uid" },
  { label: "LI VAT", value: "li_vat" },
  { label: "MA VAT", value: "ma_vat" },
  { label: "MD VAT", value: "md_vat" },
  { label: "ME PIB", value: "me_pib" },
  { label: "MK VAT", value: "mk_vat" },
  { label: "MR NIF", value: "mr_nif" },
  { label: "MX RFC", value: "mx_rfc" },
  { label: "MY FRP", value: "my_frp" },
  { label: "MY ITN", value: "my_itn" },
  { label: "MY SST", value: "my_sst" },
  { label: "NG TIN", value: "ng_tin" },
  { label: "NO VAT", value: "no_vat" },
  { label: "NO VOEC", value: "no_voec" },
  { label: "NP PAN", value: "np_pan" },
  { label: "NZ GST", value: "nz_gst" },
  { label: "OM VAT", value: "om_vat" },
  { label: "PE RUC", value: "pe_ruc" },
  { label: "PH TIN", value: "ph_tin" },
  { label: "RO TIN", value: "ro_tin" },
  { label: "RS PIB", value: "rs_pib" },
  { label: "RU INN", value: "ru_inn" },
  { label: "RU KPP", value: "ru_kpp" },
  { label: "SA VAT", value: "sa_vat" },
  { label: "SG GST", value: "sg_gst" },
  { label: "SG UEN", value: "sg_uen" },
  { label: "SI TIN", value: "si_tin" },
  { label: "SN NINEA", value: "sn_ninea" },
  { label: "SR FIN", value: "sr_fin" },
  { label: "SV NIT", value: "sv_nit" },
  { label: "TH VAT", value: "th_vat" },
  { label: "TJ TIN", value: "tj_tin" },
  { label: "TR TIN", value: "tr_tin" },
  { label: "TW VAT", value: "tw_vat" },
  { label: "TZ VAT", value: "tz_vat" },
  { label: "UA VAT", value: "ua_vat" },
  { label: "UG TIN", value: "ug_tin" },
  { label: "UY RUC", value: "uy_ruc" },
  { label: "UZ TIN", value: "uz_tin" },
  { label: "UZ VAT", value: "uz_vat" },
  { label: "VE RIF", value: "ve_rif" },
  { label: "VN TIN", value: "vn_tin" },
  { label: "ZA VAT", value: "za_vat" },
  { label: "ZM TIN", value: "zm_tin" },
  { label: "ZW TIN", value: "zw_tin" },
];

interface Props {
  close: () => void;
  closeParent: () => void;
}

export default function CloudProUpgradeModal({ close, closeParent }: Props) {
  const [step, setStep] = useState(0);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showAddress, setShowAddress] = useState(false);
  const { clientSecret } = useStripeContext();
  const { refreshOrganization, organization, email } = useUser();
  const { apiCall } = useAuth();
  const elements = useElements();
  const stripe = useStripe();

  const form = useForm<{
    address: StripeAddress | undefined;
    name: string; // This is what the user will see on their Invoices
    email: string;
    taxIdType?: TaxIdType;
    taxIdValue?: string;
  }>({
    defaultValues: {
      name: organization.name,
      email: email,
      taxIdType: undefined,
      taxIdValue: undefined,
      address: undefined,
    },
  });

  const handleSubmit = async () => {
    if (!stripe || !elements || !clientSecret) return;

    setLoading(true);
    try {
      // Validate inputs
      const { error: submitError } = await elements.submit();
      if (submitError) {
        throw new Error(
          submitError.message || "Unable to validate payment method inputs",
        );
      }

      if (showAddress) {
        const addressElement = elements.getElement("address");

        if (!addressElement) {
          throw new Error("Unable to get address element");
        }

        const { complete, value } = await addressElement.getValue();

        if (complete && value) {
          form.setValue("name", value.name);
          form.setValue("address", value.address);
        }
      }

      // Add payment method to customer in stripe
      await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
      });

      // Now that payment is confirmed, create the subscription
      await apiCall("/subscription/start-new-pro", {
        method: "POST",
        body: JSON.stringify({
          name: form.watch("name"),
          address: form.watch("address"),
          email: form.watch("email"),
          taxConfig:
            form.watch("taxIdType") && form.watch("taxIdValue")
              ? {
                  type: form.watch("taxIdType"),
                  value: form.watch("taxIdValue"),
                }
              : undefined,
        }),
      });
      refreshOrganization();
      setLoading(false);
      setSuccess(true);
    } catch (e) {
      setLoading(false);
      throw new Error(e.message);
    }
  };

  if (success) {
    return (
      <Modal
        header={null}
        close={() => {
          close();
          closeParent();
        }}
        closeCta="Close"
        open={true}
        size="lg"
        trackingEventModalType="upgrade-to-pro"
        trackingEventModalSource="upgrade-modal"
        showHeaderCloseButton={false}
      >
        <div className="container-fluid dashboard p-3 ">
          <h3>Welcome to GrowthBook Pro!</h3>
          <span>
            You&apos;re all set! Your organization now has access to all
            GrowthBook Pro features.
          </span>
        </div>
      </Modal>
    );
  }

  function header() {
    return (
      <>
        <h3
          className="mb-1"
          style={{ color: "var(--color-text-high)", fontSize: "20px" }}
        >
          Upgrade to Pro
        </h3>
        <p
          className="mb-0"
          style={{ color: "var(--color-text-mid)", fontSize: "16px" }}
        >
          Get instant access to advanced experimentation, permissioning and
          security features.
        </p>
      </>
    );
  }

  return (
    <PagedModal
      trackingEventModalType="upgrade-to-pro"
      trackingEventModalSource="upgrade-modal"
      hideNav={true}
      close={() => {
        close();
        closeParent();
      }}
      autoCloseOnSubmit={false}
      size="lg"
      header={null}
      submit={async () => await handleSubmit()}
      cta={
        <>
          {step === 1 ? (
            "Start subscription"
          ) : (
            <>
              Next <PiCaretRight />
            </>
          )}
        </>
      }
      step={step}
      forceCtaText={true}
      showHeaderCloseButton={false}
      setStep={setStep}
      loading={loading}
      backButton={true}
    >
      <Page display="Adjust Invoice Settings">
        <div className="container-fluid dashboard p-3 ">
          {header()}
          <div className="py-4">
            <label>Billing Email</label>
            <Text as="p" mb="2">
              Monthly invoices will be sent to this address
            </Text>
            <Field
              type="email"
              required={true}
              {...form.register("email")}
              defaultValue={form.watch("email")}
            />
          </div>
          <Flex align="center" width="100%" gap="4">
            <Box style={{ width: "50%" }}>
              <SelectField
                label="Tax ID type"
                options={taxIdTypeOptions}
                value={form.watch("taxIdType") || ""}
                placeholder="(optional)"
                onChange={(value) =>
                  form.setValue("taxIdType", value as TaxIdType)
                }
                isClearable={true}
              />
            </Box>
            <Box style={{ width: "50%" }}>
              <Field
                type="text"
                {...form.register("taxIdValue")}
                placeholder="(optional)"
                label={
                  <Flex align="center">
                    <span className="mr-1">Tax ID</span>
                    <Tooltip body="Enter your tax id here. E.G. VAT or EIN">
                      <GBInfo />
                    </Tooltip>
                  </Flex>
                }
              />
            </Box>
          </Flex>
        </div>
      </Page>
      <Page display="Add Payment Method">
        <div className="container-fluid dashboard p-3 ">
          {header()}
          <div className="py-4">
            <PaymentElement />
            <p className="pt-3" style={{ marginBottom: "12px" }}>
              The cost is <strong>$40 per seat per month</strong>. You will be
              charged a pro-rated amount immediately for the remainder of the
              current month and it will renew automatically on the 1st of each
              subsequent month. Cancel anytime.
            </p>
            <Separator size="4" mb="3" />
            <div className="mb-4">
              <Checkbox
                label="Customize Invoice"
                value={showAddress}
                setValue={setShowAddress}
                description="Add a full billing address and optionally customize the name displayed on invoices."
              />
            </div>
            {showAddress && (
              <AddressElement
                className="pb-2"
                options={{
                  mode: "billing",
                  fields: {
                    phone: "never",
                  },
                  display: {
                    name: "organization",
                  },
                  defaultValues: {
                    name: organization.name,
                  },
                }}
              />
            )}
          </div>
        </div>
      </Page>
    </PagedModal>
  );
}
