#!/usr/bin/env ts-node
import "dotenv/config";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

import { buildResearchGraph } from "./graph";
import { ResearchReport } from "./state";
import { clearVectorStore } from "./tools/vectorTool";
import { getLangSmithClient } from "./utils/langsmith";

// ─────────────────────────────────────────────────────────────────────────────
// Startup Banner
// ─────────────────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           🔬  DEEP RESEARCH AGENT  v1.0.0                    ║
║                                                               ║
║  Powered by: LangGraph.js · OpenAI · Tavily · ChromaDB       ║
║  Tracing:    LangSmith                                        ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateEnvironment(): void {
  const required = ["OPENAI_API_KEY", "TAVILY_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length) {
    console.error("❌ Missing required environment variables:");
    missing.forEach((key) => console.error(`   • ${key}`));
    console.error("\nCopy .env.example to .env and fill in your API keys.");
    process.exit(1);
  }

  console.log("✅ Environment validated");

  // Initialize LangSmith (optional — warns if not configured)
  getLangSmithClient();
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Rendering
// ─────────────────────────────────────────────────────────────────────────────

function renderReportAsMarkdown(report: ResearchReport): string {
  const lines: string[] = [];

  lines.push(`# ${report.title}`);
  lines.push("");
  lines.push(`> Generated: ${new Date(report.metadata.generatedAt).toLocaleString()}`);
  lines.push(`> Sources: ${report.metadata.totalSources} | Iterations: ${report.metadata.iterationCount}`);
  lines.push("");

  lines.push("## Executive Summary");
  lines.push("");
  lines.push(report.executiveSummary);
  lines.push("");

  report.sections.forEach((section) => {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.content);
    lines.push("");
  });

  lines.push("## Conclusions");
  lines.push("");
  lines.push(report.conclusions);
  lines.push("");

  lines.push("## References");
  lines.push("");
  report.citations.forEach((c) => {
    lines.push(`${c.id}. [${c.title}](${c.url})`);
    if (c.quote) lines.push(`   > "${c.quote}"`);
  });

  return lines.join("\n");
}

function saveReport(report: ResearchReport, outputDir = "./output"): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = report.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 50);

  const jsonPath = path.join(outputDir, `${timestamp}-${slug}.json`);
  const mdPath = path.join(outputDir, `${timestamp}-${slug}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  fs.writeFileSync(mdPath, renderReportAsMarkdown(report), "utf-8");

  console.log(`\n💾 Report saved:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Markdown: ${mdPath}`);

  return mdPath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive Prompt
// ─────────────────────────────────────────────────────────────────────────────

async function getResearchQuestion(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n🔬 Enter your research question:\n> ",
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

async function confirmClearVectorStore(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(
      "\n🗑️  Clear existing vector store? (Y/n): ",
      (answer) => {
        rl.close();
        resolve(answer.trim().toUpperCase() !== "N");
      }
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printBanner();
  validateEnvironment();

  // Get research question from CLI arg or interactive prompt
  let researchQuestion = process.argv[2];
  if (!researchQuestion) {
    researchQuestion = await getResearchQuestion();
  }

  if (!researchQuestion?.trim()) {
    console.error("❌ Research question cannot be empty");
    process.exit(1);
  }

  console.log(`\n📝 Research question: "${researchQuestion}"`);

  // Optionally clear the vector store for a fresh session
  const shouldClear = await confirmClearVectorStore();
  if (shouldClear) {
    await clearVectorStore();
  }

  // Build the LangGraph
  const app = buildResearchGraph();

  // Unique thread ID for this research session
  // (enables checkpointing / resume)
  const threadId = uuidv4();
  const config = {
    configurable: { thread_id: threadId },
    recursionLimit: 50, // Safety limit on graph steps
  };

  console.log(`\n🆔 Session ID: ${threadId}`);
  console.log("🚀 Starting research pipeline...\n");

  const startTime = Date.now();

  try {
    // Run the graph until it hits the human_review interrupt
    // The graph is configured with interruptBefore: ["human_review"]
    // so it pauses automatically for human input
    let state = await app.invoke(
      {
        researchQuestion,
        messages: [],
      },
      config
    );

    // ── Human-in-the-loop Loop ────────────────────────────────────────────────
    // After the interrupt, we manually drive the human_review node
    // and continue the graph until final approval.
    while (state.currentNode !== "complete" && state.finalReport === null) {
      // Run the human review node manually
      const humanReviewModule = await import("./nodes/humanReview");
      const reviewResult = await humanReviewModule.humanReviewNode(state as any);
      
      // Update state with review result
      Object.assign(state, reviewResult);

      if (state.humanFeedback?.approved || state.currentNode === "complete") {
        break;
      }

      if (state.currentNode === "reasoning") {
        // Loop back — resume the graph from reasoning
        console.log("\n🔄 Resuming graph with revision...\n");
        state = await app.invoke(state as any, config);
      }
    }

    // ── Final Output ──────────────────────────────────────────────────────────
    const finalReport = state.finalReport ?? state.draftReport;

    if (!finalReport) {
      console.error("❌ No report was generated");
      process.exit(1);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Research complete in ${elapsed}s!`);

    saveReport(finalReport);

    // Print final stats
    console.log("\n📊 FINAL STATISTICS");
    console.log(`   • Sub-queries: ${state.subQueries?.length ?? 0}`);
    console.log(`   • URLs searched: ${state.searchResults?.length ?? 0}`);
    console.log(`   • Pages scraped: ${state.scrapedContent?.length ?? 0}`);
    console.log(`   • Vector chunks: ${state.storedChunkIds?.length ?? 0}`);
    console.log(`   • Retrieved chunks: ${state.retrievedChunks?.length ?? 0}`);
    console.log(`   • Citations: ${finalReport.citations.length}`);
    console.log(`   • Iterations: ${finalReport.metadata.iterationCount}`);

    if (state.errors?.length) {
      console.log(`\n⚠️  ${state.errors.length} non-fatal errors occurred:`);
      state.errors.forEach((e) => console.log(`   • ${e}`));
    }
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n❌ Fatal error after ${elapsed}s:`, err);
    process.exit(1);
  }
}

main().catch(console.error);
