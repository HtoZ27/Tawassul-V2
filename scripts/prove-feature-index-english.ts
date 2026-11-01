import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FeatureIndex } from "../src/services/feature-index.ts";
import {
  MODEL_CATALOG,
  MODEL_DISPLAY_NAMES,
  getAllModelDisplayNames,
  getUserFacingModelName,
} from "../src/core/model-registry.ts";
import { getLanguage, loadLocale, recordTypeLabel, setLanguage, t } from "../src/translations.ts";
import { detectLanguage } from "../src/services/routing-algorithm.ts";
import { msg } from "../src/services/messages.ts";
import { buildGuidance } from "../src/services/routing-guidance.ts";

let passed = 0;

function fail(msg: string): never {
  console.error(`PROOF FAIL: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

function assert(cond: unknown, name: string): void {
  if (!cond) fail(name);
  passed++;
  console.log(`ok ${name}`);
}

const ARABIC = String.fromCharCode(0x645, 0x631, 0x62d, 0x628, 0x627);
const ARABIC_RE = /\p{Script=Arabic}/u;

type RawEntry = Parameters<typeof FeatureIndex.fromJSON>[0]["entries"][number];

function entry(id: string, name: string, description: string): RawEntry {
  return {
    id,
    name,
    description,
    status: "discovered",
    files: [],
    algorithms: [],
    tests: [],
    components: [],
    regressionTests: [],
    created: "2026-10-27T00:00:00.000Z",
    updated: "2026-10-27T00:00:00.000Z",
    tags: [],
    metadata: {},
    evaluationReports: [],
  };
}

const legacyId = "feat-2e3b9385-5741-4c41-a9cf-bd800d6ae89a";
const legacyIndex = FeatureIndex.fromJSON({
  entries: [entry(legacyId, `${ARABIC} evaluation`, `${ARABIC} archived`)],
});
const legacy = legacyIndex.toJSON().entries[0]!;
assert(
  legacy.name === "@analyst-gemini @analyst-ling @analyst-mimo @analyst-muse @analyst-pickle evaluation",
  "a legacy feature id receives its English name",
);
assert(
  legacy.description.startsWith(
    "@analyst-gemini @analyst-ling @analyst-mimo @analyst-muse @analyst-pickle  atomic evaluation",
  ),
  "a legacy feature id receives its English description",
);
assert(!ARABIC_RE.test(JSON.stringify(legacyIndex.toJSON())), "the legacy entry is fully English");

const mixedIndex = FeatureIndex.fromJSON({
  entries: [
    entry("feat-00000000-0000-0000-0000-000000000001", `${ARABIC} deploy task`, `${ARABIC}`),
    entry("feat-00000000-0000-0000-0000-000000000002", "plain task", "plain description"),
  ],
});
const mixed = mixedIndex.toJSON().entries;
assert(mixed[0]!.name === "deploy task", "an unknown entry keeps its English remainder");
assert(
  mixed[0]!.description === "Registered from a non-English message; see the session transcript.",
  "an unknown entry falls back to an English description",
);
assert(mixed[1]!.name === "plain task", "an English entry is untouched");
assert(!ARABIC_RE.test(JSON.stringify(mixedIndex.toJSON())), "unknown mixed entries are fully English");

const fresh = new FeatureIndex();
const registered = fresh.register({
  name: `${ARABIC} fix the build`,
  description: `goal update G-003 ${ARABIC}`,
});
assert(registered.name === "fix the build", "registration keeps the English remainder of the name");
assert(registered.description === "goal update G-003", "registration keeps the English remainder of the description");

const empty = fresh.register({ name: ARABIC, description: ARABIC });
assert(empty.name === "Session task", "a fully non-English name falls back to an English label");
assert(
  empty.description === "Registered from a non-English message; see the session transcript.",
  "a fully non-English description falls back to an English label",
);
assert(!ARABIC_RE.test(JSON.stringify(fresh.toJSON())), "registered entries are fully English");

const twice = FeatureIndex.fromJSON(legacyIndex.toJSON());
assert(
  twice.toJSON().entries[0]!.name === legacy.name,
  "normalizing a second time keeps the English legacy name",
);

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const registrySource = readFileSync(join(repo, "src", "core", "model-registry.ts"), "utf8");
assert(!/\blang\b/i.test(registrySource), "the model registry exposes no lang parameter");
assert(
  MODEL_CATALOG.every((model) => model.display.length > 0 && !ARABIC_RE.test(model.display)),
  "every model display name is non-empty English",
);
assert(
  MODEL_CATALOG.every((model) => /^[\x20-\x7E]+$/.test(model.display)),
  "every model display name stays printable ASCII",
);
assert(Object.keys(MODEL_DISPLAY_NAMES).length === MODEL_CATALOG.length, "the display map covers the whole catalog");
assert(
  MODEL_CATALOG.every((model) => MODEL_DISPLAY_NAMES[model.id] === model.display),
  "the display map mirrors the catalog one-to-one",
);
assert(getAllModelDisplayNames().length === MODEL_CATALOG.length, "the display list returns one name per model");
assert(getUserFacingModelName.length === 1, "the user-facing resolver takes only the model id");
assert(
  MODEL_CATALOG.every((model) => getUserFacingModelName(model.id) === model.display),
  "the resolver returns the English display name",
);
assert(
  getUserFacingModelName("vendor/unknown-model") === "Model unknown-model",
  "an unknown model gets a single English fallback",
);

const translationsSource = readFileSync(join(repo, "src", "translations.ts"), "utf8");
const enRaw = readFileSync(join(repo, "src", "i18n", "en.json"), "utf8");
const arRaw = readFileSync(join(repo, "src", "i18n", "ar.json"), "utf8");
assert(!translationsSource.includes("logger"), "the translations loader has no logger dependency");
assert(
  translationsSource.includes('export const LANGUAGES = ["en", "ar"] as const;'),
  "the loader declares English and Arabic as the shipped languages",
);
assert(!ARABIC_RE.test(translationsSource), "the loader carries no Arabic literal");
assert(!ARABIC_RE.test(enRaw), "the English table carries no Arabic text");
assert(ARABIC_RE.test(arRaw), "the Arabic table carries Arabic text");
assert(!enRaw.startsWith("\uFEFF") && !arRaw.startsWith("\uFEFF"), "neither table starts with a byte-order mark");
const BIDI_RE = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/;
assert(!BIDI_RE.test(arRaw), "the Arabic table carries no bidi control characters");

setLanguage("en");
assert(getLanguage() === "en", "English is the default language");
const english = await loadLocale("en");
const arabic = await loadLocale("ar");
const englishKeys = Object.keys(english);
const arabicKeys = Object.keys(arabic);
assert(englishKeys.length > 400, "the English dictionary is loaded");
assert(!ARABIC_RE.test(JSON.stringify(english)), "every English value stays English");
assert(arabicKeys.length === englishKeys.length, "Arabic ships the same number of keys as English");
assert(
  englishKeys.every((key) => key in arabic),
  "every English key exists in the Arabic table",
);
assert(
  arabicKeys.every((key) => key in english),
  "the Arabic table invents no key the English table lacks",
);
assert(JSON.stringify(JSON.parse(arRaw)) === JSON.stringify(arabic), "the loader ships the Arabic file verbatim");
assert(JSON.stringify(JSON.parse(enRaw)) === JSON.stringify(english), "the loader ships the English file verbatim");
const placeholders = (value: string): string =>
  [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort().join(",");
assert(
  englishKeys.every((key) => placeholders(english[key] ?? "") === placeholders(arabic[key] ?? "")),
  "every key keeps the same placeholders in both tables",
);
assert(
  [...Object.values(english), ...Object.values(arabic)].every((value) => !value.includes("[missing:")),
  "neither table stores a missing-key marker",
);
assert(
  arabicKeys.filter((key) => arabic[key] !== english[key]).length > 500,
  "the Arabic table translates rather than copies",
);
const msgKeys = englishKeys.filter((key) => key.startsWith("msg."));
assert(msgKeys.length === 39, "the dispatcher messages live in the shared table");
assert(
  msgKeys.every((key) => ARABIC_RE.test(arabic[key] ?? "")),
  "every dispatcher message is Arabic in the Arabic table",
);
const guideKeys = englishKeys.filter((key) => key.startsWith("guide."));
assert(guideKeys.length === 33, "the routing guidance lives in the shared table");
assert(
  guideKeys.every((key) => ARABIC_RE.test(arabic[key] ?? "") || arabic[key] === english[key]),
  "every routing guidance line is Arabic or a role-only plan",
);
assert(
  ARABIC_RE.test(arabic["guide.requiredRole"] ?? "") && ARABIC_RE.test(arabic["guide.suggested"] ?? ""),
  "the routing guidance frame is Arabic",
);
assert(
  t("guide.medium", { plan: "dev <- tester" }, "ar").includes("dev <- tester"),
  "a nested plan interpolates into the Arabic frame",
);
const englishGuidance = buildGuidance("dev", "medium", null, []);
assert(
  englishGuidance.includes("Developer") && !englishGuidance.includes("[missing:"),
  "the guidance builder renders English by default",
);
assert(JSON.stringify(await loadLocale("zz")) === "{}", "an unsupported locale resolves to an empty dictionary");
assert(
  t("addagentDerived", { from: "dev", to: "dev-gemini", model: "gemini" }).includes("dev-gemini"),
  "the loader resolves English keys with parameters",
);
assert(
  t("msg.greeting", undefined, "ar") === arabic["msg.greeting"],
  "an explicit language overrides the active one",
);
assert(
  !t("msg.greeting", { model: "x" }, "ar").includes("x"),
  "an Arabic value interpolates no placeholder it does not carry",
);
assert(t("no-such-key") === "[missing: no-such-key]", "a missing key falls back to the marker");
assert(
  t("no-such-key", undefined, "ar") === "[missing: no-such-key]",
  "a missing key falls back to the same marker in Arabic",
);
assert(recordTypeLabel("fix", "critical") === "Fix (critical)", "record labels stay English under the English language");
assert(msg("greeting", "en") === english["msg.greeting"], "a dispatcher message resolves through the shared table");
assert(msg("greeting", "ar") === arabic["msg.greeting"], "a dispatcher message follows the requested language");
assert(
  msg("tawaQueuePosition", "ar", { position: "3", team: "dev" }).includes("dev"),
  "a dispatcher message interpolates its parameters",
);
setLanguage("ar");
assert(detectLanguage("") === "ar", "routing follows the configured language");
const arabicGuidance = buildGuidance("dev", "complex", "dev", []);
assert(
  ARABIC_RE.test(arabicGuidance) && !arabicGuidance.includes("[missing:"),
  "the guidance builder renders Arabic under the Arabic language",
);
setLanguage("en");
assert(detectLanguage("") === "en", "routing returns to English with the default");

console.log(`PROOF PASS: display surfaces are English-canonical with a complete Arabic table (${passed} assertions)`);
