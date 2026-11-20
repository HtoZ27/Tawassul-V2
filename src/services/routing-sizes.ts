export const SIZE_KEYWORDS: Record<string, "small" | "medium" | "complex"> = {
  "simple": "small",
  "change": "small", "rename": "small", "typo": "small", "color": "small",
  "basic": "small",
  "quick": "small", "preliminary": "small",
  "function": "small",
  "feature": "medium", "add": "medium",
  "implement": "medium", "improve": "medium",
  "improvement": "medium", "refactor": "medium", "redesign": "medium",
  "restructure": "medium",
  "update": "medium", "upgrade": "medium",
  "complete": "complex",
  "system": "complex",
  "architecture": "complex",
  "integrate": "complex",
  "comprehensive": "complex",
  "thorough": "complex", "detailed": "complex",
  "complex": "complex",
  "full": "complex",
  "atomic": "complex", "radical": "complex",
  "root": "complex",
  "project": "complex",
};

export const COMPLEX_PHRASES_REGEX = /(from|in)\s?(all|every)\s?(sides|angles|directions|aspects|dimensions)(\s?(and|or)\s?(sides|angles|directions|aspects|dimensions))?/i;

export const DETAILED_PHRASES_REGEX = /(from\s?a\s?to\s?z|in\sfull\sdetail|step\sby\sstep|on\sall\slevels|in\s(comprehensive|thorough|detailed)\sform)/i;

export const ALL_OF_PLURAL_REGEX = /all\s+(?:of\s+)?the\s+[\p{L}]{4,}(?=\s|$|[.,])/iu;

export const SAFETY_PATTERNS = [
  /\b(api[_-]?key|api key|secret|password|passwd)\b/i,
  /delete\s+(database|table|collection)/i,
  /drop\s+(database|table|collection)/i,
  /rm\s+-rf/i,
];
