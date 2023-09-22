import { FeatureRevisionInterface } from "back-end/types/feature-revision";
import { action } from "@storybook/addon-actions";
import { MemberData } from "@/hooks/useMembers";
import { transformDraftForView } from "@/components/FeatureDraftsDropDown/FeatureDraftsDropdown.utils";
import { FeatureDraftsDropDown } from "./FeatureDraftsDropDown";

export default {
  component: FeatureDraftsDropDown,
  title: "Feature Revisions/FeatureDraftsDropDown",
};

export const Default = () => {
  const memberLookup: Record<string, MemberData> = {
    "user-1": {
      id: "user-1",
      display: "Tina 1",
      email: "tina@growthbook.io",
      value: "Tina 1",
    },
    "user-2": {
      id: "user-2",
      display: "Tina 2",
      email: "info@tinaciousdesign.com",
      value: "Tina 2",
    },
    "user-3": {
      id: "user-3",
      display: "Graham",
      email: "graham@growthbook.io",
      value: "Graham",
    },
    "user-4": {
      id: "user-4",
      display: "Jeremy",
      email: "jeremy@growthbook.io",
      value: "Jeremy",
    },
  };
  const revisions: FeatureRevisionInterface[] = [
    {
      id: "feat-rev_aaf83876-cf2e-4d98-b5d4-d4b1780ecf9b",
      organization: "org_sktwi1id9l7z9xkjb",
      featureId: "a",
      version: 23,
      dateCreated: "2023-09-21T23:32:36.290Z",
      revisionDate: "2023-09-21T23:32:36.286Z",
      publishedBy: null,
      comment: "bar",
      defaultValue: "false",
      rules: {
        production: [
          {
            type: "force",
            description: "",
            id: "fr_sktwi6h9lak467jw",
            value: "true",
            enabled: true,
            condition: '{"id": "1"}',
          },
        ],
        staging: [
          {
            type: "force",
            description: "",
            id: "fr_sktwickhlmtsmm7f",
            value: "true",
            enabled: true,
            condition: '{"id": "foooo"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwide7lmtt5pru",
            value: "true",
            enabled: true,
            condition: '{"id": "bar"}',
          },
        ],
        dev: [],
      },
      creatorUserId: "user-1",
      status: "draft",
    },
    {
      id: "feat-rev_42371c58-a144-4dfa-8f1e-4714d2c079d8",
      organization: "org_sktwi1id9l7z9xkjb",
      featureId: "a",
      version: 24,
      dateCreated: "2023-09-21T23:34:21.250Z",
      revisionDate: "2023-09-21T23:34:21.247Z",
      publishedBy: null,
      comment: "baz",
      defaultValue: "false",
      rules: {
        production: [
          {
            type: "force",
            description: "",
            id: "fr_sktwi6h9lak467jw",
            value: "true",
            enabled: true,
            condition: '{"id": "1"}',
          },
        ],
        staging: [
          {
            type: "force",
            description: "",
            id: "fr_sktwickhlmtsmm7f",
            value: "true",
            enabled: true,
            condition: '{"id": "foooo"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwide7lmtt5pru",
            value: "true",
            enabled: true,
            condition: '{"id": "bar"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwidirlmtt7yq1",
            value: "true",
            enabled: true,
            condition: '{"id": "baz"}',
          },
        ],
        dev: [],
      },
      creatorUserId: "user-2",
      status: "draft",
    },
    {
      id: "feat-rev_42371c58-a144-4dfa-8f1e-4714d2c079d8",
      organization: "org_sktwi1id9l7z9xkjb",
      featureId: "a",
      version: 25,
      dateCreated: "2023-09-21T23:34:21.250Z",
      revisionDate: "2023-09-21T23:34:21.247Z",
      publishedBy: null,
      comment: "baz",
      defaultValue: "false",
      rules: {
        production: [
          {
            type: "force",
            description: "",
            id: "fr_sktwi6h9lak467jw",
            value: "true",
            enabled: true,
            condition: '{"id": "1"}',
          },
        ],
        staging: [
          {
            type: "force",
            description: "",
            id: "fr_sktwickhlmtsmm7f",
            value: "true",
            enabled: true,
            condition: '{"id": "foooo"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwide7lmtt5pru",
            value: "true",
            enabled: true,
            condition: '{"id": "bar"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwidirlmtt7yq1",
            value: "true",
            enabled: true,
            condition: '{"id": "baz"}',
          },
        ],
        dev: [],
      },
      creatorUserId: "user-3",
      status: "draft",
    },
    {
      id: "feat-rev_42371c58-a144-4dfa-8f1e-4714d2c079d8",
      organization: "org_sktwi1id9l7z9xkjb",
      featureId: "a",
      version: 26,
      dateCreated: "2023-09-21T23:34:21.250Z",
      revisionDate: "2023-09-21T23:34:21.247Z",
      publishedBy: null,
      comment: "baz",
      defaultValue: "false",
      rules: {
        production: [
          {
            type: "force",
            description: "",
            id: "fr_sktwi6h9lak467jw",
            value: "true",
            enabled: true,
            condition: '{"id": "1"}',
          },
        ],
        staging: [
          {
            type: "force",
            description: "",
            id: "fr_sktwickhlmtsmm7f",
            value: "true",
            enabled: true,
            condition: '{"id": "foooo"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwide7lmtt5pru",
            value: "true",
            enabled: true,
            condition: '{"id": "bar"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwidirlmtt7yq1",
            value: "true",
            enabled: true,
            condition: '{"id": "baz"}',
          },
        ],
        dev: [],
      },
      creatorUserId: "user-4",
      status: "draft",
    },
    {
      id: "feat-rev_42371c58-a144-4dfa-8f1e-4714d2c079d8",
      organization: "org_sktwi1id9l7z9xkjb",
      featureId: "a",
      version: 27,
      dateCreated: "2023-09-21T23:34:21.250Z",
      revisionDate: "2023-09-21T23:34:21.247Z",
      publishedBy: null,
      comment: "baz",
      defaultValue: "false",
      rules: {
        production: [
          {
            type: "force",
            description: "",
            id: "fr_sktwi6h9lak467jw",
            value: "true",
            enabled: true,
            condition: '{"id": "1"}',
          },
        ],
        staging: [
          {
            type: "force",
            description: "",
            id: "fr_sktwickhlmtsmm7f",
            value: "true",
            enabled: true,
            condition: '{"id": "foooo"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwide7lmtt5pru",
            value: "true",
            enabled: true,
            condition: '{"id": "bar"}',
          },
          {
            type: "force",
            description: "",
            id: "fr_sktwidirlmtt7yq1",
            value: "true",
            enabled: true,
            condition: '{"id": "baz"}',
          },
        ],
        dev: [],
      },
      creatorUserId: "u_0c27f1c70ec24",
      status: "draft",
    },
  ];
  const drafts = revisions.map(transformDraftForView(memberLookup));

  return (
    <>
      <FeatureDraftsDropDown
        drafts={drafts}
        onDraftClick={action("onDraftClick")}
      />
    </>
  );
};
