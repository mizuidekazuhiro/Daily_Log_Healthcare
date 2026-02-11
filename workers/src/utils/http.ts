export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export const readJson = async <T>(request: Request): Promise<T> => {
  return (await request.json()) as T;
};

export const badRequest = (message: string): Response =>
  jsonResponse(400, { ok: false, error: message });

export const errorResponse = (
  status: number,
  message: string,
  detail?: unknown,
): Response => jsonResponse(status, { ok: false, error: message, detail });
