import { z } from "zod";

/** Typed, deliberately small contract for CompetitionEvent.rulesJson. */
export const teamCompositionRules = z.object({
  exactMaleCount: z.number().int().min(0).optional(),
  exactFemaleCount: z.number().int().min(0).optional(),
  minMaleCount: z.number().int().min(0).optional(),
  minFemaleCount: z.number().int().min(0).optional(),
  minGradeOneCount: z.number().int().min(0).optional(),
  minGradeOneRatio: z.number().int().min(0).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.exactMaleCount !== undefined && value.minMaleCount !== undefined && value.minMaleCount > value.exactMaleCount)
    ctx.addIssue({ code: "custom", path: ["minMaleCount"], message: "最低男生數不可超過男生精確數" });
  if (value.exactFemaleCount !== undefined && value.minFemaleCount !== undefined && value.minFemaleCount > value.exactFemaleCount)
    ctx.addIssue({ code: "custom", path: ["minFemaleCount"], message: "最低女生數不可超過女生精確數" });
});
export type TeamCompositionRules = z.infer<typeof teamCompositionRules>;

export function hasGenderCompositionRules(value: unknown) {
  const rules = parseTeamCompositionRules(value);
  return rules.exactMaleCount !== undefined || rules.exactFemaleCount !== undefined || rules.minMaleCount !== undefined || rules.minFemaleCount !== undefined;
}

type Participant = { gender: "MALE" | "FEMALE"; grade: "GRADE_1" | "GRADE_2" | "GRADE_3" };
export function parseTeamCompositionRules(value: unknown): TeamCompositionRules {
  if (value == null) return {};
  return teamCompositionRules.parse(value);
}

export function validateTeamComposition(event: { minTeamSize: number | null; maxTeamSize: number | null; rulesJson: unknown }, participants: Participant[]) {
  const rules = parseTeamCompositionRules(event.rulesJson);
  const male = participants.filter((p) => p.gender === "MALE").length;
  const female = participants.length - male;
  const grade1 = participants.filter((p) => p.grade === "GRADE_1").length;
  const checks = [
    { code: "TEAM_SIZE", passed: event.minTeamSize === null || participants.length >= event.minTeamSize, message: event.minTeamSize === null || participants.length >= event.minTeamSize ? `隊伍人數 ${participants.length} 人符合` : `隊伍至少需要 ${event.minTeamSize} 人` },
    { code: "TEAM_SIZE_MAX", passed: event.maxTeamSize === null || participants.length <= event.maxTeamSize, message: event.maxTeamSize === null || participants.length <= event.maxTeamSize ? `隊伍人數 ${participants.length} 人符合` : `隊伍最多 ${event.maxTeamSize} 人` },
    ...(rules.exactMaleCount === undefined ? [] : [{ code: "EXACT_MALE", passed: male === rules.exactMaleCount, message: `目前男生 ${male} 人，本項目需要男生 ${rules.exactMaleCount} 人` }]),
    ...(rules.exactFemaleCount === undefined ? [] : [{ code: "EXACT_FEMALE", passed: female === rules.exactFemaleCount, message: `目前女生 ${female} 人，本項目需要女生 ${rules.exactFemaleCount} 人` }]),
    ...(rules.minMaleCount === undefined ? [] : [{ code: "MIN_MALE", passed: male >= rules.minMaleCount, message: `目前男生 ${male} 人，本項目至少需要男生 ${rules.minMaleCount} 人` }]),
    ...(rules.minFemaleCount === undefined ? [] : [{ code: "MIN_FEMALE", passed: female >= rules.minFemaleCount, message: `目前女生 ${female} 人，本項目至少需要女生 ${rules.minFemaleCount} 人` }]),
    ...(rules.minGradeOneCount === undefined ? [] : [{ code: "MIN_GRADE_1", passed: grade1 >= rules.minGradeOneCount, message: `高一選手目前 ${grade1} 人，本項目至少需要 ${rules.minGradeOneCount} 人` }]),
    ...(rules.minGradeOneRatio === undefined ? [] : [{ code: "MIN_GRADE_1_RATIO", passed: participants.length > 0 && grade1 * 100 >= participants.length * rules.minGradeOneRatio, message: `高一選手比例目前 ${participants.length ? Math.floor(grade1 * 100 / participants.length) : 0}%，本項目至少需要 ${rules.minGradeOneRatio}%` }]),
  ];
  return { valid: checks.every((check) => check.passed), checks, blockers: checks.filter((check) => !check.passed).map((check) => check.message), counts: { total: participants.length, male, female, grade1 } };
}
