export interface Env {
  NOTION_TOKEN: string;
  HEALTH_API_KEY: string;
  SUPPLEMENTS_DB_ID?: string;
  INTAKE_LOG_DB_ID?: string;
  HEALTH_DB_ID?: string;
  HEALTH_DATE_PROP?: string;
  HEALTH_TITLE_PROP?: string;

  APP_USAGE_DB_ID?: string;
  APP_USAGE_NAME_PROPERTY_NAME?: string;
  APP_USAGE_APP_PROPERTY_NAME?: string;
  APP_USAGE_START_AT_PROPERTY_NAME?: string;
  APP_USAGE_END_AT_PROPERTY_NAME?: string;
  APP_USAGE_DURATION_MIN_PROPERTY_NAME?: string;
  APP_USAGE_TARGET_DATE_PROPERTY_NAME?: string;
  APP_USAGE_DEVICE_PROPERTY_NAME?: string;
  APP_USAGE_SOURCE_PROPERTY_NAME?: string;
  APP_USAGE_SESSION_ID_PROPERTY_NAME?: string;

  DAILY_LOG_ANKI_MINUTES_PROPERTY_NAME?: string;
  DAILY_LOG_ANKI_SESSIONS_PROPERTY_NAME?: string;
  DAILY_LOG_ANKI_LAST_USED_AT_PROPERTY_NAME?: string;

  // legacy envs
  DAILY_LOG_DB_ID?: string;
  DROPBOX_ACCESS_TOKEN?: string;
  DROPBOX_CLIENT_ID?: string;
  DROPBOX_CLIENT_SECRET?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  MEAL_PHOTOS_FOLDER_PATH?: string;
  // temporary backward compatibility
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_FOLDER_PATH?: string;
}

export type SupplementChoice = {
  label: string;
  value: string;
};

export type PostIntakesRequest = {
  taken_at: string;
  supplement_ids: string[];
  source?: string;
};

export type PostIntakesResponse = {
  daily_health_page_id: string;
  created: Array<{ supplement_id: string; intake_page_id: string }>;
  skipped: Array<{ supplement_id: string; reason: string }>;
};
