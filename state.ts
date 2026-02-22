import { z } from "zod";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

// ─────────────────────────────────────────────
// Zod Schemas for structured, validated outputs
// ─────────────────────────────────────────────

export const SubQuerySchema = z.object({
  id: z.string().uuid(),
  query: z.string().min(1),
  rationale: z.string(),
  priority: z.enum(["high", "medium", "low"]),
});
export type SubQuery = z.infer<typeof SubQuerySchema>;

export const SearchResultSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  snippet: z.string(),
  score: z.number().min(0).max(1).optional(),
  publishedDate: z.string().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const ScrapedContentSchema = z.object({
  url: z.string().url(),
  title: z.string(),
  content: z.string(),
  scrapedAt: z.string().datetime(),
  wordCount: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type ScrapedContent = z.infer<typeof ScrapedContentSchema>;

export const VectorChunkSchema = z.object({
  id: z.string(),
  content: z.string(),
  metadata: z.object({
    url: z.string(),
    title: z.string(),
    subQueryId: z.string(),
    chunkIndex: z.number().int(),
  }),
  embedding: z.array(z.number()).optional(),
});
export type VectorChunk = z.infer<typeof VectorChunkSchema>;

export const RetrievedChunkSchema = z.object({
  content: z.string(),
  metadata: z.object({
    url: z.string(),
    title: z.string(),
    subQueryId: z.string(),
    chunkIndex: z.number().int(),
  }),
  relevanceScore: z.number().min(0).max(1),
});
export type RetrievedChunk = z.infer<typeof RetrievedChunkSchema>;

export const CitationSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().url(),
  title: z.string(),
  quote: z.string().optional(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const ReportSectionSchema = z.object({
  title: z.string(),
  content: z.string(),
  citations: z.array(z.number().int()),
});
export type ReportSection = z.infer<typeof ReportSectionSchema>;

export const ResearchReportSchema = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  sections: z.array(ReportSectionSchema),
  conclusions: z.string(),
  citations: z.array(CitationSchema),
  metadata: z.object({
    totalSources: z.number().int(),
    subQueriesAnswered: z.number().int(),
    generatedAt: z.string().datetime(),
    iterationCount: z.number().int(),
  }),
});
export type ResearchReport = z.infer<typeof ResearchReportSchema>;

export const HumanFeedbackSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().optional(),
  requestedChanges: z.array(z.string()).optional(),
  timestamp: z.string().datetime(),
});
export type HumanFeedback = z.infer<typeof HumanFeedbackSchema>;

export const NodeStatusSchema = z.enum([
  "idle",
  "reasoning",
  "searching",
  "scraping",
  "storing",
  "retrieving",
  "synthesizing",
  "awaiting_human",
  "complete",
  "error",
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

// ─────────────────────────────────────────────
// LangGraph State Annotation
// ─────────────────────────────────────────────

export const ResearchStateAnnotation = Annotation.Root({
  // Core conversation messages (uses built-in LangGraph reducer)
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),

  // Input
  researchQuestion: Annotation<string>({
    reducer: (_, next) => next,
    default: () => "",
  }),

  // Reasoning phase
  subQueries: Annotation<SubQuery[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // Search phase
  searchResults: Annotation<SearchResult[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),

  // Scrape phase
  scrapedContent: Annotation<ScrapedContent[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),

  // Vector store phase
  storedChunkIds: Annotation<string[]>({
    reducer: (curr, next) => [...new Set([...curr, ...next])],
    default: () => [],
  }),

  // RAG retrieval phase
  retrievedChunks: Annotation<RetrievedChunk[]>({
    reducer: (_, next) => next,
    default: () => [],
  }),

  // Synthesis phase
  draftReport: Annotation<ResearchReport | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Human-in-the-loop
  humanFeedback: Annotation<HumanFeedback | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // Flow control
  currentNode: Annotation<NodeStatus>({
    reducer: (_, next) => next,
    default: () => "idle",
  }),

  iterationCount: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),

  errors: Annotation<string[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),

  finalReport: Annotation<ResearchReport | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
});

export type ResearchState = typeof ResearchStateAnnotation.State;
