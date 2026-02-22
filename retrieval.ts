import { ResearchState, RetrievedChunk } from "../state";
import { retrieveFromVectorDB } from "../tools/vectorTool";
import { NodeTimer } from "../utils/langsmith";

const TOP_K_PER_QUERY = 5;
const MAX_TOTAL_CHUNKS = 20;

/**
 * RAG RETRIEVAL NODE
 *
 * Performs semantic search over the ChromaDB vector store to find
 * the most relevant passages for synthesis.
 *
 * Strategy:
 *  1. Query once with the full research question
 *  2. Query once per high-priority sub-query
 *  3. Deduplicate and rank by relevance score
 *  4. Return top N chunks for the synthesis node
 */
export async function retrievalNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("retrieval");

  try {
    const { researchQuestion, subQueries, humanFeedback } = state;

    // Build retrieval queries
    const queries: string[] = [
      researchQuestion, // Broad query first
      ...subQueries
        .filter((sq) => sq.priority === "high")
        .map((sq) => sq.query),
      ...subQueries
        .filter((sq) => sq.priority === "medium")
        .slice(0, 2)
        .map((sq) => sq.query),
    ];

    // On revision, also add feedback as a retrieval query
    if (humanFeedback?.feedback) {
      queries.push(humanFeedback.feedback);
    }

    console.log(`   🔍 Executing ${queries.length} retrieval queries`);

    // Execute all retrievals in parallel
    const allResults = await Promise.all(
      queries.map((q) => retrieveFromVectorDB(q, TOP_K_PER_QUERY))
    );

    // Flatten, deduplicate by content hash, and rank
    const seen = new Set<string>();
    const dedupedChunks: RetrievedChunk[] = [];

    for (const results of allResults) {
      for (const chunk of results) {
        // Simple dedup key: first 100 chars of content
        const key = chunk.content.slice(0, 100).trim();
        if (!seen.has(key) && chunk.content.length > 50) {
          seen.add(key);
          dedupedChunks.push(chunk);
        }
      }
    }

    // Sort by relevance score descending and take top N
    const topChunks = dedupedChunks
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, MAX_TOTAL_CHUNKS);

    console.log(
      `   📚 Retrieved ${topChunks.length} unique chunks (from ${dedupedChunks.length} total)`
    );
    console.log(
      `   📊 Relevance scores: min=${topChunks.at(-1)?.relevanceScore.toFixed(3)} max=${topChunks[0]?.relevanceScore.toFixed(3)}`
    );

    timer.complete(`${topChunks.length} chunks retrieved`);

    return {
      retrievedChunks: topChunks,
      currentNode: "synthesizing",
    };
  } catch (err) {
    timer.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [message],
      currentNode: "error",
    };
  }
}
