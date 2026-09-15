export const ESCAPE_RE = /[<>&"'[\]]/g;
const ESCAPE_MAP: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&#39;",
  "[": "&#91;",
  "]": "&#93;",
};

export function escapeGoalText(text: string): string {
  return text.replace(ESCAPE_RE, (ch) => ESCAPE_MAP[ch] ?? ch);
}

const STRUCTURAL_TAGS = {
  goal: (content: string) => `<goal>${content}</goal>`,
  evidence: (content: string) => `<evidence>${content}</evidence>`,
  task: (content: string) => `<task>${content}</task>`,
  context: (content: string) => `<context>${content}</context>`,
  result: (content: string) => `<result>${content}</result>`,
  handoff: (content: string) => `<handoff>${content}</handoff>`,
} as const;

export { STRUCTURAL_TAGS };

const ENV_TAG = "envelope"; 


export function wrapUntrusted(content: string): string {
  
  
  
  
  return `<${ENV_TAG} untrusted="true">${escapeGoalText(content)}</${ENV_TAG}>`;
}


export const UNTRUSTED_TAGS = {
  ...STRUCTURAL_TAGS,
  untrusted: (content: string) => wrapUntrusted(content), // wrapUntrusted escapes internally now
} as const;

export function buildSafePrompt(parts: Record<string, string>): string {
  return Object.entries(parts)
    .map(([tag, content]) => {
      const builder = UNTRUSTED_TAGS[tag as keyof typeof UNTRUSTED_TAGS];
      
      
      
      const prepared = tag === "untrusted" ? content : escapeGoalText(content);
      return builder?.(prepared) ?? content;
    })
    .join("\n");
}
