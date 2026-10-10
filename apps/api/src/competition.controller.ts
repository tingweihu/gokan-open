import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { CompetitionService } from "./competition.service.js";
import { RegistrationService } from "./registration.service.js";
import { RosterSuggestionService } from "./roster-suggestion.service.js";

@Controller()
export class CompetitionController {
  constructor(private readonly competition: CompetitionService, private readonly registrationService: RegistrationService, private readonly suggestions: RosterSuggestionService) {}

  @Get("activities/:activityId/events")
  events(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.activityEvents(req, activityId);
  }
  @Get("activities/:activityId/competition-builder-state")
  builderState(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.builderState(req, activityId);
  }
  @Get("activities/:activityId/events/template/2025")
  eventTemplate(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.eventTemplate(req, activityId);
  }
  @Get("activities/:activityId/event-template/2025/preview")
  eventTemplatePreview(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.eventTemplatePreview(req, activityId);
  }

  @Get("activities/:activityId/event-admissions")
  eventAdmissions(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.eventAdmissions(req, activityId);
  }
  @Post("activities/:activityId/event-template/2025/apply")
  applyEventTemplate(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.competition.applyEventTemplate(req, activityId, body);
  }
  @Post("activities/:activityId/events")
  createEvent(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.competition.createEvent(req, activityId, body);
  }
  @Patch("activities/:activityId/events/:eventId")
  updateEvent(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("eventId") eventId: string, @Body() body: unknown) {
    return this.competition.updateEvent(req, activityId, eventId, body);
  }
  @Delete("activities/:activityId/events/:eventId")
  deleteEvent(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("eventId") eventId: string, @Body() body: unknown) {
    return this.competition.deleteEvent(req, activityId, eventId, body);
  }

  @Get("activities/:activityId/schedules")
  schedules(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.schedules(req, activityId);
  }
  @Post("activities/:activityId/schedules")
  createSchedule(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.createSchedule(req, activityId);
  }
  @Get("schedules/:scheduleId/windows")
  windows(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string) {
    return this.competition.windows(req, scheduleId);
  }
  @Post("schedules/:scheduleId/windows")
  createWindow(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string, @Body() body: unknown) {
    return this.competition.createWindow(req, scheduleId, body);
  }
  @Patch("schedules/:scheduleId/windows/:windowId")
  updateWindow(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string, @Param("windowId") windowId: string, @Body() body: unknown) {
    return this.competition.updateWindow(req, scheduleId, windowId, body);
  }
  @Delete("schedules/:scheduleId/windows/:windowId")
  deleteWindow(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string, @Param("windowId") windowId: string, @Body() body: unknown) {
    return this.competition.deleteWindow(req, scheduleId, windowId, (body as { rowVersion?: unknown })?.rowVersion);
  }
  @Get("schedules/:scheduleId/impact")
  impact(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string) {
    return this.competition.impact(req, scheduleId);
  }
  @Post("schedules/:scheduleId/publish")
  publish(@Req() req: RequestContext, @Param("scheduleId") scheduleId: string) {
    return this.competition.publish(req, scheduleId);
  }

  @Post("activities/:activityId/registrations")
  registration(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) {
    return this.competition.getOrCreateRegistration(req, activityId, body);
  }
  @Get("activities/:activityId/registrations")
  registrations(@Req() req: RequestContext, @Param("activityId") activityId: string) {
    return this.competition.registrations(req, activityId);
  }
  @Post("activities/:activityId/leagues/:leagueId/registrations")
  leagueRegistration(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("leagueId") leagueId: string) {
    return this.competition.getOrCreateLeagueRegistration(req, activityId, leagueId);
  }
  @Get("registrations/:registrationId")
  getRegistration(@Req() req: RequestContext, @Param("registrationId") registrationId: string) {
    return this.registrationService.detail(req, registrationId);
  }
  @Post("registrations/:registrationId/events")
  createEntry(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.competition.createEntry(req, registrationId, body);
  }
  @Delete("registrations/:registrationId/events/:eventId")
  removeEntry(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Param("eventId") eventId: string, @Body() body: unknown) {
    return this.competition.removeEntry(req, registrationId, eventId, (body as { rowVersion?: unknown })?.rowVersion);
  }
  @Post("event-entries/:entryId/teams")
  createTeam(@Req() req: RequestContext, @Param("entryId") entryId: string, @Body() body: unknown) {
    return this.competition.createTeam(req, entryId, body);
  }

  @Post("teams/:teamId/admit")
  admitTeam(@Req() req: RequestContext, @Param("teamId") teamId: string, @Body() body: unknown) {
    return this.competition.admitTeam(req, teamId, body);
  }
  @Post("teams/:teamId/reject")
  rejectTeam(@Req() req: RequestContext, @Param("teamId") teamId: string, @Body() body: unknown) {
    return this.competition.rejectTeam(req, teamId, body);
  }
  @Post("event-entries/:entryId/roster-suggestion")
  rosterSuggestion(@Req() req: RequestContext, @Param("entryId") entryId: string) {
    return this.suggestions.suggest(req, entryId);
  }
  @Post("event-entries/:entryId/roster-suggestion/apply")
  applyRosterSuggestion(@Req() req: RequestContext, @Param("entryId") entryId: string, @Body() body: unknown) {
    return this.suggestions.apply(req, entryId, body);
  }
  @Post("registrations/:registrationId/roster-suggestion")
  registrationRosterSuggestion(@Req() req: RequestContext, @Param("registrationId") registrationId: string) {
    return this.suggestions.registrationSuggest(req, registrationId);
  }
  @Post("registrations/:registrationId/roster-suggestion/apply")
  applyRegistrationRosterSuggestion(@Req() req: RequestContext, @Param("registrationId") registrationId: string, @Body() body: unknown) {
    return this.suggestions.registrationApply(req, registrationId, body);
  }
  @Post("teams/move-member")
  moveMember(@Req() req: RequestContext, @Body() body: unknown) {
    return this.competition.moveMember(req, body);
  }
  @Post("teams/replace-member")
  replaceMember(@Req() req: RequestContext, @Body() body: unknown) {
    return this.competition.replaceMember(req, body);
  }
  @Post("teams/:teamId/members")
  addMember(@Req() req: RequestContext, @Param("teamId") teamId: string, @Body() body: unknown) {
    return this.competition.addMember(req, teamId, body);
  }
  @Delete("teams/:teamId/members/:participantId")
  removeMember(@Req() req: RequestContext, @Param("teamId") teamId: string, @Param("participantId") participantId: string, @Body() body: unknown) {
    return this.competition.removeMember(req, teamId, participantId, (body as { rowVersion?: unknown })?.rowVersion);
  }
}
