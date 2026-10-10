import type { Activity, Registration } from "@prisma/client";
import { fail } from "./core.js";
export type ClubAction =
  | "roster"
  | "replacement"
  | "addEvent"
  | "removeEvent"
  | "team"
  | "createTeam"
  | "submit";
export type OperatingStage =
  | "ARCHIVED"
  | "SETUP"
  | "BEFORE_REGISTRATION"
  | "REGISTRATION"
  | "BEFORE_LEADER_MEETING"
  | "LEADER_MEETING"
  | "POST_LEADER_MEETING"
  | "COMPETITION"
  | "CLOSEOUT";
export type StageReason = {
  reasonCode: string;
  message: string;
  availableAt?: Date;
  deadlineAt?: Date;
};
export function operatingStage(activity: Activity, now = new Date()): OperatingStage {
  if (activity.status === "ARCHIVED") return "ARCHIVED";
  if (activity.status === "DRAFT") return "SETUP";
  if (!activity.registrationOpensAt || now < activity.registrationOpensAt)
    return "BEFORE_REGISTRATION";
  if (activity.registrationClosesAt && now < activity.registrationClosesAt)
    return "REGISTRATION";
  if (!activity.leaderMeetingStartsAt || now < activity.leaderMeetingStartsAt)
    return "BEFORE_LEADER_MEETING";
  if (activity.leaderMeetingEndsAt && now <= activity.leaderMeetingEndsAt)
    return "LEADER_MEETING";
  if (activity.competitionStartsAt && now < activity.competitionStartsAt)
    return "POST_LEADER_MEETING";
  if (activity.competitionEndsAt && now <= activity.competitionEndsAt)
    return "COMPETITION";
  return "CLOSEOUT";
}

export function stageReason(activity: Activity, now = new Date()): StageReason | null {
  const stage = operatingStage(activity, now);
  if (stage === "SETUP") {
    if (activity.registrationOpensAt && now < activity.registrationOpensAt)
      return { reasonCode: "BEFORE_OPEN", message: "選手名單尚未開放。", availableAt: activity.registrationOpensAt };
    if (activity.registrationClosesAt && now >= activity.registrationClosesAt)
      return { reasonCode: "AFTER_DEADLINE", message: "選手名單操作已截止。", deadlineAt: activity.registrationClosesAt };
    if (activity.registrationOpensAt && activity.registrationClosesAt && now >= activity.registrationOpensAt && now < activity.registrationClosesAt)
      return { reasonCode: "ORGANIZER_NOT_OPEN", message: "主辦單位尚未開放選手名單操作。目前已進入設定的報名時間，但活動仍為「準備中」。", availableAt: activity.registrationOpensAt, deadlineAt: activity.registrationClosesAt };
    return { reasonCode: "ACTIVITY_NOT_OPEN", message: "主辦單位尚未開放選手名單操作。" };
  }
  if (stage === "BEFORE_REGISTRATION")
    return { reasonCode: "BEFORE_OPEN", message: "選手名單尚未開放。", availableAt: activity.registrationOpensAt ?? undefined };
  if (stage === "CLOSEOUT")
    return { reasonCode: "AFTER_DEADLINE", message: "選手名單操作已截止。", deadlineAt: activity.registrationClosesAt ?? undefined };
  if (stage === "BEFORE_LEADER_MEETING")
    return { reasonCode: "BEFORE_LEADER_MEETING", message: "報名已截止，選手名單將於領隊會議期間開放調整。", availableAt: activity.leaderMeetingStartsAt ?? undefined, deadlineAt: activity.registrationClosesAt ?? undefined };
  if (stage === "POST_LEADER_MEETING")
    return { reasonCode: "AFTER_LEADER_MEETING", message: "領隊會議已結束，選手名單只能透過既有賽事進行替換。", deadlineAt: activity.leaderMeetingEndsAt ?? undefined };
  if (stage === "COMPETITION")
    return { reasonCode: "COMPETITION_IN_PROGRESS", message: "比賽進行中，目前不開放一般選手名單異動。", deadlineAt: activity.competitionEndsAt ?? undefined };
  return null;
}

