import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { ExportService } from "./export.service.js";

type BinaryResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { end(body: Buffer): void };
};

function send(response: BinaryResponse, file: { filename: string; mime: string; buffer: Buffer }) {
  response.setHeader("Content-Type", file.mime);
  response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
  response.setHeader("Cache-Control", "private, no-store");
  response.status(200).end(file.buffer);
}

@Controller()
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @Get("activities/:activityId/exports/annual.xlsx")
  async annualXlsx(@Req() request: RequestContext, @Param("activityId") activityId: string, @Res() response: BinaryResponse) {
    send(response, await this.exports.annualWorkbook(request, activityId));
  }

  @Get("activities/:activityId/exports/archive.json")
  async annualJson(@Req() request: RequestContext, @Param("activityId") activityId: string, @Res() response: BinaryResponse) {
    send(response, await this.exports.annualArchive(request, activityId));
  }

  @Get("activities/:activityId/roster.xlsx")
  async rosterXlsx(@Req() request: RequestContext, @Param("activityId") activityId: string, @Query("organizationId") organizationId: string | undefined, @Res() response: BinaryResponse) {
    send(response, await this.exports.rosterWorkbook(request, activityId, organizationId));
  }

  @Get("activities/:activityId/check-in")
  checkIn(@Req() request: RequestContext, @Param("activityId") activityId: string, @Query("eventId") eventId?: string) {
    return this.exports.checkInRows(request, activityId, eventId ? { eventId } : {});
  }

  @Get("activities/:activityId/check-in.xlsx")
  async checkInXlsx(@Req() request: RequestContext, @Param("activityId") activityId: string, @Query("eventId") eventId: string | undefined, @Res() response: BinaryResponse) {
    send(response, await this.exports.checkInWorkbook(request, activityId, eventId ? { eventId } : {}));
  }

  @Get("activities/:activityId/check-in.csv")
  async checkInCsv(@Req() request: RequestContext, @Param("activityId") activityId: string, @Query("eventId") eventId: string | undefined, @Res() response: BinaryResponse) {
    send(response, await this.exports.checkInCsv(request, activityId, eventId ? { eventId } : {}));
  }
  @Get("activities/:activityId/final-pack")
  finalPack(@Req() request: RequestContext, @Param("activityId") activityId: string) {
    return this.exports.finalPack(request, activityId);
  }
  @Get("activities/:activityId/leader-timetable")
  leaderTimetable(@Req() request: RequestContext, @Param("activityId") activityId: string, @Query("registrationId") registrationId?: string) {
    return this.exports.leaderTimetable(request, activityId, registrationId);
  }
  @Get("activities/:activityId/final-pack/participants.xlsx")
  async finalPackXlsx(@Req() request: RequestContext, @Param("activityId") activityId: string, @Res() response: BinaryResponse) {
    send(response, await this.exports.finalPackWorkbook(request, activityId));
  }
}
