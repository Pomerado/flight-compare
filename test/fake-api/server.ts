import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for Pomerado's REST API, for tests and for working on the app without an account.
 * It answers the calls the app makes (GET /v1/quota, POST /v1/runs/read-only, GET /v1/jobs/{id},
 * POST /v1/jobs/{id}/cancel) in the public API's shapes, with synthetic results from
 * test/fixtures. A scenario says how each tool behaves.
 */

export const TOOLS = {
  googleFlights: "tool_e3257cb40c2388c5523aca87d093a091",
  googleFlightsRoundTrip: "tool_6a3b3272e28d38bf72801b7437fd0eee",
  american: "tool_65883b0821eef8fd9b9ad0c1c76384d1",
  americanRoundTrip: "tool_77468f645784ce7a02e37f99b4fd8566",
  delta: "tool_8c892f491604a217ca39a4463644ec07",
  deltaRoundTrip: "tool_2721b4ebfbaea5c91f5fa2fea4beebfc",
} as const;

/** A key the fake accepts. Any other key is refused, as a revoked one would be. */
export const VALID_KEY = "pom_test_0123456789abcdefghijklmnop";

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

export const RESULTS = {
  googleFlights: () => fixture("google-flights.json"),
  delta: () => fixture("delta-award.json"),
  american: () => fixture("american-award.json"),
};

export type ToolScript = {
  /** How long the job runs, not counting time waiting on an answer. */
  runMs: number;
  /** succeeded, failed, or never finishes. */
  outcome: "succeeded" | "failed" | "never";
  result?: () => unknown;
  error?: { code: string; details?: Record<string, unknown> };
  /** The job asks the person to sign in this many ms in, and waits until answered. */
  askAfterMs?: number;
  /** The start is refused with this status and error. */
  refuse?: { status: number; code: string; details?: Record<string, unknown> };
};

export type Scenario = {
  quota?: { remaining: number; limit: number };
  tools: Record<string, ToolScript>;
};

export type LoggedRequest = { method: string; path: string; toolId?: string; jobId?: string; authorized: boolean };

type Job = {
  id: string;
  toolId: string;
  script: ToolScript;
  startedAt: number;
  cancelled: boolean;
  askedAt: number | null;
  answeredAt: number | null;
  delivered: boolean;
};

const hex = () => randomBytes(16).toString("hex");
const now = () => Date.now();

function errorBody(code: string, details: Record<string, unknown> = {}) {
  return {
    error: {
      code,
      message: `Fake API error ${code}.`,
      retryable: false,
      docs_url: `https://docs.pomerado.ai/errors#${code}`,
      details,
    },
  };
}

function midnightUtc() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)).toISOString();
}

export type FakeApi = {
  /** The API base, ending in /v1. */
  url: string;
  requests: LoggedRequest[];
  /** Answers every pending question, so waiting jobs carry on. */
  answerAll(): void;
  cancelledJobIds(): string[];
  startedJobs(): { id: string; toolId: string }[];
  close(): Promise<void>;
};

