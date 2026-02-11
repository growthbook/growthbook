import { Flex } from "@radix-ui/themes";
import { ProgressBar } from "./ProgressBar";

export default function ProgressBarStories() {
  return (
    <Flex direction="column" gap="3">
      <ProgressBar
        segments={[{ id: "1", weight: 100, completion: 0, color: "indigo" }]}
      />
      <ProgressBar
        segments={[{ id: "1", weight: 100, completion: 70, color: "indigo" }]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 50,
            completion: 70,
            color: "indigo",
            endBorder: true,
          },
          { id: "2", weight: 50, completion: 0, color: "amber" },
        ]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 50,
            completion: 100,
            color: "indigo",
            endBorder: true,
          },
          { id: "2", weight: 50, completion: 30, color: "amber" },
        ]}
      />
      <ProgressBar
        segments={[
          {
            id: "1",
            weight: 20,
            completion: 0,
            color: "slate",
          },
          { id: "2", weight: 20, completion: 100, color: "purple" },
          { id: "3", weight: 20, completion: 0, color: "slate" },
          { id: "4", weight: 20, completion: 100, color: "indigo" },
          { id: "5", weight: 20, completion: 0, color: "slate" },
        ]}
      />
    </Flex>
  );
}
