import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { ResearchState, ResearchReport, ResearchReportSchema, Citation } from "../state";
import { PROMPTS } from "../utils/prompts";
import { NodeTimer } from "../utils/langsmith";

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.4,
  apiKey: process.env.OPENAI_API_KEY,
  maxTokens: 4000,
});

/**
 * Build a citation map from retrieved chunks.
 * Deduplicates by URL so each source gets one citation ID.
 */
function buildCitationMap(
  state: ResearchState
): { citations: Citation[]; citationText: string } {
  const urlToCitation = new Map<string, Citation>();
  let nextId = 1;

  for (const chunk of state.retrievedChunks) {
    const { url, title } = chunk.metadata;
    if (!urlToCitation.has(url)) {
      urlToCitation.set(url, {
        id: nextId++,
        url,
        title,
      });
    }
  }

  // Also include search results that weren't retrieved but were scraped
  for (const result of state.searchResults.slice(0, 20)) {
    if (!urlToCitation.has(result.url)) {
      urlToCitation.set(result.url, {
        id: nextId++,
        url: result.url,
        title: result.title,
      });
    }
  }

  const citations = Array.from(urlToCitation.values());
  const citationText = citations
    .map((c) => `[${c.id}] ${c.title} — ${c.url}`)
    .join("\n");

  return { citations, citationText };
}

/**
 * Format retrieved chunks for the LLM prompt.
 */
function formatChunksForPrompt(state: ResearchState, citations: Citation[]): string {
  const urlToId = new Map(citations.map((c) => [c.url, c.id]));

  return state.retrievedChunks
    .slice(0, 15) // Limit to prevent token overflow
    .map((chunk) => {
      const citId = urlToId.get(chunk.metadata.url) ?? "?";
      return `[Source ${citId}] "${chunk.metadata.title}" (relevance: ${chunk.relevanceScore.toFixed(2)}):\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

/**
 * SYNTHESIS NODE
 *
 * Uses GPT-4o-mini to generate a fully-structured research report
 * from the retrieved vector chunks. The report includes:
 *  - Executive summary
 *  - Multiple thematic sections with inline citations
 *  - Conclusions and next steps
 *  - Full citation list
 *
 * On revision iterations, the human's feedback is injected
 * into the prompt so the LLM can address specific concerns.
 */
export async function synthesisNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("synthesis");

  try {
    const { researchQuestion, retrievedChunks, humanFeedback, iterationCount, subQueries } = state;

    if (!retrievedChunks.length) {
      throw new Error("No retrieved chunks available for synthesis");
    }

    const { citations, citationText } = buildCitationMap(state);
    const chunkText = formatChunksForPrompt(state, citations);

    const feedbackText =
      humanFeedback && !humanFeedback.approved ? humanFeedback.feedback : undefined;

    const messages = [
      new SystemMessage(PROMPTS.SYNTHESIZE_SYSTEM),
      new HumanMessage(
        PROMPTS.SYNTHESIZE_USER(researchQuestion, chunkText, citationText, feedbackText)
      ),
    ];

    console.log(`   📝 Synthesizing report from ${retrievedChunks.length} chunks, ${citations.length} citations`);

    const response = await llm.invoke(messages);
    const content = response.content as string;

    // Parse the structured JSON report
    let report: ResearchReport;
    try {
      const raw = JSON.parse(content.trim());
      report = ResearchReportSchema.parse(raw);
    } catch {
      // Try to extract JSON from markdown wrapping
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/({[\s\S]*})/);
      if (!jsonMatch) {
        throw new Error(`LLM returned non-JSON report: ${content.slice(0, 300)}`);
      }
      const raw = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      report = ResearchReportSchema.parse(raw);
    }

    // Ensure metadata is accurate
    report.metadata = {
      ...report.metadata,
      totalSources: citations.length,
      subQueriesAnswered: subQueries.length,
      generatedAt: new Date().toISOString(),
      iterationCount,
    };

    // Ensure citations list is correct
    report.citations = citations;

    console.log(`   📄 Report generated: "${report.title}"`);
    console.log(`   📑 ${report.sections.length} sections | ${report.citations.length} citations`);
    timer.complete();

    return {
      draftReport: report,
      currentNode: "awaiting_human",
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
