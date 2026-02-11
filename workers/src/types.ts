export interface Env {
  NOTION_TOKEN: string;
  WORKERS_BEARER_TOKEN?: string;
  SUPPLEMENTS_DB_ID?: string;
  INTAKE_LOG_DB_ID?: string;
  HEALTH_DB_ID?: string;
  HEALTH_DATE_PROP?: string;
  HEALTH_TITLE_PROP?: string;

  // legacy envs
  DAILY_LOG_DB_ID?: string;
  HEALTH_API_KEY?: string;
  DROPBOX_ACCESS_TOKEN?: string;
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_REFRESH_TOKEN?: string;
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
