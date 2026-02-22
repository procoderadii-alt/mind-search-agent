# 🔬 DeepResearch Agent

> A stateful multi-agent research assistant built with LangGraph.js, demonstrating production-grade agentic AI architecture.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    LANGGRAPH STATE MACHINE                      │
│                                                                 │
│  User Input                                                     │
│      │                                                          │
│      ▼                                                          │
│  ┌─────────┐     ┌────────┐     ┌─────────┐     ┌───────────┐  │
│  │Reasoning│────▶│ Search │────▶│ Scraper │────▶│  Vector   │  │
│  │  Node   │     │  Node  │     │  Node   │     │   Store   │  │
│  └─────────┘     └────────┘     └─────────┘     └───────────┘  │
│       ▲                                               │         │
│       │ (rejected)                                    ▼         │
│       │                                        ┌──────────┐    │
│       │                                        │ Retrieval│    │
│       │                                        │  Node    │    │
│       │                                        └──────────┘    │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐       │         │
│  │  Human   │◀───│ Human   │◀───│Synthesis │◀──────┘         │
│  │ Feedback │    │  Review  │    │  Node    │                  │
│  │  Loop    │    │  Node   │    └──────────┘                  │
│  └──────────┘    └─────────┘                                   │
│                       │ (approved)                             │
│                       ▼                                         │
│                   Final Report                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## How It Satisfies Every JD Requirement

| JD Requirement | Implementation |
|---|---|
| **LangGraph.js non-trivial project** | 7-node graph with cycles, conditionals, and MemorySaver checkpointing |
| **Graph architecture with cycles** | `human_review → reasoning` conditional edge creates the revision loop |
| **Agent tooling** | `webSearchTool` (Tavily), `scraperTool` (Cheerio), `vectorTool` (ChromaDB) |
| **State management** | `ResearchStateAnnotation` with typed reducers + `MemorySaver` checkpointer |
| **Human-in-the-loop** | `humanReviewNode` with `interruptBefore` + approve/reject/feedback flow |
| **LangSmith evaluation** | `withTracing()` wraps every tool; all node runs traced with latency + tokens |
| **Structured outputs (Zod)** | 9 Zod schemas validate every node's input/output (`ResearchReportSchema`, etc.) |
| **RAG mastery** | ChromaDB vector store + `text-embedding-3-small` + semantic retrieval |
| **Node.js / TypeScript** | 100% TypeScript with strict mode, async/await throughout |

---

## Tech Stack

| Tool | Purpose |
|---|---|
| **LangGraph.js** `@langchain/langgraph` | Graph orchestration, state, cycles, checkpointing |
| **LangChain.js** `@langchain/core` | LLM abstraction, tool wrappers, messages |
| **OpenAI GPT-4o-mini** | LLM for reasoning and synthesis |
| **OpenAI text-embedding-3-small** | Vector embeddings for RAG |
| **Tavily API** | Web search (free tier: 1,000 searches/month) |
| **Cheerio** | Lightweight HTML scraping (no headless browser) |
| **ChromaDB** | Local vector database for RAG |
| **LangSmith** | Distributed tracing + evaluation |
| **Zod** | Runtime schema validation for all node I/O |

---

## Project Structure

```
deep-research-agent/
├── src/
│   ├── index.ts              # Entry point + CLI
│   ├── graph.ts              # LangGraph graph definition + routing
│   ├── state.ts              # Zod schemas + LangGraph state annotation
│   ├── nodes/
│   │   ├── reasoning.ts      # Decomposes question into sub-queries
│   │   ├── search.ts         # Tavily web search execution
│   │   ├── scraper.ts        # Cheerio HTML scraping
│   │   ├── vectorStore.ts    # ChromaDB storage + chunking
│   │   ├── retrieval.ts      # Semantic RAG retrieval
│   │   ├── synthesis.ts      # Structured report generation
│   │   └── humanReview.ts    # 🔑 Human-in-the-loop checkpoint
│   ├── tools/
│   │   ├── searchTool.ts     # Tavily tool (raw + LangChain wrapper)
│   │   ├── scraperTool.ts    # Cheerio tool (raw + LangChain wrapper)
│   │   └── vectorTool.ts     # ChromaDB store + retrieve functions
│   └── utils/
│       ├── langsmith.ts      # Tracing, evaluation, timing utilities
│       └── prompts.ts        # All LLM prompts centralized
├── output/                   # Generated reports (JSON + Markdown)
├── .env.example              # Environment variable template
├── package.json
├── tsconfig.json
└── README.md
```

---

## Quick Start

### 1. Prerequisites

```bash
node --version   # v18.0.0+
npm --version    # v9.0.0+

# ChromaDB (runs locally as a Docker container)
docker run -p 8000:8000 chromadb/chroma
```

### 2. Installation

```bash
git clone <repo>
cd deep-research-agent
npm install
```

### 3. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your API keys:

```env
OPENAI_API_KEY=sk-...           # Required
TAVILY_API_KEY=tvly-...         # Required (free tier at tavily.com)
LANGCHAIN_API_KEY=ls__...       # Optional (LangSmith tracing)
LANGCHAIN_TRACING_V2=true       # Optional
LANGCHAIN_PROJECT=deep-research # Optional
```

### 4. Run

```bash
# Interactive mode (prompts for research question)
npm run dev

# CLI mode
npm run dev -- "What are the latest advances in quantum computing?"

# Production build
npm run build && npm start -- "Your research question"
```

---

## Pipeline Walkthrough

