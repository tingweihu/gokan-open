import { parseTeamCompositionRules, validateTeamComposition } from "./team-rules.js";

export type OptimizerParticipant = {
  id: string;
  name?: string;
  gender: "MALE" | "FEMALE";
  grade: "GRADE_1" | "GRADE_2" | "GRADE_3";
  sourceOrganizationId: string;
  active?: boolean;
  rowVersion?: number;
};

export type OptimizerEvent = {
  id: string;
  name: string;
  displayOrder?: number;
  enabled?: boolean;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  maxTeamsPerRegistration: number;
  teamCapacity?: number | null;
  admittedTeamCount?: number;
  allowClub?: boolean;
  allowLeague?: boolean;
  genderRule: "MALE" | "FEMALE" | null;
  allowedGrades: string[];
  rulesJson: unknown;
};

export type OptimizerTeam = {
  id: string;
  ordinal: number;
  admissionStatus?: "PENDING" | "ADMITTED" | "REJECTED";
  participantIds: string[];
  rowVersion?: number;
  virtual?: boolean;
};

export type OptimizerEntry = {
  id: string;
  eventId: string;
  active?: boolean;
  rowVersion?: number;
  event: OptimizerEvent;
  teams: OptimizerTeam[];
};

export type OptimizerClaim = { participantId: string; eventId: string; registrationId: string };
export type OptimizerWindow = { id?: string; eventId: string; startAt: Date | string; endAt: Date | string; label?: string | null; venue?: string | null };

export type RegistrationOptimizerInput = {
  registrationId: string;
  unitKind: "CLUB" | "LEAGUE";
  allowedSourceOrganizationIds: string[];
  entries: OptimizerEntry[];
  participants: OptimizerParticipant[];
  claims: OptimizerClaim[];
  windows: OptimizerWindow[];
  maxSearchNodes?: number;
};

export type OptimizerTeamAssignment = {
  teamId: string;
  ordinal: number;
  admissionStatus: "PENDING" | "ADMITTED";
  participantIds: string[];
  addedParticipantIds: string[];
  lockedParticipantIds: string[];
  complete: boolean;
  willCreateTeamA: boolean;
};

export type OptimizerEventResult = {
  entryId: string;
  eventId: string;
  eventName: string;
  requiredParticipants: number;
  assignedParticipants: number;
  complete: boolean;
  willCreateTeamA: boolean;
  blockers: string[];
  lockedParticipantIds: string[];
  suggestedParticipantIds: string[];
  teamAssignments: OptimizerTeamAssignment[];
  windows: OptimizerWindow[];
};

export type OptimizerTimeSlice = {
  startAt: string;
  endAt: string;
  eventIds: string[];
  events: { eventId: string; eventName: string; participantCount: number }[];
  simultaneousDemand: number;
  simultaneousAssigned: number;
  restingParticipantIds: string[];
};

export type RegistrationOptimizerResult = {
  deterministic: true;
  outcome: "COMPLETE" | "NO_FEASIBLE_SOLUTION" | "OPTIMIZATION_LIMIT_REACHED";
  registrationId: string;
  assignments: { teamId: string; participantIds: string[] }[];
  events: OptimizerEventResult[];
  blockers: string[];
  warnings: string[];
  activeParticipantCount: number;
  assignedParticipantCount: number;
  idleParticipantIds: string[];
  preservedParticipantIds: string[];
  timeSlices: OptimizerTimeSlice[];
  search: { nodesVisited: number; nodeBudget: number };
};

type State = {
  assignments: Map<string, string[]>;
  eventParticipants: Map<string, Set<string>>;
  participantEvents: Map<string, Set<string>>;
  workload: Map<string, number>;
};
type Task = { entry: OptimizerEntry; team: OptimizerTeam; required: number; maximum: number };
type Budget = { nodes: number; maximum: number; exhausted: boolean };

