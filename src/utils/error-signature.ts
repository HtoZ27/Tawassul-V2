
export function generateSignature(rawError: string): string {
  
  let clean = rawError.replace(/(\/[^:\s]+)/g, "");

  
  clean = clean.replace(/\d+:\d+/g, "");

  
  clean = clean.replace(/0x[0-9a-fA-F]+/g, "");

  
  clean = clean.replace(/\s+/g, " ").trim();

  
  clean = clean.toLowerCase();

  
  return clean.substring(0, 200);
}
