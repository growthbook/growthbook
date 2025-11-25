import { useEffect, useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { useForm } from "react-hook-form";
import { getDefaultRole } from "shared/permissions";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useRouter } from "next/router";
import track from "@/services/track";
import RadioCards from "@/ui/RadioCards";
import Link from "@/ui/Link";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import { useAuth } from "@/services/auth";
import { isCloud } from "@/services/env";
import { useUser } from "@/services/UserContext";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useExperiments } from "@/hooks/useExperiments";
import { useFeaturesList } from "@/services/features";
import PagedModal from "../Modal/PagedModal";
import Page from "../Modal/Page";
import StringArrayField from "../Forms/StringArrayField";
import { InviteResult } from "../Settings/Team/InviteModal";
import UpgradeModal from "../Settings/UpgradeModal";

interface WelcomeModalProps {
  experiment: ExperimentInterfaceStringDates;
}

export default function WelcomeModal({ experiment }: WelcomeModalProps) {
  const {
    seatsInUse,
    organization,
    freeSeats,
    canSubscribe,
    refreshOrganization,
    email,
  } = useUser();
  const { apiCall } = useAuth();
  const { features } = useFeaturesList(false);
  const { experiments } = useExperiments();
  const router = useRouter();

  const [hasSeenWelcomeModal, setHasSeenWelcomeModal] =
    useLocalStorage<boolean>("welcome-modal-shown", false);
  const [openUpgradeModal, setOpenUpgradeModal] = useState(false);

  // Check if current user is the organization owner
  const isOrgOwner = organization?.ownerEmail === email;

  // Check if owner is an engineer
  const isOwnerEngineer =
    organization?.demographicData?.ownerJobTitle === "engineer";

  const demoProjectId = getDemoDatasourceProjectIdForOrganization(
    organization.id || "",
  );

  const form = useForm<{
    email: string[];
  }>({
    defaultValues: {
      email: [],
    },
  });

  const freeSeatsExceeded =
    isCloud() &&
    canSubscribe &&
    seatsInUse + form.watch("email").length > freeSeats;

  const hasFeatures = features.some((f) => f.project !== demoProjectId);
  const hasExperiments = experiments.some((e) => e.project !== demoProjectId);

  // Only show the welcome modal for non-engineer owners in new orgs that have no features or experiments, are cloud, and have not
  // seen the welcome modal yet
  const showWelcomeModal =
    experiment.project === demoProjectId &&
    !hasFeatures &&
    !hasExperiments &&
    !isOwnerEngineer &&
    isOrgOwner &&
    !hasSeenWelcomeModal;
  // TODO: Uncomment this when we are ready to release this feature. Needed for testing
  // && isCloud()

  useEffect(() => {
    if (showWelcomeModal) {
      track("welcome-modal-viewed", {
        organizationId: organization.id,
      });
    }
  }, [showWelcomeModal, organization.id]);

  useEffect(() => {
    if (freeSeatsExceeded) {
      const numEmailsToRemove =
        form.watch("email").length - (freeSeats - seatsInUse);
      setInviteError(
        `You can only invite up to ${freeSeats} team members on the Free plan. Please upgrade to invite more team members or remove ${numEmailsToRemove} email${numEmailsToRemove === 1 ? "" : "s"} to continue.`,
      );
    } else {
      setInviteError(null);
    }
  }, [freeSeatsExceeded, freeSeats, seatsInUse, form]);

  const [step, setStep] = useState(0);
  const [plan, setPlan] = useState<"free" | "pro">("free");
  const [failedInvites, setFailedInvites] = useState<InviteResult[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const onSubmitInvites = form.handleSubmit(async (value) => {
    const { email: emails } = value;

    // This should never happen, but just in case
    if (freeSeatsExceeded) {
      setInviteError(
        `You can only invite up to ${freeSeats} team members on the Free plan. Please upgrade to invite more team members or remove ${value.email.length - (freeSeats - seatsInUse)} email${value.email.length - (freeSeats - seatsInUse) === 1 ? "" : "s"} to continue.`,
      );
      return;
    }

    const failed: InviteResult[] = [];
    const succeeded: InviteResult[] = [];

    const defaultRole = {
      projectRoles: [],
      ...getDefaultRole(organization),
    };

    for (const email of emails) {
      const resp = await apiCall<{
        emailSent: boolean;
        inviteUrl: string;
        status: number;
        message?: string;
      }>(`/invite`, {
        method: "POST",
        body: JSON.stringify({
          email,
          ...defaultRole,
        }),
      });

      const result: InviteResult = {
        email,
        inviteUrl: resp.inviteUrl,
      };
      if (resp.emailSent) {
        succeeded.push(result);
      } else {
        failed.push(result);
      }

      track("Team Member Invited", {
        emailSent: resp.emailSent,
        role: defaultRole.role,
      });
    }
    setFailedInvites(failed);

    refreshOrganization();
  });

  if (!showWelcomeModal) {
    return null;
  }

  if (openUpgradeModal) {
    return (
      <UpgradeModal
        close={() => setOpenUpgradeModal(false)}
        source="welcome-modal"
        commercialFeature={null}
      />
    );
  }

  return (
    <PagedModal
      hideNav
      close={() => {
        setHasSeenWelcomeModal(true);
        // Redirect to Get Started page if user exits the modal
        router.push("/getstarted");
      }}
      header={null}
      trackingEventModalType="welcome-modal"
      trackingEventModalSource="sample-experiment"
      size="lg"
      cta={step === 0 ? "Continue" : "Continue to Sample Data"}
      secondaryCTA={
        <Button
          onClick={() => {
            setHasSeenWelcomeModal(true);
            // Redirect to Get Started page if user exits the modal
            router.push("/getstarted");
          }}
          variant="ghost"
        >
          {step === 0 ? "Cancel" : "Skip"}
        </Button>
      }
      submit={async () => {
        setHasSeenWelcomeModal(true);
      }}
      hideCta={false}
      includeCloseCta={false}
      forceCtaText={true}
      autoCloseOnSubmit={false}
      showHeaderCloseButton={false}
      backButton={false}
      step={step}
      setStep={setStep}
      ctaEnabled={
        !(freeSeatsExceeded && form.watch("email").length > 0 && step === 0)
      }
    >
      <Page
        display="Start using GrowthBook"
        customNext={() => {
          onSubmitInvites();
          // Allow the user to correct the failed invites and try again
          if (failedInvites.length > 0) {
            return;
          }
          if (plan === "pro") {
            setOpenUpgradeModal(true);
          }

          setStep((prev) => prev + 1);
        }}
      >
        <Box py="2" mr="4">
          <h3
            className="mb-1"
            style={{ color: "var(--color-text-high)", fontSize: "20px" }}
          >
            Start using GrowthBook
          </h3>
          <p
            className="mb-0"
            style={{ color: "var(--color-text-mid)", fontSize: "16px" }}
          >
            Explore on your own or invite your team.
          </p>
          <Box mt="6" mb="5">
            <RadioCards
              options={[
                {
                  value: "free",
                  label: "Free Plan",
                  description:
                    "Built for individuals and small teams who want to explore the essentials.",
                },
                {
                  value: "pro",
                  label: "Upgrade to Pro",
                  description:
                    "Access advanced experimentation, permissioning and security features.",
                },
              ]}
              value={plan}
              setValue={(value) => {
                setPlan(value as "free" | "pro");
              }}
              columns={"2"}
              align="center"
              width="100%"
              descriptionWeight={"medium"}
              truncateDescription={false}
            />
          </Box>
          <Text style={{ color: "var(--color-text-low)" }}>
            {plan === "free"
              ? "No credit card required. Curious what Pro has to offer?"
              : "Continuing will require a credit card to purchase a Pro plan for your organization."}
          </Text>
          <Link href="https://www.growthbook.io/pricing" ml="2">
            <Text weight="bold">Learn more </Text>
            <PiArrowSquareOut size={15} />
          </Link>
          <Box mt="6">
            {/* TODO: We might not need to check failed if this is on cloud and we always have email setup */}
            {failedInvites.length === 1 && (
              <>
                <Callout status="error">
                  Failed to send invite email to{" "}
                  <strong>{failedInvites[0].email}</strong>
                </Callout>
                <p>You can manually send them the following invite link:</p>
                <div className="mb-3">
                  <code>{failedInvites[0].inviteUrl}</code>
                </div>
              </>
            )}
            {failedInvites.length > 1 && (
              <>
                <Callout status="error">
                  <strong>
                    Whoops! We weren&apos;t able to email the following members:
                  </strong>
                  <div className="pt-2">
                    <ul>
                      {failedInvites.map((failedInvite) => {
                        return (
                          <li key={failedInvite.inviteUrl}>
                            {failedInvite.email}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Callout>
                <div className="pl-2 pr-2 mb-3">
                  To manually send a member their invite link, close this modal
                  and click the 3 dots next to each member and select
                  &apos;Resend Invite&apos;.
                </div>
              </>
            )}
            <h4 className="mb-1" style={{ color: "var(--color-text-high)" }}>
              Invite team members
            </h4>
            <p style={{ color: "var(--color-text-mid)" }}>
              By default, members are added as Collaborators with edit and view
              access. Edit roles anytime.
            </p>
            {inviteError && (
              <Callout mb="3" status="error">
                {inviteError}
              </Callout>
            )}
            <StringArrayField
              placeholder="name@example.com"
              value={form.watch("email")}
              onChange={(emails) => {
                form.setValue("email", emails);
              }}
            />
          </Box>
        </Box>
      </Page>
      <Page display="Welcome to GrowthBook">
        <Box py="2" mr="4">
          <Flex direction="column" align="center">
            <h3
              className="mb-1"
              style={{ color: "var(--color-text-high)", fontSize: "20px" }}
            >
              Welcome to GrowthBook!
            </h3>
          </Flex>

          <Box
            style={{
              height: "251px",
              width: "100%",
              background: "var(--color-background)",
            }}
          >
            <Flex align="center" justify="center" mt="6" height="100%">
              {/* TODO: Replace with actual image once it's ready */}
              <Text>IMAGE HERE</Text>
            </Flex>
          </Box>
        </Box>
      </Page>
    </PagedModal>
  );
}
