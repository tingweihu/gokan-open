import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { LegalService } from "./legal.service.js";

@Controller()
export class LegalController {
  constructor(private readonly legal: LegalService) {}
  @Get("legal/:type") public(@Param("type") type: string) { return this.legal.publicDocument(type); }
  @Get("activities/:activityId/legal") list(@Req() req: RequestContext, @Param("activityId") activityId: string) { return this.legal.list(req, activityId); }
  @Post("activities/:activityId/legal") create(@Req() req: RequestContext, @Param("activityId") activityId: string, @Body() body: unknown) { return this.legal.create(req, activityId, body); }
  @Patch("activities/:activityId/legal/:id") update(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("id") id: string, @Body() body: unknown) { return this.legal.update(req, activityId, id, body); }
  @Post("activities/:activityId/legal/:id/publish") publish(@Req() req: RequestContext, @Param("activityId") activityId: string, @Param("id") id: string) { return this.legal.publish(req, activityId, id); }
}
