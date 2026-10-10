import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { Worker } from "node:worker_threads";
import { join } from "node:path";
import { z } from "zod";
import {
  Database,
  fail,
  lock,
  parse,
  uuid,
  version,
  type RequestContext,
  type Tx,
} from "./core.js";
import { IdentityService } from "./identity.service.js";
import { assertStage, operatingStage, stageReason } from "./stage.js";
import {
  participantData,
  rosterTemplate,
  uploadSchema,
  type ImportResult,
} from "./spreadsheet.js";
let parsing = 0;
async function parseImport(
  file: z.infer<typeof uploadSchema>,
): Promise<ImportResult> {
  if (parsing >= 4) fail("IMPORT_BUSY", "名單處理中，請稍後再試", 429);
  parsing++;
  try {
    return await new Promise<ImportResult>((resolve, reject) => {
      const worker = new Worker(join(__dirname, "import-worker.js"), {
        workerData: file,
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(new Error("名單處理逾時"));
      }, 10000);
      worker.once(
        "message",
        (message: { result?: ImportResult; error?: string }) => {
          clearTimeout(timeout);
          void worker.terminate();
          if (message.result) resolve(message.result);
          else reject(new Error(message.error ?? "名單格式不正確"));
        },
      );
      worker.once("error", () => {
        clearTimeout(timeout);
        reject(new Error("名單過大或格式不正確"));
      });
      worker.once("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error("名單處理失敗"));
      });
    });
  } catch (error) {
    fail(
      "IMPORT_INVALID_ROWS",
      error instanceof Error ? error.message : "名單格式不正確",
      422,
    );
  } finally {
    parsing--;
  }
}
@Controller("clubs/:clubId/roster")
export class RosterController {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
  ) {}
  private async scope(req: RequestContext, clubId: string, write = false) {
    parse(uuid, clubId);
    const actor = await this.identity.authenticate(req);
    const club = await this.db.organization.findUnique({
      where: { id: clubId },
    });
    if (!club) fail("NOT_FOUND", "找不到社團", 404);
    if (write) await this.identity.club(this.db, actor.user.id, clubId);
    else {
      const staff = await this.db.activityStaff.findFirst({
        where: {
          userId: actor.user.id,
          activityId: club.activityId,
          revokedAt: null,
          role: { in: ["SYSTEM_ADMIN", "REGISTRATION_FINANCE"] },
        },
      });
      if (!staff) await this.identity.club(this.db, actor.user.id, clubId);
    }
    return { actor: actor.user.id, club };
  }
  private async writable(
    tx: Tx,
    actor: string,
    clubId: string,
    activityId: string,
  ) {
    await lock(tx, `activity:${activityId}`);
    await this.identity.club(tx, actor, clubId);
    const activity = await tx.activity.findUniqueOrThrow({
      where: { id: activityId },
    });
    const meeting = await tx.leaderMeeting.findUnique({
      where: { activityId },
      select: { status: true },
    });
    const registrations = await tx.registration.findMany({
      where: {
        activityId,
        OR: [
          { organizationId: clubId },
          {
            eventEntries: {
              some: {
                active: true,
                teamMembers: {
                  some: {
                    active: true,
                    participant: { sourceOrganizationId: clubId },
                  },
                },
              },
            },
          },
        ],
      },
      include: { eventEntries: { where: { active: true }, select: { id: true } } },
    });
    if (!registrations.length) assertStage(activity, null, "roster", new Date(), meeting?.status);
    for (const registration of registrations)
      assertStage(activity, registration, "roster", new Date(), meeting?.status);
  }
  @Get()
  async list(@Req() req: RequestContext, @Param("clubId") clubId: string) {
    const { club } = await this.scope(req, clubId);
    const activity = await this.db.activity.findUniqueOrThrow({ where: { id: club.activityId } });
    const meeting = await this.db.leaderMeeting.findUnique({ where: { activityId: club.activityId }, select: { status: true } });
    const meetingStatus = meeting?.status ?? "SCHEDULED";
    const participants = await this.db.participant.findMany({
      where: { sourceOrganizationId: clubId },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      take: 5000,
    });
    const stage = operatingStage(activity);
    let reason = stageReason(activity);
    const competitionStarted = Boolean(activity.competitionStartsAt && new Date() >= activity.competitionStartsAt);
    if (!competitionStarted && meetingStatus === "ENTRY_OPEN") reason = null;
    if (!competitionStarted && meetingStatus === "ENTRY_CLOSED_PARTICIPANT_OPEN") reason = null;
    if (meetingStatus === "SCHEDULED" && ["LEADER_MEETING", "POST_LEADER_MEETING"].includes(stage))
      reason = { reasonCode: "LEADER_MEETING_NOT_STARTED", message: "已到領隊會議時間，主辦尚未開始會議，選手名單仍維持鎖定。" };
    if (meetingStatus === "CLOSED")
      reason = { reasonCode: "LEADER_MEETING_CLOSED", message: "領隊會議已結束，選手名單已鎖定。" };
    return {
      club,
      participants,
      total: participants.length,
      active: participants.filter((p) => p.active).length,
      activityStage: {
        status: activity.status,
        stage,
        meetingStatus,
        reason,
      },
    };
  }
  @Post()
  async create(
    @Req() req: RequestContext,
    @Param("clubId") clubId: string,
    @Body() input: unknown,
  ) {
    const { actor, club } = await this.scope(req, clubId, true);
    const data = parse(participantData, input);
    return this.db.$transaction(async (tx) => {
      await this.writable(tx, actor, clubId, club.activityId);
      const participant = await tx.participant.create({
        data: {
          ...data,
          activityId: club.activityId,
          sourceOrganizationId: clubId,
        },
      });
      
      return participant;
    });
  }
  @Patch(":participantId")
  async update(
    @Req() req: RequestContext,
    @Param("clubId") clubId: string,
    @Param("participantId") participantId: string,
    @Body() input: unknown,
  ) {
    const { actor, club } = await this.scope(req, clubId, true);
    parse(uuid, participantId);
    const { rowVersion, ...data } = parse(
      participantData
        .extend({ active: z.boolean(), rowVersion: version })
        .strict(),
      input,
    );
    return this.db.$transaction(async (tx) => {
      await this.writable(tx, actor, clubId, club.activityId);
      const scopedParticipant = await tx.participant.findFirst({
        where: { id: participantId, sourceOrganizationId: clubId },
        select: { id: true },
      });
      if (!scopedParticipant) fail("NOT_FOUND", "找不到選手", 404);
      if (
        !data.active &&
        (await tx.teamMember.count({ where: { participantId, active: true } }))
      )
        fail(
          "PARTICIPANT_ASSIGNED",
          "此選手仍有參賽隊伍，請先移除或替換隊伍成員",
        );
      const participant = await tx.participant.update({
        where: { id: scopedParticipant.id, rowVersion },
        data: { ...data, rowVersion: { increment: 1 } },
      });
      
      return participant;
    });
  }
  @Get("template")
  async template(@Req() req: RequestContext, @Param("clubId") clubId: string) {
    await this.scope(req, clubId, true);
    return {
      name: "高康盃選手名單.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: await rosterTemplate(),
    };
  }
  @Post("import/:mode")
  async import(
    @Req() req: RequestContext,
    @Param("clubId") clubId: string,
    @Param("mode") mode: string,
    @Body() input: unknown,
  ) {
    const { actor, club } = await this.scope(req, clubId, true);
    parse(z.enum(["preview", "commit"]), mode);
    const data = parse(
      z.object({ file: uploadSchema, clubVersion: version }).strict(),
      input,
    );
    const preview = await parseImport(data.file);
    return this.db.$transaction(async (tx) => {
      await this.writable(tx, actor, clubId, club.activityId);
      const current = await tx.organization.findUniqueOrThrow({
        where: { id: clubId },
      });
      if (current.rowVersion !== data.clubVersion)
        fail("STALE_VERSION", "名單已更新，請重新預覽");
      const existing = await tx.participant.findMany({
        where: { sourceOrganizationId: clubId },
        select: { name: true, gender: true, grade: true },
      });
      const keys = new Set(
        existing.map((p) =>
          JSON.stringify([p.name.normalize("NFKC"), p.gender, p.grade]),
        ),
      );
      for (const [i, row] of preview.rows.entries()) {
        const key = JSON.stringify([row.name, row.gender, row.grade]);
        if (keys.has(key)) {
          preview.errors.push({
            row: preview.sourceRows[i] ?? i + 2,
            field: "姓名",
            value: row.name,
            message:
              "已有相同姓名、性別與年級的選手；同名同資料者請人工核對後單筆建立",
          });
          preview.invalidRows++;
          preview.validRows--;
        }
        keys.add(key);
      }
      if (mode === "preview") return preview;
      if (preview.errors.length || !preview.rows.length)
        fail("IMPORT_INVALID_ROWS", "請先修正名單錯誤再匯入", 422, {
          errors: preview.errors,
        });
      await tx.organization.update({
        where: { id: clubId, rowVersion: data.clubVersion },
        data: { rowVersion: { increment: 1 } },
      });
      await tx.participant.createMany({
        data: preview.rows.map((p) => ({
          ...p,
          activityId: club.activityId,
          sourceOrganizationId: clubId,
        })),
      });
      
      return { imported: preview.rows.length };
    });
  }
}