function date(value: Date | string) { return value instanceof Date ? value : new Date(value); }
export function windowsOverlap(left: OptimizerWindow, right: OptimizerWindow) { return date(left.startAt) < date(right.endAt) && date(left.endAt) > date(right.startAt); }
export function participantMatchesEvent(event: OptimizerEvent, participant: OptimizerParticipant) {
  return (!event.genderRule || participant.gender === event.genderRule)
    && (!event.allowedGrades.length || event.allowedGrades.includes(participant.grade));
}

export function requiredTeamSize(event: OptimizerEvent) {
  const rules = parseTeamCompositionRules(event.rulesJson);
  let required = event.minTeamSize ?? 0;
  if (rules.exactMaleCount !== undefined) required = Math.max(required, rules.exactMaleCount);
  if (rules.exactFemaleCount !== undefined) required = Math.max(required, rules.exactFemaleCount);
  if (rules.exactMaleCount !== undefined && rules.exactFemaleCount !== undefined) required = Math.max(required, rules.exactMaleCount + rules.exactFemaleCount);
  if (rules.minMaleCount !== undefined && rules.minFemaleCount !== undefined) required = Math.max(required, rules.minMaleCount + rules.minFemaleCount);
  if (rules.minMaleCount !== undefined) required = Math.max(required, rules.minMaleCount);
  if (rules.minFemaleCount !== undefined) required = Math.max(required, rules.minFemaleCount);
  if (rules.minGradeOneCount !== undefined) required = Math.max(required, rules.minGradeOneCount);
  return required;
}

function cloneState(state: State): State {
  return {
    assignments: new Map([...state.assignments].map(([id, ids]) => [id, [...ids]])),
    eventParticipants: new Map([...state.eventParticipants].map(([id, ids]) => [id, new Set(ids)])),
    participantEvents: new Map([...state.participantEvents].map(([id, ids]) => [id, new Set(ids)])),
    workload: new Map(state.workload),
  };
}

function addAssignment(state: State, teamId: string, eventId: string, participantId: string) {
  const ids = state.assignments.get(teamId) ?? [];
  if (!ids.includes(participantId)) ids.push(participantId);
  state.assignments.set(teamId, ids);
  const eventParticipants = state.eventParticipants.get(eventId) ?? new Set<string>();
  eventParticipants.add(participantId);
  state.eventParticipants.set(eventId, eventParticipants);
  const participantEvents = state.participantEvents.get(participantId) ?? new Set<string>();
  const before = participantEvents.size;
  participantEvents.add(eventId);
  state.participantEvents.set(participantId, participantEvents);
  if (participantEvents.size > before) state.workload.set(participantId, (state.workload.get(participantId) ?? 0) + 1);
}

function tick(budget: Budget) {
  budget.nodes++;
  if (budget.nodes > budget.maximum) { budget.exhausted = true; return false; }
  return true;
}

function eventOrder(left: OptimizerEntry, right: OptimizerEntry) {
  return (left.event.displayOrder ?? 0) - (right.event.displayOrder ?? 0) || left.eventId.localeCompare(right.eventId) || left.id.localeCompare(right.id);
}

function virtualTeam(entry: OptimizerEntry): OptimizerTeam {
  const capacity = entry.event.teamCapacity;
  const admitted = entry.event.admittedTeamCount ?? 0;
  return {
    id: `virtual-a:${entry.id}`,
    ordinal: 1,
    admissionStatus: capacity === null || capacity === undefined || admitted < capacity ? "ADMITTED" : "PENDING",
    participantIds: [],
    virtual: true,
  };
}

function normalizedEntries(input: RegistrationOptimizerInput) {
  return input.entries.filter((entry) => entry.active !== false).sort(eventOrder).map((entry) => {
    const teams = entry.teams.filter((team) => team.admissionStatus !== "REJECTED");
    if (!teams.some((team) => team.ordinal === 1)) teams.push(virtualTeam(entry));
    return { ...entry, teams: teams.sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id)) };
  });
}

function ruleSpecificity(event: OptimizerEvent) {
  const rules = parseTeamCompositionRules(event.rulesJson);
  return Number(Boolean(event.genderRule)) + Number(event.allowedGrades.length > 0)
    + Object.values(rules).filter((value) => value !== undefined).length;
}

