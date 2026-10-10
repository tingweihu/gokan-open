import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { LeagueService } from "./league.service.js";

@Controller()
export class LeagueController {
  constructor(private readonly leagues: LeagueService) {}
  @Get("activities/:activityId/league-rule")
  rule(@Req() req: RequestContext, @Param("activityId") id: string) { return this.leagues.rule(req, id); }
  @Get("activities/:activityId/clubs/:organizationId/league-qualification")
  qualification(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("organizationId") organizationId: string) { return this.leagues.qualification(req, activityId, organizationId); }
  @Patch("activities/:activityId/league-rule")
  updateRule(@Req() req: RequestContext, @Param("activityId") id: string, @Body() body: unknown) { return this.leagues.updateRule(req, id, body); }
  @Get("activities/:activityId/leagues")
  list(@Req() req: RequestContext, @Param("activityId") id: string) { return this.leagues.list(req, id); }
  @Post("activities/:activityId/leagues")
  create(@Req() req: RequestContext, @Param("activityId") id: string, @Body() body: unknown) { return this.leagues.create(req, id, body); }
  @Patch("leagues/:leagueId")
  update(@Req() req: RequestContext, @Param("leagueId") id: string, @Body() body: unknown) { return this.leagues.update(req, id, body); }
  @Delete("leagues/:leagueId")
  withdraw(@Req() req: RequestContext, @Param("leagueId") id: string, @Body() body: unknown) { return this.leagues.withdraw(req, id, body); }
  @Get("leagues/:leagueId")
  get(@Req() req: RequestContext, @Param("leagueId") id: string) { return this.leagues.get(req, id); }
  @Post("leagues/:leagueId/members")
  addMember(@Req() req: RequestContext, @Param("leagueId") id: string, @Body() body: unknown) { return this.leagues.addMember(req, id, body); }
  @Post("leagues/:leagueId/members/:memberId/confirm")
  confirm(@Req() req: RequestContext, @Param("leagueId") leagueId: string, @Param("memberId") memberId: string, @Body() body: unknown) { return this.leagues.confirm(req, leagueId, memberId, body); }
  @Get("leagues/:leagueId/participants")
  participants(@Req() req: RequestContext, @Param("leagueId") id: string) { return this.leagues.participants(req, id); }
}
