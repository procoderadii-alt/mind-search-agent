import { ResearchState } from "../state";
import { storeInVectorDB } from "../tools/vectorTool";
import { NodeTimer } from "../utils/langsmith";

/**
 * VECTOR STORE NODE
 *
 * Takes freshly-scraped content and stores it in ChromaDB as
 * vector embeddings using OpenAI text-embedding-3-small.
 *
 * Each chunk is tagged with:
 *  - Source URL and title
 *  - Parent sub-query ID (for attribution)
 *  - Chunk index within the page
 *
 * This enables the RAG retrieval node to pull semantically
 * relevant passages given any query string.
 */
export async function vectorStoreNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("vector_store");

  try {
    const { scrapedContent, subQueries } = state;

    if (!scrapedContent.length) {
      console.log("   ℹ️  No new content to store — skipping");
      return { currentNode: "retrieving" };
    }

    // Group scraped content by sub-query for better metadata
    // Use a round-robin assignment if we can't determine exact mapping
    const subQueryIds = subQueries.map((sq) => sq.id);
    let totalChunks = 0;

    // Process in batches per sub-query to maintain attribution
    const batchSize = Math.ceil(scrapedContent.length / Math.max(subQueryIds.length, 1));

    for (let i = 0; i < scrapedContent.length; i += batchSize) {
      const batch = scrapedContent.slice(i, i + batchSize);
      const subQueryId = subQueryIds[Math.floor(i / batchSize)] ?? subQueryIds[0];

      console.log(
        `   💾 Storing batch ${Math.floor(i / batchSize) + 1} (${batch.length} pages) for sub-query: ${subQueryId.slice(0, 8)}...`
      );

      const chunkIds = await storeInVectorDB(batch, subQueryId);
      totalChunks += chunkIds.length;

      // Return chunk IDs so state tracks what's been stored
      if (i === 0) {
        // First batch — replace stored IDs
        state.storedChunkIds = chunkIds;
      } else {
        state.storedChunkIds = [...(state.storedChunkIds ?? []), ...chunkIds];
      }
    }

    console.log(`   📦 Stored ${totalChunks} vector chunks in ChromaDB`);
    timer.complete(`${totalChunks} chunks stored`);

    return {
      storedChunkIds: state.storedChunkIds,
      currentNode: "retrieving",
    };
  } catch (err) {
    timer.error(err);
    const message = err instanceof Error ? err.message : String(err);

    // Non-fatal: continue to retrieval even if storage partially failed
    console.warn("   ⚠️  Vector storage error (continuing):", message);
    return {
      errors: [message],
      currentNode: "retrieving",
    };
  }
}
