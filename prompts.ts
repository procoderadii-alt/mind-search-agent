/**
 * All system and user prompts used by the research agent.
 * Centralizing them here makes evaluation and iteration easy.
 */

export const PROMPTS = {
  // ── Reasoning Node ──────────────────────────────────────────────────────────
  DECOMPOSE_SYSTEM: `You are an expert research strategist. Your job is to decompose a complex research question into a set of focused, non-overlapping sub-queries that together provide comprehensive coverage of the topic.

Rules:
- Generate 3-6 sub-queries
- Each sub-query must be specific and searchable
- Prioritize based on importance to the main question
- Avoid redundancy between sub-queries
- Return ONLY valid JSON — no markdown fences, no explanation`,

  DECOMPOSE_USER: (question: string) => `Research question: "${question}"

Return a JSON object with this exact schema:
{
  "subQueries": [
    {
      "id": "<uuid v4>",
      "query": "<specific search query>",
      "rationale": "<why this sub-query matters>",
      "priority": "high" | "medium" | "low"
    }
  ]
}`,

  // ── Synthesis Node ───────────────────────────────────────────────────────────
  SYNTHESIZE_SYSTEM: `You are an expert research analyst and technical writer. Your job is to synthesize retrieved source material into a structured, rigorous, and well-cited research report.

Guidelines:
- Write in a clear, professional tone
- Every factual claim must reference a citation by its ID number [1], [2], etc.
- The executive summary should be 2-3 paragraphs
- Each section should be 3-5 paragraphs with inline citations
- Conclusions should highlight key insights and open questions
- Return ONLY valid JSON — no markdown fences, no preamble`,

  SYNTHESIZE_USER: (
    question: string,
    chunks: string,
    citationMap: string,
    feedback?: string
  ) => `Original research question: "${question}"

${feedback ? `⚠️ REVISION REQUESTED — User feedback: "${feedback}"\nPlease address this feedback in the revised report.\n\n` : ""}
Available citations:
${citationMap}

Retrieved research content:
${chunks}

Return a JSON object with this exact schema:
{
  "title": "<descriptive report title>",
  "executiveSummary": "<2-3 paragraph summary>",
  "sections": [
    {
      "title": "<section title>",
      "content": "<section body with inline citations like [1], [2]>",
      "citations": [<array of citation ID numbers used>]
    }
  ],
  "conclusions": "<key insights and next steps>",
  "citations": [
    {
      "id": <number>,
      "url": "<source url>",
      "title": "<source title>",
      "quote": "<optional key quote>"
    }
  ],
  "metadata": {
    "totalSources": <number>,
    "subQueriesAnswered": <number>,
    "generatedAt": "<ISO datetime>",
    "iterationCount": <number>
  }
}`,

  // ── Human Review Prompt ──────────────────────────────────────────────────────
  HUMAN_REVIEW_HEADER: (iterationCount: number) =>
    `\n${"─".repeat(60)}\n🔍 HUMAN REVIEW — Iteration #${iterationCount}\n${"─".repeat(60)}\n`,

  HUMAN_REVIEW_OPTIONS: `
Options:
  [A] Approve — generate final report
  [R] Reject  — provide feedback for revision
  [Q] Quit    — exit without generating report

Your choice (A/R/Q): `,
};
