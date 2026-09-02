import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt, scheduleSchema } from "agents/schedule";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool
} from "ai";
import { z } from "zod";

// Types for study tracking state
export type StudyTopic = {
  id: string;
  name: string;
  category: string;
  confidence: number; // 1-5
  lastStudied: string;
  timesStudied: number;
  notes: string;
};

export type QuizResult = {
  id: string;
  topic: string;
  score: number;
  totalQuestions: number;
  date: string;
};

export type StudyState = {
  topics: StudyTopic[];
  quizResults: QuizResult[];
  studyStreak: number;
  lastStudyDate: string | null;
  preferences: {
    difficulty: "beginner" | "intermediate" | "advanced";
    focusAreas: string[];
  };
};

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  initialState: StudyState = {
    topics: [],
    quizResults: [],
    studyStreak: 0,
    lastStudyDate: null,
    preferences: {
      difficulty: "intermediate",
      focusAreas: []
    }
  };

  onStart() {
    // Initialize SQL tables for persistent study data
    this.sql`CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      duration_minutes INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS flashcards (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      difficulty INTEGER DEFAULT 1,
      next_review TEXT DEFAULT (datetime('now')),
      times_reviewed INTEGER DEFAULT 0
    )`;
  }

  @callable()
  getStudyState() {
    return this.state;
  }

  @callable()
  updatePreferences(difficulty: string, focusAreas: string[]) {
    this.setState({
      ...this.state,
      preferences: {
        difficulty: difficulty as StudyState["preferences"]["difficulty"],
        focusAreas
      }
    });
    return this.state.preferences;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });
    const currentState = this.state;

    // Build context about the student's progress
    const topicSummary = currentState.topics.length > 0
      ? currentState.topics.map(t =>
          `- ${t.name} (${t.category}): confidence ${t.confidence}/5, studied ${t.timesStudied} times`
        ).join("\n")
      : "No topics tracked yet.";

    const recentQuizzes = currentState.quizResults.slice(-5);
    const quizSummary = recentQuizzes.length > 0
      ? recentQuizzes.map(q =>
          `- ${q.topic}: ${q.score}/${q.totalQuestions} on ${q.date}`
        ).join("\n")
      : "No quizzes taken yet.";

    // Get due flashcards
    const dueCards = this.sql<{ id: string; topic: string; question: string; answer: string }>`
      SELECT id, topic, question, answer FROM flashcards
      WHERE next_review <= datetime('now')
      ORDER BY next_review ASC LIMIT 5
    `;

    const flashcardContext = dueCards.length > 0
      ? `\n\nFlashcards due for review (${dueCards.length}):\n${dueCards.map(c => `- [${c.topic}] Q: ${c.question}`).join("\n")}`
      : "";

    const result = streamText({
      model: workersai("@cf/meta/llama-4-scout-17b-16e-instruct", {
        sessionAffinity: this.sessionAffinity
      }),
      system: `You are an AI Study Tutor — a personalized learning companion. Your role is to help students learn effectively through explanation, quizzes, flashcards, and spaced repetition.

## Student Profile
- Difficulty level: ${currentState.preferences.difficulty}
- Focus areas: ${currentState.preferences.focusAreas.join(", ") || "Not set yet"}
- Study streak: ${currentState.studyStreak} days
- Last study date: ${currentState.lastStudyDate || "Never"}

## Topics Being Studied
${topicSummary}

## Recent Quiz Results
${quizSummary}
${flashcardContext}

## Your Behavior
1. **Teaching**: Explain concepts clearly using the Feynman technique. Start simple, build complexity. Use analogies.
2. **Quizzes**: When asked, generate quiz questions on a topic. Use the saveQuizResult tool after grading.
3. **Flashcards**: Create flashcards for key concepts. Use the createFlashcard tool to save them.
4. **Spaced Repetition**: When flashcards are due for review, proactively suggest reviewing them.
5. **Tracking**: Always use trackTopic when teaching a new topic or revisiting one.
6. **Encouragement**: Celebrate progress, suggest weak areas to review, maintain motivation.
7. **Scheduling**: Help students schedule study sessions using the scheduleTask tool.

${getSchedulePrompt({ date: new Date() })}

Always be encouraging but honest. If a student gets something wrong, explain why and help them understand.`,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools: {
        trackTopic: tool({
          description: "Track a study topic. Call this whenever the student studies or discusses a topic.",
          inputSchema: z.object({
            name: z.string().describe("Topic name, e.g. 'Binary Search Trees'"),
            category: z.string().describe("Category, e.g. 'Data Structures', 'Math', 'Physics'"),
            confidence: z.number().min(1).max(5).describe("Student's confidence level 1-5"),
            notes: z.string().describe("Brief notes about what was covered")
          }),
          execute: async ({ name, category, confidence, notes }) => {
            const state = this.state;
            const existing = state.topics.find(
              t => t.name.toLowerCase() === name.toLowerCase()
            );
            const today = new Date().toISOString().split("T")[0];

            if (existing) {
              existing.confidence = confidence;
              existing.lastStudied = today;
              existing.timesStudied += 1;
              existing.notes = notes;
            } else {
              state.topics.push({
                id: crypto.randomUUID(),
                name,
                category,
                confidence,
                lastStudied: today,
                timesStudied: 1,
                notes
              });
            }

            // Update study streak
            const lastDate = state.lastStudyDate;
            if (lastDate) {
              const daysDiff = Math.floor(
                (Date.now() - new Date(lastDate).getTime()) / 86400000
              );
              state.studyStreak = daysDiff <= 1 ? state.studyStreak + (daysDiff === 1 ? 1 : 0) : 1;
            } else {
              state.studyStreak = 1;
            }
            state.lastStudyDate = today;

            // Log to SQL
            this.sql`INSERT INTO study_sessions (id, topic, notes)
              VALUES (${crypto.randomUUID()}, ${name}, ${notes})`;

            this.setState(state);
            return `Tracked topic "${name}" (${category}) — confidence: ${confidence}/5, streak: ${state.studyStreak} days`;
          }
        }),

        saveQuizResult: tool({
          description: "Save a quiz result after grading the student's answers.",
          inputSchema: z.object({
            topic: z.string().describe("Quiz topic"),
            score: z.number().describe("Number of correct answers"),
            totalQuestions: z.number().describe("Total questions in the quiz")
          }),
          execute: async ({ topic, score, totalQuestions }) => {
            const state = this.state;
            const result: QuizResult = {
              id: crypto.randomUUID(),
              topic,
              score,
              totalQuestions,
              date: new Date().toISOString().split("T")[0]
            };
            state.quizResults.push(result);

            // Update confidence for the topic
            const topicEntry = state.topics.find(
              t => t.name.toLowerCase() === topic.toLowerCase()
            );
            if (topicEntry) {
              const pct = score / totalQuestions;
              topicEntry.confidence = Math.min(5, Math.max(1,
                Math.round(pct * 5)
              ));
            }

            this.setState(state);
            const pct = Math.round((score / totalQuestions) * 100);
            return `Quiz saved: ${score}/${totalQuestions} (${pct}%) on "${topic}"${pct >= 80 ? " — Great job! 🎉" : pct >= 50 ? " — Good effort, keep practicing!" : " — Let's review this topic more."}`;
          }
        }),

        createFlashcard: tool({
          description: "Create a flashcard for spaced repetition review.",
          inputSchema: z.object({
            topic: z.string().describe("Topic the flashcard belongs to"),
            question: z.string().describe("The question side of the flashcard"),
            answer: z.string().describe("The answer side of the flashcard"),
            difficulty: z.number().min(1).max(3).describe("Difficulty: 1=easy, 2=medium, 3=hard")
          }),
          execute: async ({ topic, question, answer, difficulty }) => {
            const id = crypto.randomUUID();
            this.sql`INSERT INTO flashcards (id, topic, question, answer, difficulty)
              VALUES (${id}, ${topic}, ${question}, ${answer}, ${difficulty})`;
            return `Flashcard created for "${topic}": "${question.substring(0, 50)}..."`;
          }
        }),

        reviewFlashcard: tool({
          description: "Mark a flashcard as reviewed and schedule its next review based on spaced repetition.",
          inputSchema: z.object({
            flashcardId: z.string().describe("The flashcard ID"),
            correct: z.boolean().describe("Whether the student got it correct")
          }),
          execute: async ({ flashcardId, correct }) => {
            const cards = this.sql<{ times_reviewed: number }>`
              SELECT times_reviewed FROM flashcards WHERE id = ${flashcardId}
            `;
            if (cards.length === 0) return "Flashcard not found.";

            const reviewed = cards[0].times_reviewed;
            // Spaced repetition: double interval on correct, reset on incorrect
            const daysUntilNext = correct
              ? Math.min(30, Math.pow(2, reviewed))
              : 1;

            this.sql`UPDATE flashcards SET
              times_reviewed = times_reviewed + 1,
              next_review = datetime('now', '+${daysUntilNext} days')
              WHERE id = ${flashcardId}`;

            return correct
              ? `Correct! Next review in ${daysUntilNext} day(s).`
              : `Let's review this again tomorrow.`;
          }
        }),

        getDueFlashcards: tool({
          description: "Get flashcards that are due for review right now.",
          inputSchema: z.object({}),
          execute: async () => {
            const cards = this.sql<{ id: string; topic: string; question: string; answer: string; difficulty: number }>`
              SELECT id, topic, question, answer, difficulty FROM flashcards
              WHERE next_review <= datetime('now')
              ORDER BY next_review ASC LIMIT 10
            `;
            return cards.length > 0 ? cards : "No flashcards due for review! 🎉";
          }
        }),

        getStudyStats: tool({
          description: "Get the student's overall study statistics and progress.",
          inputSchema: z.object({}),
          execute: async () => {
            const state = this.state;
            const totalSessions = this.sql<{ count: number }>`
              SELECT COUNT(*) as count FROM study_sessions
            `;
            const totalCards = this.sql<{ count: number }>`
              SELECT COUNT(*) as count FROM flashcards
            `;
            const weakTopics = state.topics
              .filter(t => t.confidence <= 2)
              .map(t => t.name);
            const strongTopics = state.topics
              .filter(t => t.confidence >= 4)
              .map(t => t.name);
            const avgQuizScore = state.quizResults.length > 0
              ? state.quizResults.reduce((sum, q) => sum + (q.score / q.totalQuestions), 0) / state.quizResults.length
              : 0;

            return {
              studyStreak: state.studyStreak,
              totalTopics: state.topics.length,
              totalSessions: totalSessions[0]?.count ?? 0,
              totalFlashcards: totalCards[0]?.count ?? 0,
              totalQuizzes: state.quizResults.length,
              averageQuizScore: `${Math.round(avgQuizScore * 100)}%`,
              weakTopics: weakTopics.length > 0 ? weakTopics : ["None — great job!"],
              strongTopics: strongTopics.length > 0 ? strongTopics : ["Keep studying!"],
              difficulty: state.preferences.difficulty,
              focusAreas: state.preferences.focusAreas
            };
          }
        }),

        getUserTimezone: tool({
          description: "Get the user's timezone from their browser.",
          inputSchema: z.object({})
        }),

        scheduleTask: tool({
          description: "Schedule a study reminder or review session for later.",
          inputSchema: scheduleSchema,
          execute: async ({ when, description }) => {
            if (when.type === "no-schedule") {
              return "Not a valid schedule input";
            }
            const input =
              when.type === "scheduled"
                ? when.date
                : when.type === "delayed"
                  ? when.delayInSeconds
                  : when.type === "cron"
                    ? when.cron
                    : null;
            if (!input) return "Invalid schedule type";
            try {
              this.schedule(input, "executeTask", description, {
                idempotent: true
              });
              return `Study reminder scheduled: "${description}" (${when.type}: ${input})`;
            } catch (error) {
              return `Error scheduling: ${error}`;
            }
          }
        })
      },
      stopWhen: stepCountIs(20),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async executeTask(description: string, _task: Schedule<string>) {
    console.log(`Study reminder: ${description}`);
    this.broadcast(
      JSON.stringify({
        type: "study-reminder",
        description,
        timestamp: new Date().toISOString()
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
