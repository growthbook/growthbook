import { useEffect } from "react";
import { Box, Text } from "@radix-ui/themes";
import Modal from "@/components/Modal";
import Button from "@/ui/Button";
import track from "@/services/track";

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  organizationName?: string;
}

export default function WelcomeModal({
  open,
  onClose,
  organizationName,
}: WelcomeModalProps) {
  useEffect(() => {
    if (open) {
      track("welcome-modal-viewed", {
        organizationName,
      });
    }
  }, [open, organizationName]);

  const handleClose = () => {
    track("welcome-modal-dismissed", {
      organizationName,
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      close={handleClose}
      header="Welcome to GrowthBook!"
      trackingEventModalType="welcome-modal"
      trackingEventModalSource="homepage"
      size="md"
      cta="Get Started"
      submit={handleClose}
      hideCta={false}
      includeCloseCta={false}
      autoCloseOnSubmit={true}
    >
      <Box py="2">
        <Text size="3" as="p" mb="4">
          Welcome to your GrowthBook workspace! We're excited to have you here.
        </Text>
        <Text size="3" as="p" mb="4">
          GrowthBook helps you run experiments and manage feature flags with
          powerful statistical analysis and flexible targeting.
        </Text>
        <Text size="3" as="p">
          Let's get you started with creating your first feature flag or
          experiment. You can explore the platform and customize it to fit your
          needs.
        </Text>
      </Box>
    </Modal>
  );
}
