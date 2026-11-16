


export const TOKENS_PER_CHAR_COMPRESS = 0.25;


export const PRIORITY_TOKEN_FACTOR = 0.4;


export const HANDOFF_CHECKPOINT_FACTOR = 0.3;


export const RECORD_BASE_TOKENS = 100;


export function estimateTokensByFactor(chars: number, factor: number): number {
  return Math.ceil(chars * factor);
}


export function estimateTokensByScript(text: string): number {
  let arabic = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    
    if (
      (cp >= 0x0600 && cp <= 0x06ff) ||
      (cp >= 0x0750 && cp <= 0x077f) ||
      (cp >= 0x08a0 && cp <= 0x08ff) ||
      (cp >= 0xfb50 && cp <= 0xfdff) ||
      (cp >= 0xfe70 && cp <= 0xfeff)
    )
      arabic++;
  }
  const latin = text.length - arabic;
  return Math.ceil(arabic * 0.5 + latin * 0.25);
}
