type AuthEnv = { HEALTH_API_KEY?: string };

export const requireBearerAuth = (request: Request, env: AuthEnv): boolean => {
  const expected = env.HEALTH_API_KEY;
  if (!expected) {
    return false;
  }

  const auth = request.headers.get("Authorization")?.trim();
  if (auth) {
    const matched = auth.match(/^Bearer\s+(.+)$/i);
    if (matched && matched[1]?.trim() === expected) {
      return true;
    }

    if (auth === expected) {
      return true;
    }
  }

  const apiKeyHeader = request.headers.get("X-API-Key")?.trim();
  if (apiKeyHeader && apiKeyHeader === expected) {
    return true;
  }

  return false;
};
