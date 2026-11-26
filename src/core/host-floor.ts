export const HOST_FLOOR = "2.3.0";
export const HOST_AUDITED = "2.4.1";
export const HOST_AUDITED_MAJOR = 2;

export type HostVersionParts = [number, number, number];

export function parseHostVersion(version: string | undefined): HostVersionParts | undefined {
  if (typeof version !== "string") return undefined;
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareHostVersions(left: string, right: string): number {
  const a = parseHostVersion(left);
  const b = parseHostVersion(right);
  if (!a || !b) return left.localeCompare(right);
  for (let index = 0; index < 3; index += 1) {
    const leftPart = a[index] ?? 0;
    const rightPart = b[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return 0;
}

export function isBelowHostFloor(version: string | undefined): boolean {
  if (!parseHostVersion(version)) return false;
  return compareHostVersions(version as string, HOST_FLOOR) < 0;
}

export function hostFloorProblem(version: string | undefined): string | undefined {
  if (!parseHostVersion(version)) return undefined;
  if (!isBelowHostFloor(version)) return undefined;
  return `the host reports v${version}, below the supported floor v${HOST_FLOOR}`;
}
