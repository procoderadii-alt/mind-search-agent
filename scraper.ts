import { ResearchState } from "../state";
import { scrapeUrls } from "../tools/scraperTool";
import { NodeTimer } from "../utils/langsmith";

const MAX_URLS_TO_SCRAPE = 15;
const CONCURRENCY = 3;

/**
 * SCRAPER NODE
 *
 * Takes the top search results (by relevance score) and scrapes
 * their full text content using Cheerio.
 *
 * Filters out previously-scraped URLs on revision iterations
 * to avoid re-storing duplicate content.
 */
export async function scraperNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("scraper");

  try {
    const { searchResults, scrapedContent: existingContent } = state;

    if (!searchResults.length) {
      throw new Error("No search results to scrape");
    }

    // Track already-scraped URLs
    const scrapedUrls = new Set(existingContent.map((c) => c.url));

    // Sort by Tavily relevance score, take top N, skip already-scraped
    const urlsToScrape = [...searchResults]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .filter((r) => !scrapedUrls.has(r.url))
      .slice(0, MAX_URLS_TO_SCRAPE)
      .map((r) => r.url);

    if (!urlsToScrape.length) {
      console.log("   ℹ️  All URLs already scraped — skipping");
      return { currentNode: "storing" };
    }

    console.log(`   📄 Scraping ${urlsToScrape.length} URLs (concurrency: ${CONCURRENCY})`);

    const newContent = await scrapeUrls(urlsToScrape, CONCURRENCY);

    const successful = newContent.filter((c) => !c.error && c.wordCount > 50);
    const failed = urlsToScrape.length - successful.length;

    console.log(`   ✅ Success: ${successful.length} pages | ❌ Failed: ${failed} pages`);
    console.log(`   📝 Total words scraped: ${successful.reduce((sum, c) => sum + c.wordCount, 0).toLocaleString()}`);

    timer.complete(`${successful.length}/${urlsToScrape.length} pages scraped`);

    return {
      scrapedContent: successful,
      currentNode: "storing",
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
