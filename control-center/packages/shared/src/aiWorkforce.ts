import { z } from "zod";

export const aiProviderIds = ["openai", "anthropic", "gemini", "openrouter", "mock"] as const;
export const aiProviderIdSchema = z.enum(aiProviderIds);
export type AiProviderId = z.infer<typeof aiProviderIdSchema>;

export const aiWorkforceRoleIds = [
  "operations_analyst",
  "incident_reviewer",
  "release_readiness_reviewer",
  "security_reviewer"
] as const;
export const aiWorkforceRoleIdSchema = z.enum(aiWorkforceRoleIds);
export type AiWorkforceRoleId = z.infer<typeof aiWorkforceRoleIdSchema>;

export type AiWorkforceRole = {
  id: AiWorkforceRoleId;
  label: string;
  description: string;
  systemInstruction: string;
  suggestedQuestions: string[];
  allowedScopeTypes: Array<"server" | "application">;
  readOnly: true;
};

export const aiWorkforceRoles: AiWorkforceRole[] = [
  {
    id: "operations_analyst",
    label: "Operations analyst",
    description: "Explains current health, telemetry, service, and deployment evidence.",
    systemInstruction: "Focus on current operational health, causal evidence, and low-risk diagnostics.",
    suggestedQuestions: [
      "Explain the current health evidence.",
      "What changed before the latest failure?",
      "Which low-risk diagnostic should I run next?"
    ],
    allowedScopeTypes: ["server", "application"],
    readOnly: true
  },
  {
    id: "incident_reviewer",
    label: "Incident reviewer",
    description: "Correlates timelines, failures, deployments, and similar incidents.",
    systemInstruction: "Focus on incident chronology, correlated changes, alternative causes, and evidence gaps.",
    suggestedQuestions: [
      "Build an evidence-backed incident timeline.",
      "Is this similar to a previous incident?",
      "Which alternative cause remains plausible?"
    ],
    allowedScopeTypes: ["server", "application"],
    readOnly: true
  },
  {
    id: "release_readiness_reviewer",
    label: "Release readiness reviewer",
    description: "Reviews health, rollback, deployment, and validation evidence without publishing.",
    systemInstruction: "Focus on release-readiness gates, rollback evidence, unresolved risks, and missing validation. Never authorize or publish a release.",
    suggestedQuestions: [
      "Which release-readiness gates currently pass?",
      "What evidence is still missing?",
      "Is the rollback evidence sufficient?"
    ],
    allowedScopeTypes: ["application"],
    readOnly: true
  },
  {
    id: "security_reviewer",
    label: "Security reviewer",
    description: "Identifies bounded security signals and recommends manual investigation.",
    systemInstruction: "Focus on security-relevant evidence, trust boundaries, suspicious changes, and manual verification. Never request, reveal, rotate, or use credentials.",
    suggestedQuestions: [
      "Which security signals need review?",
      "What trust boundary is most exposed?",
      "Which manual verification is lowest risk?"
    ],
    allowedScopeTypes: ["server", "application"],
    readOnly: true
  }
];

export function aiWorkforceRole(roleId: AiWorkforceRoleId) {
  return aiWorkforceRoles.find((role) => role.id === roleId)!;
}