### Step 1: Reasoning Node
```
Q: "What are the latest advances in quantum computing?"
↓
Sub-queries:
  [HIGH]   "quantum computing hardware breakthroughs 2024"
  [HIGH]   "quantum error correction recent developments"
  [MEDIUM] "quantum computing companies IBM Google 2024"
  [MEDIUM] "practical quantum computing applications"
  [LOW]    "quantum computing investment funding 2024"
```

### Step 2: Search Node
Executes each sub-query against Tavily's search API. Results are:
- Deduplicated by URL
- Sorted by Tavily relevance score
- Accumulated into state (reducer merges arrays)

### Step 3: Scraper Node
Top 15 URLs are scraped concurrently (batch size: 3) using Cheerio:
- Removes navigation, scripts, ads
- Extracts main content via content selectors
- Falls back to `<body>` text
- Truncates at 8,000 chars per page

### Step 4: Vector Store Node
Content is chunked (1,000 words, 200-word overlap) and embedded using `text-embedding-3-small`, then stored in ChromaDB with metadata:
```json
{
  "url": "https://example.com/article",
  "title": "Quantum Computing Breakthrough 2024",
  "subQueryId": "uuid-of-parent-subquery",
  "chunkIndex": 0
}
```

### Step 5: RAG Retrieval Node
Executes semantic queries against ChromaDB:
- 1 query for the full research question
- 1 query per high-priority sub-query
- 1 query per medium-priority sub-query (capped at 2)
- Results deduplicated, ranked by cosine similarity, top 20 returned

### Step 6: Synthesis Node
GPT-4o-mini generates a structured `ResearchReport` validated by Zod:
```typescript
ResearchReport {
  title: string
  executiveSummary: string
  sections: ReportSection[]   // each has citations[]
  conclusions: string
  citations: Citation[]       // full URL list
  metadata: { totalSources, iterationCount, ... }
}
```

### Step 7: Human Review (HITL)
```
══════════════════════════════════════════════════════════════════
  📋 DRAFT REPORT: Quantum Computing: 2024 Advances Overview
══════════════════════════════════════════════════════════════════

📌 EXECUTIVE SUMMARY
───────────────────────────────────────────────
The quantum computing field saw significant breakthroughs...

[full report preview]

Options:
  [A] Approve — generate final report
  [R] Reject  — provide feedback for revision
  [Q] Quit

Your choice: R

📝 Please provide your feedback:
  Feedback: The section on error correction is too brief. Add more technical detail.

  Change requests:
  • Include specific error rate improvements from Google's Willow chip
  • Add comparison table of major quantum platforms

🔄 Sending back for revision...
```

The graph then loops back to `reasoning` with the feedback injected, runs the full pipeline again (skipping already-scraped URLs), and produces a revised draft.

---

## LangSmith Tracing

Every tool call and LLM invocation is automatically traced:

```
LangSmith Project: deep-research-agent
├── reasoning_node (450ms, 823 tokens)
│   └── gpt-4o-mini call
├── search_node (2.1s)
│   ├── tavily_search: "quantum computing hardware 2024" (380ms, 5 results)
│   ├── tavily_search: "quantum error correction" (290ms, 5 results)
│   └── ...
├── scraper_node (8.2s)
│   ├── scrape_url: nature.com/article (1.2s, 3,400 words)
│   └── ...
├── vector_store_node (3.1s)
│   └── vector_store: 142 chunks embedded
├── retrieval_node (0.8s)
│   └── vector_retrieve: 20 chunks (top score: 0.891)
├── synthesis_node (12s, 3,842 tokens)
│   └── gpt-4o-mini call
└── human_review_node (user: 45s)
```

---

## State Schema (Key Zod Types)

```typescript
// The full graph state
ResearchStateAnnotation = {
  researchQuestion: string
  subQueries: SubQuery[]          // Validated with SubQuerySchema
  searchResults: SearchResult[]   // Validated with SearchResultSchema
  scrapedContent: ScrapedContent[] // Validated with ScrapedContentSchema
  storedChunkIds: string[]
  retrievedChunks: RetrievedChunk[] // Validated with RetrievedChunkSchema
  draftReport: ResearchReport | null // Validated with ResearchReportSchema
  humanFeedback: HumanFeedback | null // Validated with HumanFeedbackSchema
  finalReport: ResearchReport | null
  iterationCount: number
  errors: string[]
}
```

---

## Extension Points

| Feature | How to Add |
|---|---|
| **Pinecone instead of Chroma** | Replace `vectorTool.ts` with Pinecone SDK calls |
| **Slack approval** | Replace `humanReviewNode` stdin logic with Slack Bolt app |
| **Web UI** | Add Express server; use `app.stream()` for real-time updates |
| **Parallel search** | Fan-out sub-queries using `Send()` from `@langchain/langgraph` |
| **PDF/doc ingestion** | Add `documentNode` before vector store using LangChain document loaders |
| **Evaluation dataset** | Use `LangSmith.createDataset()` to build eval sets from past runs |

---

## Cost Estimate (per research session)

| Call | Model | Tokens | Cost |
|---|---|---|---|
| Reasoning | gpt-4o-mini | ~800 | ~$0.0003 |
| Synthesis | gpt-4o-mini | ~5,000 | ~$0.001 |
| Embeddings (100 chunks) | text-embedding-3-small | ~100,000 | ~$0.002 |
| Tavily search (5 queries) | — | — | free tier |
| **Total** | | | **~$0.004 per run** |

---

## License

MIT
