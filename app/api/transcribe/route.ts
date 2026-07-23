import { NextRequest, NextResponse } from "next/server";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function POST(request: NextRequest) {
  let incomingForm: FormData;
  try {
    incomingForm = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request body must be multipart/form-data." },
      { status: 400 }
    );
  }

  const audioFile = incomingForm.get("audio");
  if (!(audioFile instanceof File)) {
    return NextResponse.json(
      { error: "Request must include an `audio` file field." },
      { status: 400 }
    );
  }

  if (audioFile.size === 0) {
    return NextResponse.json(
      { error: "Uploaded audio file is empty." },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Server is missing OPENAI_API_KEY." },
      { status: 500 }
    );
  }

  const outgoingForm = new FormData();
  outgoingForm.append("file", audioFile, audioFile.name || "audio.webm");
  outgoingForm.append("model", "whisper-1");

  try {
    const openaiResponse = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: outgoingForm,
    });

    if (!openaiResponse.ok) {
      const errorBody = await openaiResponse.text();
      return NextResponse.json(
        { error: `OpenAI API error: ${errorBody}` },
        { status: openaiResponse.status }
      );
    }

    const data = (await openaiResponse.json()) as { text?: string };

    if (typeof data.text !== "string") {
      return NextResponse.json(
        { error: "OpenAI response did not include transcribed text." },
        { status: 502 }
      );
    }

    return NextResponse.json({ text: data.text });
  } catch (error) {
    console.error("Unexpected error calling OpenAI Whisper API:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
