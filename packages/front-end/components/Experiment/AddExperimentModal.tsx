import { FC, useState } from "react";
import { IconType } from "react-icons";
import { GoBeaker, GoGraph } from "react-icons/go";
import clsx from "clsx";
import track from "@/services/track";
import usePermissions from "@/hooks/usePermissions";
import { useDefinitions } from "@/services/DefinitionsContext";
import Modal from "../Modal";
import styles from "./AddExperimentModal.module.scss";
import ImportExperimentModal from "./ImportExperimentModal";
import NewExperimentForm from "./NewExperimentForm";

type CTA = {
  Icon: IconType;
  onClick: () => void;
  cta: string;
  description: string;
  enabled: boolean;
};

const CreateExperimentCTA: FC<CTA> = ({
  Icon,
  onClick,
  cta,
  description,
  enabled,
}) => {
  return (
    <div
      className={clsx(
        styles.ctaContainer,
        enabled ? styles.enabled : styles.disabled
      )}
      onClick={enabled ? onClick : null}
    >
      <div className={styles.ctaButton}>
        <div className={styles.ctaIconContainer}>
          <Icon size={96} />
        </div>
        <div>
          <h3 className={styles.ctaText}>{cta}</h3>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
};

const AddExperimentModal: FC<{
  onClose: () => void;
  source?: string;
}> = ({ onClose, source }) => {
  const { project } = useDefinitions();

  const permissions = usePermissions();
  const hasRunExperimentsPermission = permissions.check(
    "runExperiments",
    project,
    []
  );

  const [mode, setMode] = useState<"new" | "import" | null>(null);

  const ctas: CTA[] = [
    {
      cta: "Analyze an Existing Experiment",
      description:
        "Analyze a current or past experiment that already has data collected",
      Icon: GoGraph,
      onClick: () => {
        setMode("import");
        track("Analyze an Existing Experiment", { source });
      },
      enabled: true,
    },
    {
      cta: "Design a New Experiment",
      description:
        "Use our Visual Editor to build and run a brand new front-end experiment",
      Icon: GoBeaker,
      onClick: () => {
        setMode("new");
        track("Design a New Experiment", { source });
      },
      enabled: hasRunExperimentsPermission,
    },
  ];

  switch (mode) {
    case "new":
      return (
        <NewExperimentForm
          onClose={onClose}
          // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'string | undefined' is not assignable to typ... Remove this comment to see the full error message
          source={source}
          isNewExperiment={true}
        />
      );
    case "import":
      return <ImportExperimentModal onClose={onClose} source={source} />;
    default:
      return (
        <Modal open close={() => onClose()} size="lg" header="Add Experiment">
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
            }}
          >
            {ctas.map(({ cta, description, Icon, onClick, enabled }, index) => (
              <CreateExperimentCTA
                key={index}
                cta={cta}
                Icon={Icon}
                onClick={onClick}
                description={description}
                enabled={enabled}
              />
            ))}
          </div>
        </Modal>
      );
  }
};

export default AddExperimentModal;
