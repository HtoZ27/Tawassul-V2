import { t } from "../translations.ts";
import type { Lang } from "../translations.ts";

export function msg(key: string, lang: Lang, vars?: Record<string, string>): string {
  return t(`msg.${key}`, vars, lang);
}
