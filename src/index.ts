export interface Env {
  NOTION_TOKEN: string;
  DAILY_LOG_DB_ID: string;
  HEALTH_API_KEY: string;
}

type Payload = {
  date?: string | null;
  weight?: number | null;
  protein?: number | null;
  fat?: number | null;
  carb?: number | null;
  kcal?: number | null;
  source?: string | null;
};

const NOTION_VERSION = "2022-06-28";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const validatePayload = (payload: Payload): string | null => {
  const numericKeys = [
    "weight",
    "protein",
    "fat",
    "carb",
    "kcal",
  ] as const;

  for (const key of numericKeys) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) {
      continue;
    }
    const value = payload[key];
    if (value === null || value === undefined) {
      continue;
    }
    if (!isFiniteNumber(value)) {
      return `${key} must be a finite number`;
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, "source")) {
    const value = payload.source;
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value !== "string") {
      return "source must be a string";
    }
  }

  return null;
};

const buildPartialProps = (payload: Payload): Record<string, unknown> => {
  const props: Record<string, unknown> = {};

  if (payload.weight !== null && payload.weight !== undefined) {
    props["Weight"] = { number: payload.weight };
  }
  if (payload.protein !== null && payload.protein !== undefined) {
    props["Protein"] = { number: payload.protein };
  }
  if (payload.fat !== null && payload.fat !== undefined) {
    props["Fat"] = { number: payload.fat };
  }
  if (payload.carb !== null && payload.carb !== undefined) {
    props["Carb"] = { number: payload.carb };
  }
  if (payload.kcal !== null && payload.kcal !== undefined) {
    props["Kcal"] = { number: payload.kcal };
  }
  if (payload.source !== null && payload.source !== undefined) {
    const trimmed = payload.source.trim();
    if (trimmed) {
      props["Source"] = { select: { name: trimmed } };
    }
  }

  return props;
};

const notionRequest = async (
  url: string,
  options: RequestInit,
  token: string,
): Promise<
  | { ok: true; json: any }
  | { ok: false; status: number; text: string }
> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      text: await response.text(),
    };
  }

  return { ok: true, json: await response.json() };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname !== "/api/health/daily") {
      return jsonResponse({ ok: false, error: "Not Found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405);
    }

    const apiKey = request.headers.get("X-API-Key");
    if (!apiKey || apiKey !== env.HEALTH_API_KEY) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }


let payload: Payload;
try {
  payload = (await request.json()) as Payload;
} catch (error) {
  return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
}

// DEBUG: いま何が届いているか確認（問題が解けたら消す）
return jsonResponse(
  {
    ok: false,
    debug: {
      content_type: request.headers.get("Content-Type"),
      raw_date: (payload as any)?.date,
      payload,
    },
  },
  400,
);

    if (!payload || typeof payload.date !== "string" || !payload.date.trim()) {
      return jsonResponse({ ok: false, error: "date is required" }, 400);
    }

    const validationError = validatePayload(payload);
    if (validationError) {
      return jsonResponse({ ok: false, error: validationError }, 400);
    }

    const date = payload.date.trim();
    const partialProps = buildPartialProps(payload);

    const queryBody = {
      filter: {
        property: "Date",
        date: {
          equals: date,
        },
      },
      page_size: 1,
    };

    const queryResult = await notionRequest(
      `https://api.notion.com/v1/databases/${env.DAILY_LOG_DB_ID}/query`,
      {
        method: "POST",
        body: JSON.stringify(queryBody),
      },
      env.NOTION_TOKEN,
    );

    if (!queryResult.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Notion API error",
          status: queryResult.status,
          detail: queryResult.text,
        },
        502,
      );
    }

    const results = queryResult.json.results as Array<{ id: string }>;

    if (results.length > 0) {
      if (Object.keys(partialProps).length === 0) {
        return jsonResponse({ ok: true, action: "updated", date });
      }

      const updateResult = await notionRequest(
        `https://api.notion.com/v1/pages/${results[0].id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ properties: partialProps }),
        },
        env.NOTION_TOKEN,
      );

      if (!updateResult.ok) {
        return jsonResponse(
          {
            ok: false,
            error: "Notion API error",
            status: updateResult.status,
            detail: updateResult.text,
          },
          502,
        );
      }

      return jsonResponse({ ok: true, action: "updated", date });
    }

    const createProps = {
      Name: {
        title: [{ text: { content: `Daily Log | ${date}` } }],
      },
      Date: {
        date: { start: date },
      },
      ...partialProps,
    };

    const createResult = await notionRequest(
      "https://api.notion.com/v1/pages",
      {
        method: "POST",
        body: JSON.stringify({
          parent: { database_id: env.DAILY_LOG_DB_ID },
          properties: createProps,
        }),
      },
      env.NOTION_TOKEN,
    );

    if (!createResult.ok) {
      return jsonResponse(
        {
          ok: false,
          error: "Notion API error",
          status: createResult.status,
          detail: createResult.text,
        },
        502,
      );
    }

    return jsonResponse({ ok: true, action: "created", date });
  },
};
