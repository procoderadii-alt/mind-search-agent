import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SearchResult, SearchResultSchema } from "../state";
import { withTracing } from "../utils/langsmith";

const TAVILY_API_URL = "https://api.tavily.com/search";

interface TavilyResult {
  url: string;
  title: string;
  content: string;
  score: number;
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
  query: string;
  answer?: string;
}

/**
 * Raw Tavily API call — separated for testability and tracing.
 */
const tavilySearch = withTracing(
  "tavily_search",
  async (query: string, maxResults = 5): Promise<SearchResult[]> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error("TAVILY_API_KEY is not set in environment variables");
    }

    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: maxResults,
        include_answer: false,
        include_raw_content: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Tavily API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as TavilyResponse;

    // Validate and normalize results
    return data.results.map((r) =>
      SearchResultSchema.parse({
        url: r.url,
        title: r.title || "Untitled",
        snippet: r.content?.slice(0, 500) || "",
        score: r.score,
        publishedDate: r.published_date,
      })
    );
  }
);

/**
 * LangChain tool wrapper for web search via Tavily.
 * This is what the agent tool node calls.
 */
export const webSearchTool = tool(
  async ({ query, maxResults }): Promise<string> => {
    console.log(`   🔎 Searching: "${query}"`);
    const results = await tavilySearch(query, maxResults);
    console.log(`   → Found ${results.length} results`);
    return JSON.stringify(results);
  },
  {
    name: "web_search",
    description:
      "Search the web for information using the Tavily search API. Returns a list of relevant web pages with titles, URLs, and content snippets.",
    schema: z.object({
      query: z.string().describe("The search query to execute"),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe("Maximum number of results to return"),
    }),
  }
);

/**
 * Direct search function for use in graph nodes (not as an agent tool).
 */
export async function executeSearch(
  query: string,
  maxResults?: number
): Promise<SearchResult[]> {
  return tavilySearch(
    query,
    maxResults ?? parseInt(process.env.MAX_SEARCH_RESULTS ?? "5")
  );
}
