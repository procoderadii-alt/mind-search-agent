import { tool } from "@langchain/core/tools";
import { z } from "zod";
import * as cheerio from "cheerio";
import { ScrapedContent, ScrapedContentSchema } from "../state";
import { withTracing } from "../utils/langsmith";

const SCRAPE_TIMEOUT_MS = 10_000;
const MAX_CONTENT_CHARS = 8_000;

// Selectors for content and noise
const CONTENT_SELECTORS = ["article", "main", ".content", ".post", ".article", "section"];
const NOISE_SELECTORS = [
  "script",
  "style",
  "nav",
  "header",
  "footer",
  "aside",
  ".sidebar",
  ".ads",
  ".advertisement",
  ".cookie",
  ".popup",
  ".modal",
  "noscript",
  "iframe",
];

/**
 * Scrape a URL and extract clean text content using Cheerio.
 */
const scrapeUrl = withTracing(
  "scrape_url",
  async (url: string): Promise<ScrapedContent> => {
    const scrapedAt = new Date().toISOString();

    try {
      // Validate URL first
      new URL(url);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ResearchAgent/1.0; +https://example.com/bot)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return ScrapedContentSchema.parse({
          url,
          title: "Error",
          content: "",
          scrapedAt,
          wordCount: 0,
          error: `HTTP ${response.status}: ${response.statusText}`,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html")) {
        return ScrapedContentSchema.parse({
          url,
          title: "Non-HTML Content",
          content: "",
          scrapedAt,
          wordCount: 0,
          error: `Unsupported content type: ${contentType}`,
        });
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Remove noise elements
      NOISE_SELECTORS.forEach((sel) => $(sel).remove());

      // Extract title
      const title =
        $("meta[property='og:title']").attr("content") ||
        $("title").text().trim() ||
        $("h1").first().text().trim() ||
        "Untitled";

      // Try to find main content
      let content = "";
      for (const selector of CONTENT_SELECTORS) {
        const el = $(selector).first();
        if (el.length && el.text().trim().length > 200) {
          content = el.text();
          break;
        }
      }

      // Fallback to body if no main content block found
      if (!content) {
        content = $("body").text();
      }

      // Normalize whitespace
      content = content
        .replace(/\s+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, MAX_CONTENT_CHARS);

      const wordCount = content.split(/\s+/).filter(Boolean).length;

      return ScrapedContentSchema.parse({
        url,
        title: title.slice(0, 200),
        content,
        scrapedAt,
        wordCount,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return ScrapedContentSchema.parse({
        url,
        title: "Scrape Error",
        content: "",
        scrapedAt,
        wordCount: 0,
        error: message.slice(0, 500),
      });
    }
  }
);

/**
 * Scrape multiple URLs in parallel with concurrency control.
 */
export async function scrapeUrls(
  urls: string[],
  concurrency = 3
): Promise<ScrapedContent[]> {
  const results: ScrapedContent[] = [];

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((url) => scrapeUrl(url)));
    results.push(...batchResults);
    console.log(`   → Scraped batch ${Math.ceil((i + 1) / concurrency)}: ${batch.length} URLs`);
  }

  // Filter out failed scrapes
  return results.filter((r) => !r.error && r.wordCount > 50);
}

/**
 * LangChain tool wrapper for the scraper.
 */
export const scraperTool = tool(
  async ({ url }): Promise<string> => {
    console.log(`   📄 Scraping: ${url}`);
    const result = await scrapeUrl(url);
    if (result.error) {
      return JSON.stringify({ error: result.error, url });
    }
    return JSON.stringify({
      url: result.url,
      title: result.title,
      content: result.content.slice(0, 2000), // Truncate for tool output
      wordCount: result.wordCount,
    });
  },
  {
    name: "scrape_webpage",
    description:
      "Scrape a webpage URL and extract its text content. Returns the page title, content, and word count.",
    schema: z.object({
      url: z.string().url().describe("The URL to scrape"),
    }),
  }
);
