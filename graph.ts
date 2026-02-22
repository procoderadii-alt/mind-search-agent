import "dotenv/config";
import {
  StateGraph,
  START,
  END,
  MemorySaver,
} from "@langchain/langgraph";

import { ResearchStateAnnotation, ResearchState } from "./state";
import { reasoningNode } from "./nodes/reasoning";
import { searchNode } from "./nodes/search";
import { scraperNode } from "./nodes/scraper";
import { vectorStoreNode } from "./nodes/vectorStore";
import { retrievalNode } from "./nodes/retrieval";
import { synthesisNode } from "./nodes/synthesis";
import { humanReviewNode } from "./nodes/humanReview";

const MAX_ITERATIONS = parseInt(process.env.MAX_ITERATIONS ?? "3");

// ─────────────────────────────────────────────────────────────────────────────
// Conditional Edge Routers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * After the human review node: route to END (approved) or back to REASONING (rejected).
 * This is the CYCLE that creates the revision loop.
 */
function routeAfterHumanReview(state: ResearchState): "reasoning" | "__end__" {
  const { humanFeedback, iterationCount } = state;

  if (humanFeedback?.approved || !humanFeedback) {
    return "__end__";
  }

  // Safety valve: prevent infinite loops
  if (iterationCount >= MAX_ITERATIONS) {
    console.warn(
      `⚠️  Max iterations (${MAX_ITERATIONS}) reached — forcing completion`
    );
    return "__end__";
  }

  // Loop back to reasoning with user feedback
  return "reasoning";
}

/**
 * After an error — either retry or terminate.
 */
function routeAfterError(state: ResearchState): string {
  const { errors, currentNode } = state;
  console.error(`\n❌ Error in node "${currentNode}":`, errors.at(-1));
  return "__end__";
}

// ─────────────────────────────────────────────────────────────────────────────
// Graph Construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build and compile the research agent graph.
 *
 * Graph structure:
 *
 *   START
 *     │
 *     ▼
 *  reasoning ◄──────────────────────────────────────┐
 *     │                                              │ (rejected)
 *     ▼                                              │
 *   search                                      human_review
 *     │                                              ▲
 *     ▼                                              │
 *  scraper                                      synthesis
 *     │                                              ▲
 *     ▼                                              │
 * vector_store                                  retrieval
 *     │                                              ▲
 *     └─────────────────────────────────────────────┘
 *                                         (approved)
 *                                              │
 *                                             END
 *
 * The reasoning → synthesis → human_review → reasoning cycle
 * is the key non-trivial graph structure.
 */
export function buildResearchGraph() {
  const graph = new StateGraph(ResearchStateAnnotation);

  // ── Add Nodes ──────────────────────────────────────────────────────────────
  graph.addNode("reasoning", reasoningNode);
  graph.addNode("search", searchNode);
  graph.addNode("scraper", scraperNode);
  graph.addNode("vector_store", vectorStoreNode);
  graph.addNode("retrieval", retrievalNode);
  graph.addNode("synthesis", synthesisNode);
  graph.addNode("human_review", humanReviewNode);

  // ── Linear Edges (happy path) ──────────────────────────────────────────────
  graph.addEdge(START, "reasoning");
  graph.addEdge("reasoning", "search");
  graph.addEdge("search", "scraper");
  graph.addEdge("scraper", "vector_store");
  graph.addEdge("vector_store", "retrieval");
  graph.addEdge("retrieval", "synthesis");
  graph.addEdge("synthesis", "human_review");

  // ── Conditional Edge (the revision cycle) ─────────────────────────────────
  graph.addConditionalEdges("human_review", routeAfterHumanReview, {
    reasoning: "reasoning", // Loop back for revision
    __end__: END,           // Approved — done!
  });

  // ── Compile with Memory Checkpointer ──────────────────────────────────────
  // MemorySaver persists state across node executions, enabling:
  //  - Crash recovery
  //  - Pause/resume
  //  - State inspection at any point
  const checkpointer = new MemorySaver();

  const app = graph.compile({
    checkpointer,
    // Interrupt before human review to support async approval workflows
    interruptBefore: ["human_review"],
  });

  return app;
}

export type ResearchGraph = ReturnType<typeof buildResearchGraph>;
