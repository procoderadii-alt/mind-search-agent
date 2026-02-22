import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { ResearchState, SubQuery, SubQuerySchema } from "../state";
import { PROMPTS } from "../utils/prompts";
import { NodeTimer } from "../utils/langsmith";
import { z } from "zod";

const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.3,
  apiKey: process.env.OPENAI_API_KEY,
});

const DecomposeResponseSchema = z.object({
  subQueries: z.array(SubQuerySchema),
});

/**
 * REASONING NODE
 *
 * Takes the user's research question and breaks it into 3-6
 * focused sub-queries using an LLM. Each sub-query gets:
 *  - A unique UUID
 *  - A rationale explaining why it's relevant
 *  - A priority level (high / medium / low)
 *
 * This is the first node in the graph.
 */
export async function reasoningNode(
  state: ResearchState
): Promise<Partial<ResearchState>> {
  const timer = new NodeTimer("reasoning");

  try {
    const { researchQuestion, humanFeedback, iterationCount } = state;

    if (!researchQuestion?.trim()) {
      throw new Error("Research question is required but was empty");
    }

    // On revision iterations, incorporate feedback into the decomposition
    const feedbackContext =
      humanFeedback && !humanFeedback.approved
        ? `\n\nNote: This is revision iteration ${iterationCount + 1}. User feedback: "${humanFeedback.feedback}". 
           Adjust sub-queries to address the feedback.`
        : "";

    const messages = [
      new SystemMessage(PROMPTS.DECOMPOSE_SYSTEM),
      new HumanMessage(
        PROMPTS.DECOMPOSE_USER(researchQuestion) + feedbackContext
      ),
    ];

    const response = await llm.invoke(messages);
    const content = response.content as string;

    // Parse and validate the structured output
    let parsed: { subQueries: SubQuery[] };
    try {
      const raw = JSON.parse(content.trim());
      parsed = DecomposeResponseSchema.parse(raw);
    } catch (parseErr) {
      // Attempt to extract JSON from potential markdown wrapping
      const jsonMatch = content.match(/```json\n?([\s\S]*?)\n?```/) ||
                        content.match(/({[\s\S]*})/);
      if (!jsonMatch) throw new Error(`LLM returned non-JSON: ${content.slice(0, 200)}`);
      const raw = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      parsed = DecomposeResponseSchema.parse(raw);
    }

    // Ensure all sub-queries have valid UUIDs
    const subQueries: SubQuery[] = parsed.subQueries.map((sq) => ({
      ...sq,
      id: sq.id || uuidv4(),
    }));

    console.log(`   📋 Generated ${subQueries.length} sub-queries:`);
    subQueries.forEach((sq, i) => {
      console.log(`     ${i + 1}. [${sq.priority.toUpperCase()}] ${sq.query}`);
    });

    timer.complete(`${subQueries.length} sub-queries generated`);

    return {
      subQueries,
      currentNode: "searching",
      iterationCount: iterationCount + 1,
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
