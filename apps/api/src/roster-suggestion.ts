import { z } from "zod";
import { hasGenderCompositionRules, validateTeamComposition } from "./team-rules.js";

export type SuggestParticipant = { id: string; gender: "MALE" | "FEMALE"; grade: "GRADE_1" | "GRADE_2" | "GRADE_3"; sourceOrganizationId: string };
export type SuggestTeam = { id: string; ordinal: number; participantIds: string[] };
export type SuggestInput = { event: { minTeamSize: number | null; maxTeamSize: number | null; genderRule: "MALE" | "FEMALE" | null; allowedGrades: string[]; rulesJson: unknown }; teams: SuggestTeam[]; participants: SuggestParticipant[]; claimedParticipantIds: string[]; allowedSourceOrganizationIds: string[] };
export const suggestionRequest = z.object({ entryId: z.string().uuid() }).strict();

/** Deterministic, side-effect-free greedy allocator. Existing assignments are preserved. */
export function suggestRoster(input: SuggestInput) {
  const claimed = new Set(input.claimedParticipantIds);
  const used = new Set(input.teams.flatMap((team) => team.participantIds));
  const available = input.participants.filter((p) => !claimed.has(p.id) && !used.has(p.id) && input.allowedSourceOrganizationIds.includes(p.sourceOrganizationId) && (!hasGenderCompositionRules(input.event.rulesJson) && input.event.genderRule ? p.gender === input.event.genderRule : true) && (!input.event.allowedGrades.length || input.event.allowedGrades.includes(p.grade))).sort((a, b) => a.id.localeCompare(b.id));
  const assignments = input.teams.map((team) => ({ teamId: team.id, participantIds: [...team.participantIds] }));
  const blockers: string[] = [];
  for (const team of input.teams) {
    const target = input.event.maxTeamSize ?? input.event.minTeamSize ?? 0;
    const output = assignments.find((item) => item.teamId === team.id)!;
    while (output.participantIds.length < target && available.length) output.participantIds.push(available.shift()!.id);
    const selected = input.participants.filter((participant) => output.participantIds.includes(participant.id));
    const result = validateTeamComposition(input.event, selected);
    if (!result.valid) blockers.push(`第 ${team.ordinal} 隊：${result.blockers.join("；")}`);
  }
  if (!input.teams.length) blockers.push("請先建立 A／B 隊");
  // Unused eligible participants are valid: they may compete in another
  // event or rest during this event. Only unmet hard team rules are blockers.
  return { assignments, preservedParticipantIds: [...used], blockers, warnings: [] as string[], deterministic: true };
}
