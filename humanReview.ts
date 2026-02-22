import * as readline from "readline";
import { ResearchState, HumanFeedback, HumanFeedbackSchema } from "../state";
import { PROMPTS } from "../utils/prompts";
import { NodeTimer } from "../utils/langsmith";

/**
 * Pretty-print a section of the draft report to the terminal.
 */
function displayDraftReport(state: ResearchState): void {
  const report = state.draftReport;
  if (!report) return;

  const separator = "═".repeat(70);
  const thinSep = "─".repeat(70);

  console.log(`\n${separator}`);
  console.log(`  📋 DRAFT REPORT: ${report.title}`);
  console.log(separator);

  console.log(`\n📌 EXECUTIVE SUMMARY\n${thinSep}`);
  console.log(report.executiveSummary);

  console.log(`\n📚 SECTIONS (${report.sections.length} total)\n${thinSep}`);
  report.sections.forEach((section, i) => {
    console.log(`\n  ${i + 1}. ${section.title}`);
    // Show first 400 chars of each section for review
    const preview = section.content.slice(0, 400);
    console.log(`  ${preview}${section.content.length > 400 ? "..." : ""}`);
    if (section.citations.length) {
      console.log(`  ↳ Citations: ${section.citations.map((c) => `[${c}]`).join(", ")}`);
    }
  });

  console.log(`\n💡 CONCLUSIONS\n${thinSep}`);
  console.log(report.conclusions.slice(0, 600));

  console.log(`\n📎 SOURCES (${report.citations.length} total)\n${thinSep}`);
  report.citations.slice(0, 10).forEach((c) => {
    console.log(`  [${c.id}] ${c.title}`);
    console.log(`       ${c.url}`);
  });
  if (report.citations.length > 10) {
    console.log(`  ... and ${report.citations.length - 10} more`);
  }

  console.log(`\n📊 METADATA`);
  console.log(`  • Sources: ${report.metadata.totalSources}`);
  console.log(`  • Sub-queries: ${report.metadata.subQueriesAnswered}`);
  console.log(`  • Iteration: ${report.metadata.iterationCount}`);
  console.log(`  • Generated: ${new Date(report.metadata.generatedAt).toLocaleString()}`);
  console.log(`\n${separator}\n`);
}

/**
 * Get user input from stdin (Promise-based).
 */
function getUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * HUMAN-IN-THE-LOOP NODE
 *
 * This is the critical approval checkpoint. It:
 *  1. Displays the draft report to the user in the terminal
 *  2. Asks for approval: Approve / Reject / Quit
 *  3. If rejected, prompts for specific feedback
 *  4. Returns feedback to state so the graph can loop back
 *
 * This is what enables the Approve → Reject → Revise cycle
 * in the LangGraph conditional edge routing.
 *
 * In production this could be replaced with:
 *  - A web UI form
 *  - A Slack message with buttons
 *  - An email approval workflow
 */
export async function humanReviewNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("human_review");

  try {
    const { draftReport, iterationCount } = state;

    if (!draftReport) {
      throw new Error("No draft report available for review");
    }

    // Display the draft to the human reviewer
    displayDraftReport(state);

    // Show the review prompt
    console.log(PROMPTS.HUMAN_REVIEW_HEADER(iterationCount));

    const choice = await getUserInput(PROMPTS.HUMAN_REVIEW_OPTIONS);
    const normalizedChoice = choice.toUpperCase();

    if (normalizedChoice === "Q") {
      console.log("\n👋 Research session ended by user.");
      process.exit(0);
    }

    if (normalizedChoice === "A") {
      // ✅ APPROVED — move to final output
      const feedback: HumanFeedback = HumanFeedbackSchema.parse({
        approved: true,
        feedback: "Report approved",
        timestamp: new Date().toISOString(),
      });

      console.log("\n✅ Report approved! Generating final output...\n");
      timer.complete("approved");

      return {
        humanFeedback: feedback,
        currentNode: "complete",
        finalReport: draftReport,
      };
    }

    if (normalizedChoice === "R") {
      // ❌ REJECTED — collect feedback and loop back
      console.log("\n📝 Please provide your feedback for revision:");
      const feedbackText = await getUserInput("  Feedback: ");

      const changes: string[] = [];
      console.log('\n  Add specific change requests (empty line to finish):');

      while (true) {
        const change = await getUserInput("  Change request: ");
        if (!change) break;
        changes.push(change);
      }

      const feedback: HumanFeedback = HumanFeedbackSchema.parse({
        approved: false,
        feedback: feedbackText || "Please improve the report",
        requestedChanges: changes,
        timestamp: new Date().toISOString(),
      });

      console.log("\n🔄 Sending back for revision...\n");
      timer.complete("rejected — looping back");

      return {
        humanFeedback: feedback,
        currentNode: "reasoning",
        // Clear retrieved chunks so we do a fresh retrieval with new focus
        retrievedChunks: [],
        draftReport: null,
      };
    }

    // Invalid input — treat as re-review
    console.log(`\n⚠️  Invalid choice "${choice}" — please enter A, R, or Q`);
    return humanReviewNode(state);
  } catch (err) {
    timer.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return {
      errors: [message],
      currentNode: "error",
    };
  }
}
