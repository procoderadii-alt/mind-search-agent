import { Client } from "langsmith";
import { traceable } from "langsmith/traceable";

let langsmithClient: Client | null = null;

/**
 * Initialize the LangSmith client for tracing and evaluation.
 * Automatically picks up LANGCHAIN_API_KEY and LANGCHAIN_PROJECT from env.
 */
export function getLangSmithClient(): Client | null {
  if (!process.env.LANGCHAIN_API_KEY) {
    console.warn("⚠️  LANGCHAIN_API_KEY not set — LangSmith tracing disabled");
    return null;
  }

  if (!langsmithClient) {
    langsmithClient = new Client({
      apiKey: process.env.LANGCHAIN_API_KEY,
      apiUrl: process.env.LANGCHAIN_ENDPOINT ?? "https://api.smith.langchain.com",
    });
    console.log(`✅ LangSmith tracing enabled → Project: ${process.env.LANGCHAIN_PROJECT}`);
  }

  return langsmithClient;
}

/**
 * Wraps any async function with LangSmith tracing.
 * Logs inputs, outputs, latency, and errors automatically.
 */
export function withTracing<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => Promise<TReturn>,
  metadata?: Record<string, unknown>
): (...args: TArgs) => Promise<TReturn> {
  if (!process.env.LANGCHAIN_TRACING_V2) {
    return fn;
  }

  return traceable(fn, {
    name,
    metadata: {
      project: process.env.LANGCHAIN_PROJECT ?? "deep-research-agent",
      ...metadata,
    },
  }) as (...args: TArgs) => Promise<TReturn>;
}

/**
 * Log evaluation metrics to LangSmith.
 */
export async function logEvaluation(params: {
  runId: string;
  key: string;
  score: number;
  comment?: string;
}): Promise<void> {
  const client = getLangSmithClient();
  if (!client) return;

  try {
    await client.createFeedback(params.runId, params.key, {
      score: params.score,
      comment: params.comment,
    });
    console.log(`📊 LangSmith eval logged: ${params.key} = ${params.score}`);
  } catch (err) {
    console.warn("Failed to log LangSmith evaluation:", err);
  }
}

/**
 * Pretty-print node execution timing for local dev.
 */
export class NodeTimer {
  private startTime: number;
  private nodeName: string;

  constructor(nodeName: string) {
    this.nodeName = nodeName;
    this.startTime = Date.now();
    console.log(`\n⚙️  [${nodeName}] Starting...`);
  }

  complete(details?: string): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const suffix = details ? ` — ${details}` : "";
    console.log(`✅ [${this.nodeName}] Done in ${elapsed}s${suffix}`);
  }

  error(err: unknown): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    console.error(`❌ [${this.nodeName}] Failed after ${elapsed}s:`, err);
  }
}
