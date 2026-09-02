# Prompt History — AI Study Tutor

> AI-assisted coding was used throughout this project via GitHub Copilot.  
> Below is the conversation history documenting the development process.

---

## Prompt 1: Research & Planning

**Me:**  
I need to build an AI-powered application on Cloudflare for a coding assignment. The app must include: (1) an LLM (recommended: Llama 3.3 on Workers AI), (2) Workflow/coordination using Workers, Workflows, or Durable Objects, (3) User input via chat or voice, and (4) Memory or state. Can you research the Cloudflare Agents SDK and documentation to help me plan the architecture?

**AI:**  
Researched the Cloudflare Agents platform including:

- `agents.cloudflare.com` — platform overview
- `developers.cloudflare.com/agents/` — full Agents SDK docs
- `developers.cloudflare.com/agents/runtime/agents-api/` — API reference
- `developers.cloudflare.com/agents/examples/chat-agent/` — chat agent tutorial
- `developers.cloudflare.com/workers-ai/models/` — 86+ available models

Key findings: The Agents SDK wraps Durable Objects and provides `AIChatAgent` for chat apps with built-in message persistence, `useAgentChat()` React hook for the frontend, `this.setState()` + `this.sql` for persistent memory, and scheduling/queues/sub-agents built in. Created a comprehensive research document with architecture diagrams, requirements mapping, and app ideas.

---

## Prompt 2: Scaffold the Project

**Me:**  
Let's build an AI Study Tutor — a personalized learning companion with quizzes, flashcards, and spaced repetition. Scaffold the project using the official Cloudflare agents-starter template.

**AI:**  
Scaffolded the project using `npm create cloudflare@latest -- --template cloudflare/agents-starter`. This created a fully configured project with React, TypeScript, Vite, Tailwind CSS, and the Agents SDK pre-installed.

---

## Prompt 3: Implement the Study Tutor Agent

**Me:**  
Now customize the server-side agent (`src/server.ts`) to be an AI Study Tutor. It should:

- Use Workers AI with Llama 4 Scout for explanations and teaching
- Track study topics with confidence levels and study streaks
- Generate and grade quizzes, saving results to state
- Create flashcards with spaced repetition scheduling using SQLite
- Provide study statistics (streaks, weak/strong topics, quiz averages)
- Support scheduling study reminders
- Persist all data across sessions using Durable Object state and embedded SQLite

**AI:**  
Rewrote `src/server.ts` with:

- `StudyState` type with topics, quiz results, study streak, and preferences
- `AIChatAgent<Env, StudyState>` with `initialState` for persistent state
- SQL tables for `study_sessions` and `flashcards` created in `onStart()`
- 7 tools: `trackTopic`, `saveQuizResult`, `createFlashcard`, `reviewFlashcard`, `getDueFlashcards`, `getStudyStats`, `scheduleTask`
- Spaced repetition algorithm in `reviewFlashcard` (doubles interval on correct, resets on incorrect)
- System prompt with student profile context, topic summary, and quiz history
- Streaming responses via `streamText()` with Vercel AI SDK

---

## Prompt 4: Customize the Frontend

**Me:**  
Update the frontend branding and welcome screen to match the Study Tutor theme. Change the app title, header, and suggested prompts to be study-related.

**AI:**  
Updated:

- `index.html`: Title and meta description → "AI Study Tutor"
- `src/app.tsx`: Header → "📚 AI Study Tutor", badge → "Study Chat"
- Welcome prompts → "Teach me about binary search trees", "Quiz me on JavaScript closures", "Show my study stats", "Create flashcards for React hooks", "What should I review today?"

---

## Prompt 5: Configure Wrangler and Build

**Me:**  
Update the wrangler.jsonc with the correct app name and verify the project builds successfully with both `vite build` and `tsc --noEmit`.

**AI:**

- Updated `wrangler.jsonc`: name → `"ai-study-tutor"`
- Updated `package.json`: name → `"ai-study-tutor"`
- Ran `npx wrangler types` to generate `env.d.ts`
- Fixed TypeScript error: added `StudyState` generic to `AIChatAgent<Env, StudyState>`
- Verified: `vite build` ✅ (server + client), `tsc --noEmit` ✅ (0 errors)

---

## Prompt 6: Write README and Documentation

**Me:**  
Write a comprehensive README with architecture diagram, requirements mapping table, features list, tech stack, setup instructions, and example prompts.

**AI:**  
Created `README.md` with:

- ASCII architecture diagram showing React ↔ WebSocket ↔ Agent ↔ Workers AI/SQLite/Scheduling
- Requirements mapping table (LLM, Workflow, Input, Memory)
- Feature list with emoji icons
- Quick start commands
- Example prompts
- Tech stack summary

---

## Prompt 7: Deploy to Cloudflare

**Me:**  
Deploy the application to Cloudflare Workers using `npx wrangler login` and `npm run deploy`.

**AI:**  
Guided through:

1. `npx wrangler login` — authenticated with Cloudflare account
2. `npm run deploy` — deployed to production

**Result:** Live at https://ai-study-tutor.akshayvarshney-001.workers.dev/

---

## Prompt 8: Push to GitHub

**Me:**  
Push the code to my personal GitHub repository at `akshay-varshney/CloudFlare-study-tutor`. Use my personal GitHub account credentials, not my work account.

**AI:**

- Configured local git identity: `akshay-varshney <Akshayvarshney.001@gmail.com>`
- Re-authored all commits with personal identity
- Authenticated with personal GitHub via `gh auth login`
- Pushed to https://github.com/akshay-varshney/CloudFlare-study-tutor
- Added live deployment URL to README

---

## Prompt 9: Fix CI Formatting

**Me:**  
The GitHub Actions CI check is failing on the formatting step (`oxfmt`). Fix the formatting issues so CI passes.

**AI:**

- Ran `npx oxfmt --write .` to auto-format all files
- Verified `npm run check` passes locally (oxfmt + oxlint + tsc)
- Committed and pushed — CI should now pass

---

## Summary

| Step         | What was done                                                              |
| ------------ | -------------------------------------------------------------------------- |
| Research     | Studied Cloudflare Agents SDK, Workers AI, Durable Objects docs            |
| Architecture | Designed agent with LLM + Durable Objects + WebSocket chat + SQLite state  |
| Server       | Built `ChatAgent` with 7 study tools, spaced repetition, progress tracking |
| Frontend     | Customized React chat UI with study-themed branding and prompts            |
| Testing      | Verified TypeScript compilation, Vite build, and formatting checks         |
| Deployment   | Deployed to Cloudflare Workers via `wrangler deploy`                       |
| Source       | Pushed to GitHub with personal account credentials                         |

**Tools used:** GitHub Copilot (AI-assisted coding), Cloudflare Wrangler CLI, Vite, TypeScript
