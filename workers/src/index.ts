import type { Env } from "./types";
import { routeRequest } from "./routes";
import { aggregateStudyUsageForTargetDate, getAppUsageDayStartHour, getPreviousJstDateFrom } from "./services/app_usage_session_service";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return routeRequest(request, env);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const scheduledMs = controller.scheduledTime || Date.now();
    const dayStartHour = getAppUsageDayStartHour(env);
    const targetDate = getPreviousJstDateFrom(scheduledMs, dayStartHour);
    console.log("APP_USAGE_SCHEDULED_AGGREGATION_START", { target_date: targetDate, day_start_hour: dayStartHour, scheduled_time_ms: scheduledMs });
    try {
      const aggregate = await aggregateStudyUsageForTargetDate(env, targetDate);
      console.log("APP_USAGE_SCHEDULED_AGGREGATION_DONE", { target_date: targetDate, day_start_hour: dayStartHour, study_minutes: aggregate.minutes, study_sessions: aggregate.sessions, study_last_used_at: aggregate.last });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("APP_USAGE_SCHEDULED_AGGREGATION_ERROR", { target_date: targetDate, day_start_hour: dayStartHour, message: msg });
      throw error;
    }
  },
};
