import { ActivityController } from "./activity.controller.js";
import { RosterController } from "./roster.controller.js";
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { Database } from "./core.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { AccountsController } from "./accounts.controller.js";
import { CompetitionController } from "./competition.controller.js";
import { CompetitionService } from "./competition.service.js";
import { LeagueController } from "./league.controller.js";
import { LeagueService, LeagueEligibilityService } from "./league.service.js";
import { RegistrationController } from "./registration.controller.js";
import { RegistrationService } from "./registration.service.js";
import { RegistrationValidationService } from "./registration-validation.service.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService, ParticipationEligibilityService } from "./finance.service.js";
import { FinanceCalculationService } from "./finance-calculation.service.js";
import { ExportController } from "./export.controller.js";
import { ExportService } from "./export.service.js";
import { RosterSuggestionService } from "./roster-suggestion.service.js";
import { LegalController } from "./legal.controller.js";
import { LegalService } from "./legal.service.js";
import { LeaderMeetingController } from "./leader-meeting.controller.js";
import { LeaderMeetingService } from "./leader-meeting.service.js";
@Module({
  controllers: [
    ActivityController,
    RosterController,
    HealthController,
    IdentityController,
    AccountsController,
    CompetitionController,
    LeagueController,
    RegistrationController,
    FinanceController,
    ExportController,
    LegalController,
    LeaderMeetingController,
  ],
  providers: [Database, IdentityService, CompetitionService, LeagueService, LeagueEligibilityService, RegistrationService, RegistrationValidationService, FinanceService, FinanceCalculationService, ParticipationEligibilityService, ExportService, RosterSuggestionService, LegalService, LeaderMeetingService],
})
export class AppModule {}