export function assertPreRegistrationEdit(
  activity: Pick<Activity, "registrationOpensAt">,
  message: string,
  now = new Date(),
) {
  if (activity.registrationOpensAt && now >= activity.registrationOpensAt)
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", message, 409);
}
export function assertStage(
  activity: Activity,
  registration: (Pick<Registration, "status" | "confirmedAt"> & { eventEntries?: { id: string }[] }) | null,
  action: ClubAction,
  now = new Date(),
  meetingStatus: "SCHEDULED" | "ENTRY_OPEN" | "ENTRY_CLOSED_PARTICIPANT_OPEN" | "CLOSED" = "SCHEDULED",
) {
  let stage = operatingStage(activity, now);
  if (activity.competitionStartsAt && now >= activity.competitionStartsAt)
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", "比賽已開始，不再開放領隊端資料異動", 409, {
      reasonCode: "COMPETITION_STARTED",
      deadlineAt: activity.competitionStartsAt,
    });
  if (meetingStatus === "SCHEDULED" && ["LEADER_MEETING", "POST_LEADER_MEETING"].includes(stage)) stage = "BEFORE_LEADER_MEETING";
  if (meetingStatus === "ENTRY_OPEN") stage = "LEADER_MEETING";
  if (meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN" || meetingStatus === "CLOSED") stage = "POST_LEADER_MEETING";
  if (
    activity.status !== "ACTIVE" ||
    ["BEFORE_REGISTRATION", "CLOSEOUT"].includes(stage)
  ) {
    const detail = stageReason(activity, now);
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", detail?.message ?? "目前活動階段尚未開放此操作", 409, detail ?? {});
  }
  if (registration?.status === "SUBMITTED")
    fail("REGISTRATION_LOCKED", "報名已送出審核，請由承辦人員退回後修改");
  if (action === "removeEvent" && registration?.confirmedAt)
    fail(
      "ACTIVITY_STAGE_FORBIDS_ACTION",
      "已確認賽事不得撤回；領隊會議僅開放加報與人員調整",
    );
  if (action === "addEvent" && ["POST_LEADER_MEETING", "COMPETITION"].includes(stage))
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", "領隊會議已結束，不能新增賽事項目");
  if (registration?.status === "CONFIRMED") {
    if (meetingStatus === "CLOSED")
      fail("REGISTRATION_LOCKED", "領隊會議已結束，報名資料已鎖定");
    if (stage === "BEFORE_LEADER_MEETING" || stage === "REGISTRATION")
      fail("REGISTRATION_LOCKED", "報名已確認，請於領隊會議開放期間調整");
    if (action === "submit" || action === "removeEvent")
      fail("REGISTRATION_LOCKED", "已確認的報名不接受此操作");
    if (meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN" && action === "createTeam")
      fail("REGISTRATION_LOCKED", "賽事項目異動已結束，不能新增隊伍");
    if (stage !== "LEADER_MEETING" && action === "roster" && !registration.eventEntries?.length)
      fail("ACTIVITY_STAGE_FORBIDS_ACTION", "會後僅能透過既有賽事進行選手替換");
    return;
  }
  if (
    !["REGISTRATION", "LEADER_MEETING"].includes(stage) &&
    !(registration?.status === "RETURNED" && stage === "BEFORE_LEADER_MEETING")
  ) {
    const detail = stageReason(activity, now);
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", detail?.message ?? "目前不在可編輯報名的期間", 409, detail ?? {});
  }
}

export function assertRegistrationSubmissionStage(
  activity: Activity,
  registration: Pick<Registration, "status" | "confirmedAt">,
  now = new Date(),
) {
  const stage = operatingStage(activity, now);
  if (registration.status === "DRAFT" && stage !== "REGISTRATION")
    fail("ACTIVITY_STAGE_FORBIDS_ACTION", "目前不在報名開放期間，無法送出報名", 409);
  if (registration.status === "RETURNED")
    assertStage(activity, registration, "submit", now);
}
