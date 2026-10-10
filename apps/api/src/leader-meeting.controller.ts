import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { LeaderMeetingService } from "./leader-meeting.service.js";

@Controller()
export class LeaderMeetingController {
  constructor(private readonly meetings: LeaderMeetingService) {}

  @Get("activities/:activityId/leader-meeting")
  get(@Req() request: RequestContext, @Param("activityId") activityId: string) {
    return this.meetings.get(request, activityId);
  }

  @Post("activities/:activityId/leader-meeting/start")
  start(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.meetings.mutate(request, activityId, "start", body);
  }

  @Post("activities/:activityId/leader-meeting/close-entry")
  closeEntry(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.meetings.mutate(request, activityId, "close-entry", body);
  }
  @Post("activities/:activityId/leader-meeting/admissions")
  addAdmissionEntry(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.meetings.addAdmissionEntry(request, activityId, body);
  }

  @Post("activities/:activityId/leader-meeting/close")
  close(@Req() request: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.meetings.mutate(request, activityId, "close", body);
  }
}
