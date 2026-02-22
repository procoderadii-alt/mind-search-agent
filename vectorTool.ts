import { ChromaClient, Collection } from "chromadb";
import { OpenAIEmbeddings } from "@langchain/openai";
import { v4 as uuidv4 } from "uuid";
import { ScrapedContent, RetrievedChunk, VectorChunk } from "../state";
import { withTracing } from "../utils/langsmith";

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE ?? "1000");
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP ?? "200");
const COLLECTION_NAME = process.env.CHROMA_COLLECTION ?? "research_findings";

let chromaClient: ChromaClient | null = null;
let collection: Collection | null = null;
let embeddings: OpenAIEmbeddings | null = null;

/**
 * Get or initialize the ChromaDB client and collection.
 */
async function getCollection(): Promise<Collection> {
  if (collection) return collection;

  chromaClient = new ChromaClient({
    path: process.env.CHROMA_URL ?? "http://localhost:8000",
  });

  // Get or create collection — idempotent
  collection = await chromaClient.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { description: "Research agent knowledge base" },
  });

  console.log(`   💾 ChromaDB collection "${COLLECTION_NAME}" ready`);
  return collection;
}

/**
 * Get or initialize the OpenAI embeddings model.
 */
function getEmbeddings(): OpenAIEmbeddings {
  if (!embeddings) {
    embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return embeddings;
}

/**
 * Split text into overlapping chunks for better RAG recall.
 */
function chunkText(
  text: string,
  chunkSize = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP
): string[] {
  const chunks: string[] = [];
  const words = text.split(/\s+/);

  for (let i = 0; i < words.length; i += chunkSize - overlap) {
    const chunk = words.slice(i, i + chunkSize).join(" ");
    if (chunk.trim().length > 50) {
      chunks.push(chunk);
    }
    if (i + chunkSize >= words.length) break;
  }

  return chunks;
}

/**
 * Store scraped content as vector chunks in ChromaDB.
 * Returns IDs of stored chunks.
 */
export const storeInVectorDB = withTracing(
  "vector_store",
  async (
    scrapedContent: ScrapedContent[],
    subQueryId: string
  ): Promise<string[]> => {
    const col = await getCollection();
    const embed = getEmbeddings();
    const storedIds: string[] = [];

    for (const page of scrapedContent) {
      if (!page.content || page.wordCount < 50) continue;

      const textChunks = chunkText(page.content);
      if (textChunks.length === 0) continue;

      // Generate embeddings for all chunks in one batch call
      const embeddingVectors = await embed.embedDocuments(textChunks);

      const ids = textChunks.map((_, i) => `${uuidv4()}_chunk_${i}`);
      const metadatas = textChunks.map((_, i) => ({
        url: page.url,
        title: page.title,
        subQueryId,
        chunkIndex: i,
      }));

      await col.add({
        ids,
        embeddings: embeddingVectors,
        documents: textChunks,
        metadatas,
      });

      storedIds.push(...ids);
    }

    return storedIds;
  }
);

/**
 * Retrieve relevant chunks from ChromaDB using semantic similarity.
 */
export const retrieveFromVectorDB = withTracing(
  "vector_retrieve",
  async (query: string, topK = 8): Promise<RetrievedChunk[]> => {
    const col = await getCollection();
    const embed = getEmbeddings();

    // Check if collection has any documents first
    const count = await col.count();
    if (count === 0) {
      console.warn("   ⚠️  Vector store is empty — no chunks to retrieve");
      return [];
    }

    // Embed the query
    const queryEmbedding = await embed.embedQuery(query);

    // Query ChromaDB
    const results = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(topK, count),
      include: ["documents", "metadatas", "distances"] as any,
    });

    if (!results.documents?.[0]) return [];

    // Convert distance to similarity score (ChromaDB uses L2 distance)
    return results.documents[0]
      .map((doc, i) => {
        const distance = results.distances?.[0]?.[i] ?? 1;
        const relevanceScore = Math.max(0, 1 - distance / 2); // Normalize L2 to [0,1]
        const metadata = results.metadatas?.[0]?.[i] as {
          url: string;
          title: string;
          subQueryId: string;
          chunkIndex: number;
        };

        return {
          content: doc ?? "",
          metadata,
          relevanceScore,
        } as RetrievedChunk;
      })
      .filter((chunk) => chunk.content.length > 20);
  }
);

/**
 * Clear the collection — useful for fresh research sessions.
 */
export async function clearVectorStore(): Promise<void> {
  try {
    const col = await getCollection();
    const ids = await col.get().then((r) => r.ids);
    if (ids.length > 0) {
      await col.delete({ ids });
    }
    console.log(`   🗑️  Cleared ${ids.length} chunks from vector store`);
  } catch {
    // Collection might not exist yet
  }
}