function helps(event: OptimizerEvent, selected: OptimizerParticipant[], candidate: OptimizerParticipant) {
  const rules = parseTeamCompositionRules(event.rulesJson);
  const male = selected.filter((item) => item.gender === "MALE").length;
  const female = selected.length - male;
  const gradeOne = selected.filter((item) => item.grade === "GRADE_1").length;
  let score = 0;
  if (rules.exactMaleCount !== undefined && male < rules.exactMaleCount && candidate.gender === "MALE") score += 16;
  if (rules.exactFemaleCount !== undefined && female < rules.exactFemaleCount && candidate.gender === "FEMALE") score += 16;
  if (rules.minMaleCount !== undefined && male < rules.minMaleCount && candidate.gender === "MALE") score += 8;
  if (rules.minFemaleCount !== undefined && female < rules.minFemaleCount && candidate.gender === "FEMALE") score += 8;
  if (rules.minGradeOneCount !== undefined && gradeOne < rules.minGradeOneCount && candidate.grade === "GRADE_1") score += 6;
  return score;
}

function conflictsWithState(participantId: string, eventId: string, state: State, windowsByEvent: Map<string, OptimizerWindow[]>) {
  const requested = windowsByEvent.get(eventId) ?? [];
  return [...(state.participantEvents.get(participantId) ?? [])].some((assignedEventId) => assignedEventId !== eventId
    && requested.some((left) => (windowsByEvent.get(assignedEventId) ?? []).some((right) => windowsOverlap(left, right))));
}

function solveTasks(
  tasks: Task[],
  initial: State,
  participants: Map<string, OptimizerParticipant>,
  foreignClaims: Map<string, Set<string>>,
  windowsByEvent: Map<string, OptimizerWindow[]>,
  participantScarcity: Map<string, number>,
  budget: Budget,
) {
  const solve = (index: number, state: State): State | null => {
    if (!tick(budget)) return null;
    if (index >= tasks.length) return state;
    const task = tasks[index]!;
    const lockedIds = state.assignments.get(task.team.id) ?? [];
    const lockedParticipants = lockedIds.map((id) => participants.get(id)).filter((item): item is OptimizerParticipant => Boolean(item));
    if (lockedIds.length >= task.required && validateTeamComposition(task.entry.event, lockedParticipants).valid)
      return solve(index + 1, state);
    const currentEventParticipants = state.eventParticipants.get(task.entry.eventId) ?? new Set<string>();
    const candidates = [...participants.values()]
      .filter((participant) => !currentEventParticipants.has(participant.id))
      .filter((participant) => !(foreignClaims.get(task.entry.eventId)?.has(participant.id)))
      .filter((participant) => participantMatchesEvent(task.entry.event, participant))
      .filter((participant) => !conflictsWithState(participant.id, task.entry.eventId, state, windowsByEvent))
      .sort((left, right) => {
        const help = helps(task.entry.event, lockedParticipants, right) - helps(task.entry.event, lockedParticipants, left);
        const scarcity = (participantScarcity.get(left.id) ?? 0) - (participantScarcity.get(right.id) ?? 0);
        const workload = (state.workload.get(left.id) ?? 0) - (state.workload.get(right.id) ?? 0);
        return help || scarcity || workload || left.id.localeCompare(right.id);
      });

    for (let target = Math.max(task.required, lockedIds.length); target <= task.maximum; target++) {
      const needed = target - lockedIds.length;
      const selected: OptimizerParticipant[] = [];
      let solved: State | null = null;
      const combinations = (start: number) => {
        if (solved || budget.exhausted || !tick(budget)) return;
        if (selected.length === needed) {
          if (!validateTeamComposition(task.entry.event, [...lockedParticipants, ...selected]).valid) return;
          const next = cloneState(state);
          for (const participant of selected) addAssignment(next, task.team.id, task.entry.eventId, participant.id);
          solved = solve(index + 1, next);
          return;
        }
        const remaining = needed - selected.length;
        for (let candidateIndex = start; candidateIndex <= candidates.length - remaining; candidateIndex++) {
          selected.push(candidates[candidateIndex]!);
          combinations(candidateIndex + 1);
          selected.pop();
          if (solved || budget.exhausted) return;
        }
      };
      combinations(0);
      if (solved) return solved;
      if (budget.exhausted) return null;
    }
    return null;
  };
  return solve(0, initial);
}

