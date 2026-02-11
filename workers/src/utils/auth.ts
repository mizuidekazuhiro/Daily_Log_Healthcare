import type { Env } from "../types";

export const requireBearerAuth = (request: Request, env: Env): boolean => {
  const expected = env.WORKERS_BEARER_TOKEN;
  if (!expected) {
    return false;
  }
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${expected}`;
};
