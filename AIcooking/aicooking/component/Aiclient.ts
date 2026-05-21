/**
 * aiClient.ts
 * Thin wrapper around the FastAPI /api/chat endpoint.
 * Maintains conversation history for multi-turn sessions.
 */

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Send a user message along with the full conversation history.
 * Returns the assistant's reply string.
 */
export async function sendChatMessage(
  messages: Message[],
  recipeContext?: string,
  sessionId?: string,
): Promise<ChatResponse> {
  const res = await fetch(`${AI_SERVICE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      recipe_context: recipeContext ?? null,
      session_id: sessionId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Chat API error ${res.status}: ${err}`);
  }

  return res.json() as Promise<ChatResponse>;
}

/**
 * Minimal session manager — keeps history in memory.
 * Swap for zustand/context in a full app.
 */
export class ConversationSession {
  private history: Message[] = [];

  constructor(
    private recipeContext?: string,
    private sessionId?: string,
  ) {}

  async send(userText: string): Promise<string> {
    this.history.push({ role: "user", content: userText });

    const { reply } = await sendChatMessage(
      this.history,
      this.recipeContext,
      this.sessionId,
    );

    this.history.push({ role: "assistant", content: reply });
    return reply;
  }

  getHistory(): Message[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}
