type AuthEnv = { HEALTH_API_KEY?: string };

export const requireBearerAuth = (request: Request, env: AuthEnv): boolean => {
  const expected = env.HEALTH_API_KEY;
  if (!expected) {
    return false;
  }
  const auth = request.headers.get("Authorization") ?? "";
  return auth === `Bearer ${expected}`;
};
