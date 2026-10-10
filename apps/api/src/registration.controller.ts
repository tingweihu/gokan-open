import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { RequestContext } from "./core.js";
import { RegistrationService } from "./registration.service.js";

@Controller()
export class RegistrationController {
  constructor(private readonly registrations: RegistrationService) {}
  @Get("registrations/:registrationId")
  detail(@Req() req: RequestContext, @Param("registrationId") id: string) { return this.registrations.detail(req, id); }
  @Post("registrations/:registrationId/roster-submit")
  rosterSubmit(@Req() req: RequestContext, @Param("registrationId") id: string, @Body() body: unknown) { return this.registrations.rosterSubmit(req, id, body); }
  @Post("registrations/:registrationId/submit")
  submit(@Req() req: RequestContext, @Param("registrationId") id: string, @Body() body: unknown) { return this.registrations.submit(req, id, body); }
  @Get("activities/:activityId/registration-review")
  reviewList(@Req() req: RequestContext, @Param("activityId") id: string) { return this.registrations.reviewList(req, id); }
  @Post("registrations/:registrationId/return")
  returnRegistration(@Req() req: RequestContext, @Param("registrationId") id: string, @Body() body: unknown) { return this.registrations.returnRegistration(req, id, body); }
  @Post("registrations/:registrationId/confirm")
  confirm(@Req() req: RequestContext, @Param("registrationId") id: string, @Body() body: unknown) { return this.registrations.confirm(req, id, body); }
}