function timeSlices(entries: OptimizerEntry[], state: State, participants: OptimizerParticipant[], windows: OptimizerWindow[]): OptimizerTimeSlice[] {
  const boundaries = [...new Set(windows.flatMap((window) => [date(window.startAt).getTime(), date(window.endAt).getTime()]))].sort((left, right) => left - right);
  return boundaries.slice(0, -1).flatMap((start, index) => {
    const end = boundaries[index + 1]!;
    if (start >= end) return [];
    const active = entries.filter((entry) => windows.some((window) => window.eventId === entry.eventId && date(window.startAt).getTime() <= start && date(window.endAt).getTime() >= end));
    if (!active.length) return [];
    const assigned = new Set(active.flatMap((entry) => [...(state.eventParticipants.get(entry.eventId) ?? [])]));
    const eventSummary = active.map((entry) => ({ eventId: entry.eventId, eventName: entry.event.name, participantCount: state.eventParticipants.get(entry.eventId)?.size ?? 0 }));
    return [{ startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), eventIds: active.map((entry) => entry.eventId), events: eventSummary, simultaneousDemand: eventSummary.reduce((sum, event) => sum + event.participantCount, 0), simultaneousAssigned: assigned.size, restingParticipantIds: participants.filter((participant) => !assigned.has(participant.id)).map((participant) => participant.id) }];
  });
}

