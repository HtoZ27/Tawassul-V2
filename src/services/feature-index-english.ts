const NON_ENGLISH_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Thai}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Thaana}]/u;

const NON_ENGLISH_RUN =
  /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\p{M}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Thai}\p{Script=Armenian}\p{Script=Georgian}\p{Script=Ethiopic}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Thaana}]+/gu;

interface FeatureText {
  name: string;
  description: string;
}

const LEGACY_ENGLISH: Record<string, FeatureText> = {
  "feat-2e3b9385-5741-4c41-a9cf-bd800d6ae89a": {
    name: "@analyst-gemini @analyst-ling @analyst-mimo @analyst-muse @analyst-pickle evaluation",
    description:
      "@analyst-gemini @analyst-ling @analyst-mimo @analyst-muse @analyst-pickle  atomic evaluation of the problems and gaps in V2 and whether the port from v1 is sound   Use the above message and context to generate a prompt and call the task tool with subagent: analyst-gemini   Use the above message and context to generate a prompt and call the task tool with subagent: analyst-ling   Use the above message and context to generate a prompt and call the task tool with subagent: analyst-mimo   Use the above message and context to gene",
  },
  "feat-53dc3644-1b4e-49b6-9f18-c4046b44b8b2": {
    name: "This is an open task: start the documented fixes; if a test fix needs isolation, do it",
    description:
      "This is an open task: start with the documented fixes, and if a test fix needs isolation, do it. Note: take one step, verify it, then continue with the next step at the same pace instead of jumping ten steps ahead.",
  },
  "feat-81fd5274-7f61-4694-8e3b-7804cf2ba8ba": {
    name: "Continue: this is an open task; start the fixes, and if a test fix needs isolation, run it",
    description:
      "Continue: this is an open task. Start the documented fixes, and if a test fix needs isolation, do it. Note: take one step, verify it, then continue with the next step at the same pace instead of jumping ten steps ahead.",
  },
  "feat-4bbae326-f7af-4b10-88ad-51a776592c0d": {
    name: "A new OpenCode release v2.2.0 is installed and fixed app issues; I will send you",
    description:
      "A new OpenCode release v2.2.0 is installed and it fixed issues in the app. I will send you the changes they made and whether they will help solve problems, plus problems we solved differently because the v2 structure differs from v1, and improvements we should adopt. Note: do nothing until I send you the change list.",
  },
  "feat-da09136f-96b4-43b3-b7cc-ea3690d1d6ab": {
    name: "The goal feature must update items when that is the owner's opinion or the item wording changed",
    description:
      "The goal feature must update items when that is the owner's opinion, or the item wording was updated, or the owner decided it is not needed.",
  },
  "feat-afc82012-558e-413a-b865-5bf09510101e": {
    name: 'goal(update: G-001, itemId: G-001-I1, itemTitle: "the new wording") goal(updat',
    description:
      'goal(update: G-001, itemId: G-001-I1, itemTitle: "the new wording")   goal(update: G-001, itemId: G-001-I1,\n     itemEvidence: [{ itemId: "G-001-I1", text: "the owner decided it is not needed" }],\n     itemState: "dropped")',
  },
};

function englishRemainder(value: string): string {
  return value.replace(NON_ENGLISH_RUN, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeFeatureText(value: string, fallback: string): string {
  if (!NON_ENGLISH_SCRIPT.test(value)) return value;
  const remainder = englishRemainder(value);
  return remainder.length >= 3 ? remainder : fallback;
}

export function normalizeLegacyFeatureEntry(entry: FeatureText & { id: string }): void {
  const legacy = LEGACY_ENGLISH[entry.id];
  if (legacy) {
    if (NON_ENGLISH_SCRIPT.test(entry.name)) entry.name = legacy.name;
    if (NON_ENGLISH_SCRIPT.test(entry.description)) entry.description = legacy.description;
  }
  entry.name = sanitizeFeatureText(entry.name, "Session task");
  entry.description = sanitizeFeatureText(
    entry.description,
    "Registered from a non-English message; see the session transcript.",
  );
}
