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
assert(!translationsSource.includes("logger"), "the translations stub has no logger dependency");
assert(translationsSource.includes('export type Lang = "en";'), "the stub declares English as the only language");
setLanguage("en");
assert(getLanguage() === "en", "the stub reports English");
const english = await loadLocale("en");
assert(Object.keys(english).length > 400, "the English dictionary is loaded");
assert(JSON.stringify(await loadLocale("ar")) === "{}", "an unsupported locale resolves to an empty dictionary");
assert(
  t("addagentDerived", { from: "dev", to: "dev-gemini", model: "gemini" }).includes("dev-gemini"),
  "the stub resolves English keys with parameters",
);
assert(t("no-such-key") === "[missing: no-such-key]", "a missing key falls back to the English marker");
assert(recordTypeLabel("fix", "critical") === "Fix (critical)", "record labels stay English");

console.log(`PROOF PASS: feature index text and display surfaces are English-only (${passed} assertions)`);
