import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import { IdentityService } from "./identity.service.js";
import type { HttpResponse, RequestContext } from "./core.js";
@Controller("auth")
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  @Post("login")
  async login(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const token = await this.identity.login(
      body,
      request.socket.remoteAddress ?? "unknown",
    );
    response.setHeader("Set-Cookie", this.identity.cookie(token));
    return { success: true };
  }
  @Get("me")
  me(@Req() request: RequestContext) {
    return this.identity.me(request);
  }
  @Post("password")
  async password(
    @Body() body: unknown,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    response.setHeader(
      "Set-Cookie",
      this.identity.cookie(await this.identity.changePassword(request, body)),
    );
    return { success: true };
  }
  @Post("consent")
  async consent(@Body() body: unknown, @Req() request: RequestContext) {
    await this.identity.consent(request, body);
    return { success: true };
  }
  @Post("session-acknowledgement")
  async sessionAcknowledgement(@Body() body: unknown, @Req() request: RequestContext) {
    return this.identity.acknowledgeSession(request, body);
  }
  @Post("logout")
  async logout(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    await this.identity.logout(request);
    response.setHeader("Set-Cookie", this.identity.cookie("", true));
    return { success: true };
  }
}
