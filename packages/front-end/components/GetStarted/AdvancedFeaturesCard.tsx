import { AspectRatio, Box, Text } from "@radix-ui/themes";
import styles from "./AdvancedFeaturesCard.module.scss";

export default function AdvancedFeaturesCard({
  href,
  imgUrl,
  title,
  description,
}: {
  href: string;
  imgUrl: string;
  title: string;
  description?: string;
}) {
  const card = (
    <div
      className={styles.card}
      style={
        {
          "--bg-advanced-features-card-image": `url("${imgUrl}")`,
        } as React.CSSProperties
      }
    >
      <div className={styles.cardContent}>
        {title && (
          <Text size="1" weight="medium" className={styles.cardTitle} as="div">
            {title}
          </Text>
        )}
        {description && (
          <Text size="1" weight="medium" className={styles.cardSubtitle}>
            {description}
          </Text>
        )}
      </div>
    </div>
  );

  return (
    <Box width="100%" height="100%">
      <AspectRatio ratio={16 / 9}>
        <a href={href} target="_blank" rel="noreferrer">
          {card}
        </a>
      </AspectRatio>
    </Box>
  );
}
