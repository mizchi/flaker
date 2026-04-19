export type GateName = "iteration" | "merge" | "release";

export const VALID_GATE_NAMES: readonly GateName[] = ["iteration", "merge", "release"] as const;

const GATE_TO_PROFILE: Record<GateName, string> = {
  iteration: "local",
  merge: "ci",
  release: "scheduled",
};

const PROFILE_TO_GATE = new Map<string, GateName>(
  Object.entries(GATE_TO_PROFILE).map(([gate, profile]) => [profile, gate as GateName]),
);

export function normalizeGateName(name: string): GateName | undefined {
  const normalized = name.trim().toLowerCase();
  if (normalized === "iteration" || normalized === "merge" || normalized === "release") {
    return normalized;
  }
  return undefined;
}

export function profileNameFromGateName(gateName: string): string {
  const gate = normalizeGateName(gateName);
  if (!gate) {
    throw new Error(
      `Unknown gate '${gateName}'. Expected one of: iteration, merge, release.`,
    );
  }
  return GATE_TO_PROFILE[gate];
}

export function gateNameFromProfileName(profileName: string): GateName | undefined {
  return PROFILE_TO_GATE.get(profileName);
}
