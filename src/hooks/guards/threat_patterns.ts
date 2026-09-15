const MAX_SCAN_CHARS = 10_000;



const HIDDEN_CODEPOINTS: number[] = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061,
  0x2062, 0x2063, 0x2064, 0xfeff, 0x00ad, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e, 0x202f, 0x205f, 0x3000,
  0x3164, 0xffa0,
];

const HIDDEN_SET = new Set(HIDDEN_CODEPOINTS);

export interface ThreatMatch {
  category: string;
  pattern: string;
  match: string;
  
  severity: "info" | "warn" | "critical";
}

function normalizeText(text: string): string {
  return text.normalize("NFKC");
}

function detectHiddenUnicode(text: string): ThreatMatch[] {
  const found = new Set<string>();
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp !== undefined && HIDDEN_SET.has(cp)) {
      found.add(`U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
    }
  }
  if (found.size === 0) return [];
  return [
    {
      category: "unicode_hidden",
      pattern: "hidden_unicode_chars",
      match: [...found].join(" ").slice(0, 100),
      severity: "warn",
    },
  ];
}

const SYSTEM_OVERRIDE_PATTERNS: [RegExp, string][] = [
  [/(?:\bignore\s+(?:all\s+)?(?:previous|prior|above|former)\s+instructions?\b)/gi, "ignore_previous"],
  [
    /(?:\byou\s+are\s+(?:now|henceforth|no longer)\s+(?!an?\s+(?:ai|assistant|model|agent|bot)))/gi,
    "identity_override",
  ],
  [
    /(?:\bforget\s+(?:all\s+)?(?:previous|prior|your|the)\s+(?:instructions?|rules?|guidelines?|prompt|persona))/gi,
    "forget_instructions",
  ],
  [/(?:\bnew\s+(?:rule|instruction|directive|command|order|mode)\b)/gi, "new_instruction_directive"],
];

const CREDENTIAL_PATTERNS: [RegExp, string][] = [
  [
    /\b(?:reveal|show|output|display|leak|give|tell)\s+(?:me\s+)?(?:your|the|my|our)?\s*(?:api[-\s]?key|password|secret|token|credential|auth|private\s*key)\b/gi,
    "credential_request",
  ],
  [
    /\b(?:output|print|return|display|show|write)\s+(?:your|the|entire|full|complete|system)?\s*(?:system\s+)?(?:prompt|instructions?|context|persona|configuration)\b/gi,
    "system_prompt_leak",
  ],
  [
    /\b(?:reveal|show|tell|leak|share|give)\s+(?:me\s+)?(?:internal|secret|hidden|private|confidential)\s+(?:data|info|information|details|code|config)\b/gi,
    "internal_data_leak",
  ],
  [
    /\b(?:what'?s?\s+(?:your|the)\s+(?:api\s*key|password|token|secret)|how\s+(?:do|can)\s+(?:i\s+)?(?:get|find)\s+(?:your|the)\s+api)/gi,
    "credential_phishing",
  ],
];

const REVERSE_PSYCHOLOGY_PATTERNS: [RegExp, string][] = [
  [/\byou\s+(?:must|have\s+to|are\s+required\s+to|need\s+to|should)\s+disobey\b/gi, "disobey_command"],
  [
    /\byou\s+(?:must|have\s+to|are\s+required\s+to)\s+break\s+(?:the\s+)?(?:rules?|guidelines?|policies?|protocols?)\b/gi,
    "break_rules_command",
  ],
  [
    /\b(?:this\s+is\s+(?:a\s+)?(?:test|challenge|exercise|experiment)|for\s+(?:testing|educational)\s+(?:purposes?|reasons?))\s+.*?\b(?:disobey|ignore|break|violate|bypass)\b/gis,
    "test_disguise_bypass",
  ],
];

const JAILBREAK_PATTERNS: [RegExp, string][] = [
  [
    /\b(?:DAN|do\s+anything\s+now|jail(?:ed|break)|hypothetical\s+scenario|safe\s+mode\s+bypass|developer\s+mode\s+output)\b/gi,
    "jailbreak_keyword",
  ],
  [
    /\byou\s+(?:are\s+)?(?:now\s+)?free\s+(?:from\s+)?(?:all\s+)?(?:restrictions?|limitations?|constraints?|bounds?|rules?)\b/gi,
    "freedom_claim",
  ],
  [
    /\b(?:unfiltered|uncensored|no\s+(?:filter|limits|censorship|restrictions|boundaries))\s+(?:mode|version|response|output|chat|ai)\b/gi,
    "unfiltered_mode_request",
  ],
  [
    /(?:(?:pretend|act\s+as\s+if|roleplay|role[-\s]?play)\s+).{0,100}\b(?:no\s+(?:rules?|limits|restrictions|boundaries|filter)|unlimited|without\s+(?:restrictions?|safeguards?))\b/gis,
    "roleplay_restriction_evasion",
  ],
];

const ALL_THREAT_PATTERNS: [RegExp, string, string][] = [
  ...SYSTEM_OVERRIDE_PATTERNS.map(([re, id]) => [re, "system_override", id] as [RegExp, string, string]),
  ...CREDENTIAL_PATTERNS.map(([re, id]) => [re, "credential_theft", id] as [RegExp, string, string]),
  ...REVERSE_PSYCHOLOGY_PATTERNS.map(([re, id]) => [re, "reverse_psychology", id] as [RegExp, string, string]),
  ...JAILBREAK_PATTERNS.map(([re, id]) => [re, "jailbreak", id] as [RegExp, string, string]),
];

export function truncate(text: string): string {
  return text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text;
}

function scanWindows(text: string, cb: (window: string) => void): void {
  if (text.length <= MAX_SCAN_CHARS) {
    cb(text);
    return;
  }
  const overlap = 1000;
  const stride = MAX_SCAN_CHARS - overlap;
  for (let offset = 0; offset < text.length; offset += stride) {
    cb(text.slice(offset, offset + MAX_SCAN_CHARS));
    if (offset + MAX_SCAN_CHARS >= text.length) break;
  }
}

const TEXT_THREAT_SEVERITY: Record<string, "info" | "warn" | "critical"> = {
  system_override: "warn",
  credential_theft: "critical",
  reverse_psychology: "warn",
  jailbreak: "warn",
  unicode_hidden: "warn",
};

export function scanText(text: string): ThreatMatch[] {
  const results: ThreatMatch[] = [];
  const hidden = detectHiddenUnicode(text);
  results.push(...hidden);
  const normalized = normalizeText(text);
  const seen = new Set<string>();
  scanWindows(normalized, (window) => {
    for (const [re, category, pattern] of ALL_THREAT_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(window);
      if (m && !seen.has(pattern)) {
        seen.add(pattern);
        results.push({
          category,
          pattern,
          match: m[0].slice(0, 100),
          severity: TEXT_THREAT_SEVERITY[category] ?? "warn",
        });
      }
    }
  });
  return results;
}

const OUTPUT_INJECTION_PATTERNS: [RegExp, string][] = [
  
  
  
  [/<\/\s*(?:prev_agent_output|envelope)\s*>/i, "envelope_close_tag"],
  [/(?:<script[\s>]|javascript:\s*|on\w+\s*=\s*["']?|data:\s*text\/html|vbscript:\s*)/i, "xss_vector"],
  
  
  
  
  
  
  [/(?:\beval\s*\(|\bexec\s*\(|\bsystem\s*\(|\brequire\s*\(|\bimport\s*\(|\bfetch\s*\()/i, "code_execution"],
  [/\b(?:rm\s+-rf\s+\/|format\s+[a-z]:\s*\/fs:|del\s+\/f\s+\/s\s+[a-z]:\\)/i, "destructive_command"],
  [
    /(?:\\\\\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}|https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/(?!.*\.(?:com|org|net|io|dev|app|ai)))/i,
    "raw_ip_exfiltration",
  ],
  
  
  
  
  
  [
    /<(?:prev_agent_output|envelope)(?:\s[^>]*)?>[\s\S]*?<\/(?:prev_agent_output|envelope)>/i,
    "prev_agent_output_envelope",
  ],
];

export function scanToolOutput(text: string): ThreatMatch[] {
  const results: ThreatMatch[] = [];
  const hidden = detectHiddenUnicode(text);
  for (const h of hidden) {
    h.severity = "critical";
  }
  results.push(...hidden);
  const normalized = normalizeText(text);
  const seenOutput = new Set<string>();
  const seenGeneral = new Set<string>();
  scanWindows(normalized, (window) => {
    for (const [re, id] of OUTPUT_INJECTION_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(window);
      if (m && !seenOutput.has(id)) {
        seenOutput.add(id);
        const isCritical =
          id === "destructive_command" ||
          id === "code_execution" ||
          id === "raw_ip_exfiltration" ||
          id === "prev_agent_output_envelope";
        results.push({
          category: "tool_output_injection",
          pattern: id,
          match: m[0].slice(0, 100),
          severity: isCritical ? "critical" : "warn",
        });
      }
    }
    for (const [re, category, pattern] of ALL_THREAT_PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(window);
      if (m && !seenGeneral.has(pattern)) {
        seenGeneral.add(pattern);
        results.push({
          category,
          pattern,
          match: m[0].slice(0, 100),
          severity: TEXT_THREAT_SEVERITY[category] ?? "warn",
        });
      }
    }
  });
  return results;
}

export {
  SYSTEM_OVERRIDE_PATTERNS,
  CREDENTIAL_PATTERNS,
  REVERSE_PSYCHOLOGY_PATTERNS,
  JAILBREAK_PATTERNS,
  ALL_THREAT_PATTERNS,
  MAX_SCAN_CHARS,
};
