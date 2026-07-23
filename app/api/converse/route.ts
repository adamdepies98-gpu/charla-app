import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildSofiaSystemPrompt, type SpanishLevel } from "@/lib/sofia-prompt";

const VALID_LEVELS: SpanishLevel[] = ["Beginner", "Intermediate", "Advanced"];

interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

function isConversationTurn(value: unknown): value is ConversationTurn {
  if (typeof value !== "object" || value === null) return false;
  const turn = value as Record<string, unknown>;
  return (
    (turn.role === "user" || turn.role === "assistant") &&
    typeof turn.content === "string"
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { history, level } = (body ?? {}) as {
    history?: unknown;
    level?: unknown;
  };

  if (!Array.isArray(history) || !history.every(isConversationTurn)) {
    return NextResponse.json(
      {
        error:
          "`history` must be an array of { role: 'user' | 'assistant', content: string }.",
      },
      { status: 400 }
    );
  }

  if (history.length === 0) {
    return NextResponse.json(
      { error: "`history` must contain at least one message." },
      { status: 400 }
    );
  }

  if (typeof level !== "string" || !VALID_LEVELS.includes(level as SpanishLevel)) {
    return NextResponse.json(
      { error: `\`level\` must be one of: ${VALID_LEVELS.join(", ")}.` },
      { status: 400 }
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing ANTHROPIC_API_KEY." },
      { status: 500 }
    );
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      system: buildSofiaSystemPrompt(level as SpanishLevel),
      messages: history,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return NextResponse.json(
        { error: "Claude returned an empty response." },
        { status: 502 }
      );
    }

    return NextResponse.json({ reply });
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return NextResponse.json(
        { error: `Anthropic API error: ${error.message}` },
        { status: error.status ?? 502 }
      );
    }
    console.error("Unexpected error calling Anthropic API:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