export async function startFakeApi(scenario: Scenario, port = 0): Promise<FakeApi> {
  const jobs = new Map<string, Job>();
  const requests: LoggedRequest[] = [];
  const quota = scenario.quota ?? { remaining: 87, limit: 100 };

  function statusOf(job: Job) {
    const time = now();
    if (job.cancelled) return "cancelled" as const;
    const script = job.script;
    if (script.askAfterMs !== undefined && job.askedAt === null && time - job.startedAt >= script.askAfterMs) {
      job.askedAt = job.startedAt + script.askAfterMs;
    }
    if (job.askedAt !== null && job.answeredAt === null) return "needs_input" as const;
    const paused = job.askedAt !== null && job.answeredAt !== null ? job.answeredAt - job.askedAt : 0;
    const elapsed = time - job.startedAt - paused;
    if (elapsed < Math.min(300, script.runMs)) return "queued" as const;
    if (elapsed < script.runMs || script.outcome === "never") return "running" as const;
    return script.outcome;
  }

  function jobBody(job: Job, withResult: boolean) {
    const status = statusOf(job);
    const done = status === "succeeded";
    const result = done && withResult && !job.delivered ? (job.script.result?.() ?? {}) : null;
    const resultStatus = done ? (job.delivered ? "delivered" : "available") : null;
    if (result !== null) job.delivered = true;
    return {
      id: job.id,
      type: "run",
      status,
      tool_id: job.toolId,
      input_request:
        status === "needs_input"
          ? {
              id: `req_${hex()}`,
              expires_at: new Date(now() + 10 * 60 * 1000).toISOString(),
              answer_url: `https://app.pomerado.ai/input/jobs/${randomUUID()}`,
              message: "Sign in to continue.",
              questions: [{ id: "login", prompt: "Sign in", type: "login", fields: ["username", "password"] }],
            }
          : null,
      result,
      result_status: resultStatus,
      result_expires_at: null,
      write_status: null,
      login_save: null,
      error: status === "failed" ? errorBody(job.script.error?.code ?? "execution_failed", job.script.error?.details).error : null,
      message: null,
      maintenance: null,
      build: null,
      watch_url: `https://app.pomerado.ai/jobs/${job.id}`,
      created_at: new Date(job.startedAt).toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: ["succeeded", "failed", "cancelled"].includes(status) ? new Date().toISOString() : null,
    };
  }

  const send = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "content-type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  };

  async function readBody(request: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const authorized = request.headers.authorization === `Bearer ${VALID_KEY}`;
    const entry: LoggedRequest = { method: request.method ?? "GET", path: url.pathname, authorized };
    requests.push(entry);
    if (!authorized) return send(response, 401, errorBody("unauthorized"));

    if (request.method === "GET" && url.pathname === "/v1/quota") {
      return send(response, 200, {
        as_of: new Date().toISOString(),
        tool_calls: {
          status: "ready",
          period: "day",
          period_start: new Date().toISOString(),
          resets_at: midnightUtc(),
          limit: quota.limit,
          used: quota.limit - quota.remaining,
          reserved: 0,
          remaining: quota.remaining,
        },
        integrations_created: { status: "unavailable", reason: "not_initialized" },
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/runs/read-only") {
      const body = await readBody(request);
      const toolId = String(body.tool_id ?? "");
      entry.toolId = toolId;
      const script = scenario.tools[toolId];
      if (!script) return send(response, 404, errorBody("not_found"));
      if (script.refuse) {
        const details = script.refuse.code === "quota_exceeded" ? { reset_at: midnightUtc(), ...script.refuse.details } : script.refuse.details;
        return send(response, script.refuse.status, errorBody(script.refuse.code, details));
      }
      const job: Job = {
        id: `job_${hex()}`,
        toolId,
        script,
        startedAt: now(),
        cancelled: false,
        askedAt: null,
        answeredAt: null,
        delivered: false,
      };
      jobs.set(job.id, job);
      entry.jobId = job.id;
      return send(response, 202, jobBody(job, false), { "retry-after": "1" });
    }

    const cancel = /^\/v1\/jobs\/(job_[0-9a-f]{32})\/cancel$/.exec(url.pathname);
    if (request.method === "POST" && cancel) {
      const job = jobs.get(cancel[1]!);
      entry.jobId = cancel[1];
      if (!job) return send(response, 404, errorBody("not_found"));
      if (!["succeeded", "failed"].includes(statusOf(job))) job.cancelled = true;
      return send(response, 200, jobBody(job, false));
    }

    const read = /^\/v1\/jobs\/(job_[0-9a-f]{32})$/.exec(url.pathname);
    if (request.method === "GET" && read) {
      const job = jobs.get(read[1]!);
      entry.jobId = read[1];
      if (!job) return send(response, 404, errorBody("not_found"));
      const withResult = url.searchParams.get("include_result") !== "false";
      const body = jobBody(job, withResult);
      const live = ["queued", "running", "needs_input"].includes(body.status);
      return send(response, 200, body, live ? { "retry-after": "1" } : {});
    }

    return send(response, 404, errorBody("not_found"));
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    answerAll() {
      for (const job of jobs.values()) {
        statusOf(job);
        if (job.askedAt !== null && job.answeredAt === null) job.answeredAt = now();
      }
    },
    cancelledJobIds: () => requests.filter((item) => item.path.endsWith("/cancel") && item.jobId).map((item) => item.jobId!),
    startedJobs: () => [...jobs.values()].map((job) => ({ id: job.id, toolId: job.toolId })),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