export function optimizeRegistration(input: RegistrationOptimizerInput): RegistrationOptimizerResult {
  const nodeBudget = Math.max(1, Math.min(input.maxSearchNodes ?? 100_000, 1_000_000));
  const budget: Budget = { nodes: 0, maximum: nodeBudget, exhausted: false };
  const allowedSources = new Set(input.allowedSourceOrganizationIds);
  const participants = new Map(input.participants
    .filter((participant) => participant.active !== false && allowedSources.has(participant.sourceOrganizationId))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((participant) => [participant.id, participant]));
  const entries = normalizedEntries(input);
  const windowsByEvent = new Map<string, OptimizerWindow[]>();
  for (const window of input.windows) windowsByEvent.set(window.eventId, [...(windowsByEvent.get(window.eventId) ?? []), window]);
  const foreignClaims = new Map<string, Set<string>>();
  for (const claim of input.claims) if (claim.registrationId !== input.registrationId) {
    const claimed = foreignClaims.get(claim.eventId) ?? new Set<string>();
    claimed.add(claim.participantId);
    foreignClaims.set(claim.eventId, claimed);
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const entryBlockers = new Map<string, string[]>();
  const state: State = { assignments: new Map(), eventParticipants: new Map(), participantEvents: new Map(), workload: new Map() };
  const lockLocations = new Map<string, Array<{ eventId: string; eventName: string; teamId: string }>>();
  for (const entry of entries) {
    const local: string[] = [];
    if (entry.event.enabled === false) local.push("賽事項目目前未啟用");
    if (!(windowsByEvent.get(entry.eventId)?.length)) local.push("賽事項目尚未有正式發布的比賽時段");
    if (input.unitKind === "CLUB" && entry.event.allowClub === false) local.push("此賽事項目不接受社團報名");
    if (input.unitKind === "LEAGUE" && entry.event.allowLeague === false) local.push("此賽事項目不接受聯隊報名");
    if (entry.teams.length > entry.event.maxTeamsPerRegistration) local.push("隊伍數量超過賽事上限");
    if (entry.event.maxTeamSize !== null && requiredTeamSize(entry.event) > entry.event.maxTeamSize) local.push("隊伍最低規則超過賽事人數上限");
    const seen = new Set<string>();
    for (const team of entry.teams) {
      state.assignments.set(team.id, []);
      if (team.participantIds.length > (entry.event.maxTeamSize ?? Number.MAX_SAFE_INTEGER)) local.push(`第 ${team.ordinal} 隊超過人數上限`);
      for (const participantId of team.participantIds) {
        if (seen.has(participantId)) local.push("同一選手不可同時出現在 A／B 隊");
        seen.add(participantId);
        const participant = participants.get(participantId);
        if (!participant) local.push(`手動保留選手 ${participantId} 已停用或不屬於此報名單位`);
        else if (!participantMatchesEvent(entry.event, participant)) local.push(`手動保留選手 ${participant.name ?? participant.id} 不符合賽事性別或年級限制`);
        if (foreignClaims.get(entry.eventId)?.has(participantId)) local.push(`手動保留選手 ${participant?.name ?? participantId} 已被其他報名單位使用此賽事`);
        addAssignment(state, team.id, entry.eventId, participantId);
        lockLocations.set(participantId, [...(lockLocations.get(participantId) ?? []), { eventId: entry.eventId, eventName: entry.event.name, teamId: team.id }]);
      }
    }
    if (local.length) entryBlockers.set(entry.id, [...new Set(local)]);
  }
  for (const [participantId, locations] of lockLocations) {
    for (let left = 0; left < locations.length; left++) for (let right = left + 1; right < locations.length; right++) {
      const a = locations[left]!; const b = locations[right]!;
      if (a.eventId === b.eventId) continue;
      if ((windowsByEvent.get(a.eventId) ?? []).some((one) => (windowsByEvent.get(b.eventId) ?? []).some((two) => windowsOverlap(one, two)))) {
        const name = participants.get(participantId)?.name ?? participantId;
        blockers.push(`手動保留選手 ${name} 的 ${a.eventName} 與 ${b.eventName} 時段重疊`);
      }
    }
  }
  for (const [entryId, local] of entryBlockers) {
    const entry = entries.find((item) => item.id === entryId)!;
    blockers.push(...local.map((message) => `${entry.event.name}：${message}`));
  }

  const tasks = entries.flatMap((entry) => entry.teams.map((team) => ({
    entry,
    team,
    required: requiredTeamSize(entry.event),
    maximum: entry.event.maxTeamSize ?? Math.max(requiredTeamSize(entry.event), team.participantIds.length),
  })));
  const participantScarcity = new Map<string, number>();
  for (const participant of participants.values()) participantScarcity.set(participant.id, tasks.filter((task) => participantMatchesEvent(task.entry.event, participant) && !foreignClaims.get(task.entry.eventId)?.has(participant.id)).length);
  const taskOrder = (left: Task, right: Task) => {
    const leftPool = [...participants.values()].filter((participant) => participantMatchesEvent(left.entry.event, participant) && !foreignClaims.get(left.entry.eventId)?.has(participant.id)).length - left.required;
    const rightPool = [...participants.values()].filter((participant) => participantMatchesEvent(right.entry.event, participant) && !foreignClaims.get(right.entry.eventId)?.has(participant.id)).length - right.required;
    return leftPool - rightPool || ruleSpecificity(right.entry.event) - ruleSpecificity(left.entry.event) || eventOrder(left.entry, right.entry) || left.team.ordinal - right.team.ordinal || left.team.id.localeCompare(right.team.id);
  };
  const admittedTasks = tasks.filter((task) => task.team.admissionStatus !== "PENDING").sort(taskOrder);
  const pendingTasks = tasks.filter((task) => task.team.admissionStatus === "PENDING").sort(taskOrder);

  let finalState: State | null = blockers.length ? null : solveTasks(admittedTasks, state, participants, foreignClaims, windowsByEvent, participantScarcity, budget);
  if (finalState && pendingTasks.length) {
    const pendingState = solveTasks(pendingTasks, finalState, participants, foreignClaims, windowsByEvent, participantScarcity, budget);
    if (pendingState) finalState = pendingState;
    else if (!budget.exhausted) blockers.push("待主辦錄取隊伍目前無法完成合法配置");
  }
  if (!finalState && !blockers.length && !budget.exhausted) blockers.push("目前選手條件無法完成所有已錄取隊伍的合法配置");
  if (budget.exhausted) blockers.push("配置搜尋已達安全運算上限，請縮小賽事項目或選手範圍後重試");
  const outputState = finalState ?? state;

  const events = entries.map((entry): OptimizerEventResult => {
    const local = [...(entryBlockers.get(entry.id) ?? [])];
    const teamAssignments = entry.teams.map((team): OptimizerTeamAssignment => {
      const ids = [...(outputState.assignments.get(team.id) ?? team.participantIds)];
      const locked = [...team.participantIds];
      const selected = ids.map((id) => participants.get(id)).filter((item): item is OptimizerParticipant => Boolean(item));
      const complete = ids.length >= requiredTeamSize(entry.event) && validateTeamComposition(entry.event, selected).valid;
      if (!complete && !budget.exhausted) local.push(`${team.ordinal === 1 ? "A 隊" : `第 ${team.ordinal} 隊`} 尚未完成合法配置`);
      return {
        teamId: team.id,
        ordinal: team.ordinal,
        admissionStatus: team.admissionStatus === "PENDING" ? "PENDING" : "ADMITTED",
        participantIds: ids,
        addedParticipantIds: ids.filter((id) => !locked.includes(id)),
        lockedParticipantIds: locked,
        complete,
        willCreateTeamA: Boolean(team.virtual),
      };
    });
    const assigned = new Set(teamAssignments.flatMap((team) => team.participantIds));
    return {
      entryId: entry.id,
      eventId: entry.eventId,
      eventName: entry.event.name,
      requiredParticipants: entry.teams.length * requiredTeamSize(entry.event),
      assignedParticipants: assigned.size,
      complete: local.length === 0 && teamAssignments.every((team) => team.complete),
      willCreateTeamA: teamAssignments.some((team) => team.willCreateTeamA),
      blockers: [...new Set(local)],
      lockedParticipantIds: [...new Set(teamAssignments.flatMap((team) => team.lockedParticipantIds))],
      suggestedParticipantIds: [...new Set(teamAssignments.flatMap((team) => team.addedParticipantIds))],
      teamAssignments,
      windows: windowsByEvent.get(entry.eventId) ?? [],
    };
  });
  for (const event of events) blockers.push(...event.blockers.map((message) => `${event.eventName}：${message}`));
  const outcome = budget.exhausted ? "OPTIMIZATION_LIMIT_REACHED" : blockers.length ? "NO_FEASIBLE_SOLUTION" : "COMPLETE";
  const assignments = entries.flatMap((entry) => entry.teams.map((team) => ({ teamId: team.id, participantIds: [...(outputState.assignments.get(team.id) ?? team.participantIds)] })));
  const assignedIds = [...outputState.workload].filter(([, count]) => count > 0).map(([id]) => id);
  const activeParticipants = [...participants.values()];
  const preserved = [...new Set(entries.flatMap((entry) => entry.teams.flatMap((team) => team.participantIds)))];
  if (entries.some((entry) => entry.teams.some((team) => team.admissionStatus === "PENDING"))) warnings.push("待主辦錄取隊伍已在已錄取義務完成後配置，正式錄取前不計費也不進入最終名單");
  return {
    deterministic: true,
    outcome,
    registrationId: input.registrationId,
    assignments,
    events,
    blockers: [...new Set(blockers)],
    warnings,
    activeParticipantCount: participants.size,
    assignedParticipantCount: assignedIds.length,
    idleParticipantIds: activeParticipants.filter((participant) => !assignedIds.includes(participant.id)).map((participant) => participant.id),
    preservedParticipantIds: preserved,
    timeSlices: timeSlices(entries, outputState, activeParticipants, input.windows),
    search: { nodesVisited: budget.nodes, nodeBudget },
  };
}
