




export const PRIVACY_REDACTED = "PRIVACY_REDACTED";


const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /(?<![A-Za-z0-9])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9])/g,
];

const PRIVATE_TAG = /<private>([\s\S]*?)<\/private>/gi;
const PRIVATE_TAG_OPEN = /<private>/i; 

export interface PrivacyScanResult {
  isPrivate: boolean;
  redacted: string;
  hits: string[];
}

export class PrivacyGuard {
  private readonly paranoid: boolean;

  constructor(cfg: { paranoid?: boolean } = {}) {
    this.paranoid = cfg.paranoid ?? false;
  }

  
  redact(text: string): PrivacyScanResult {
    if (!text) return { isPrivate: false, redacted: text, hits: [] };
    const hits: string[] = [];
    let redacted = text;

    
    redacted = redacted.replace(PRIVATE_TAG, (_m, inner: string) => {
      hits.push("private-tag");
      return `<private>[REDACTED:${inner.length} chars]</private>`;
    });

    
    if (PRIVATE_TAG_OPEN.test(redacted)) {
      hits.push("private-tag-ambiguous");
      redacted = redacted.replace(/<private>([\s\S]*)$/i, "<private>[REDACTED:ambiguous]</private>");
    }

    
    for (const re of SECRET_PATTERNS) {
      redacted = redacted.replace(re, (m) => {
        hits.push("secret-pattern");
        return `[REDACTED:${m.length} chars]`;
      });
    }

    
    if (this.paranoid) {
      redacted = redacted.replace(
        /(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi,
        (m) => {
          hits.push("paranoid-credential");
          return m.replace(/\S+$/, "[REDACTED]");
        },
      );
    }

    return { isPrivate: hits.length > 0, redacted, hits: [...new Set(hits)] };
  }

  scan(text: string): boolean {
    return this.redact(text).isPrivate;
  }
}
