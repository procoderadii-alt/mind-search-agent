import { ResearchState, SearchResult } from "../state";
import { executeSearch } from "../tools/searchTool";
import { NodeTimer } from "../utils/langsmith";

const MAX_RESULTS_PER_QUERY = parseInt(process.env.MAX_SEARCH_RESULTS ?? "5");

/**
 * SEARCH NODE
 *
 * Iterates over all sub-queries and executes web searches via Tavily.
 * Results are deduplicated by URL and accumulated into state.
 *
 * On revision iterations, only searches for NEW sub-queries
 * to avoid redundant API calls.
 */
export async function searchNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("search");

  try {
    const { subQueries, searchResults: existingResults } = state;

    if (!subQueries.length) {
      throw new Error("No sub-queries available for search");
    }

    // Track already-searched URLs to avoid duplicates
    const existingUrls = new Set(existingResults.map((r) => r.url));

    const allNewResults: SearchResult[] = [];

    // Search for sub-queries in priority order: high → medium → low
    const prioritized = [...subQueries].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.priority] - order[b.priority];
    });

    for (const subQuery of prioritized) {
      try {
        console.log(`   🔎 [${subQuery.priority.toUpperCase()}] "${subQuery.query}"`);
        const results = await executeSearch(subQuery.query, MAX_RESULTS_PER_QUERY);

        // Deduplicate against existing and current batch
        const newResults = results.filter((r) => !existingUrls.has(r.url));
        newResults.forEach((r) => existingUrls.add(r.url));
        allNewResults.push(...newResults);

        console.log(`     → ${newResults.length} new results (${results.length - newResults.length} dupes skipped)`);

        // Small delay to be respectful of rate limits
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (searchErr) {
        const message = searchErr instanceof Error ? searchErr.message : String(searchErr);
        console.warn(`   ⚠️  Search failed for "${subQuery.query}": ${message}`);
      }
    }

    console.log(`   📊 Total new search results: ${allNewResults.length}`);
    timer.complete(`${allNewResults.length} results across ${subQueries.length} queries`);

    return {
      searchResults: allNewResults,
      currentNode: "scraping",
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
