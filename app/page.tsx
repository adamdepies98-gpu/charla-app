"use client";

import { useEffect, useRef, useState } from "react";
import type { SpanishLevel } from "@/lib/sofia-prompt";

type Status = "idle" | "recording" | "transcribing" | "thinking" | "speaking";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const LEVELS: SpanishLevel[] = ["Beginner", "Intermediate", "Advanced"];

const STATUS_TEXT: Record<Status, string> = {
  idle: "Tap the mic and say something in Spanish.",
  recording: "Listening... tap again to stop.",
  transcribing: "Transcribing your voice...",
  thinking: "Sofía is thinking...",
  speaking: "Sofía is speaking...",
};

const RECORDER_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];

function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported?.(candidate)
  );
}

function pickSpanishVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "es-es") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("es")) ??
    null
  );
}

export default function Home() {
  const [level, setLevel] = useState<SpanishLevel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Prime the voice list — Chrome loads voices asynchronously.
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Stop any in-flight mic stream / speech on unmount.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function resetToLevelSelect() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setLevel(null);
    setMessages([]);
    setStatus("idle");
    setError(null);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void handleRecordingComplete(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
    } catch (err) {
      console.error("Microphone access failed:", err);
      setError("Couldn't access the microphone. Check your browser permissions.");
      setStatus("idle");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
  }

  function handleRecordButtonClick() {
    if (status === "idle") void startRecording();
    else if (status === "recording") stopRecording();
  }

  async function handleRecordingComplete(blob: Blob) {
    setStatus("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transcription failed.");

      const text = typeof data.text === "string" ? data.text.trim() : "";
      if (!text) {
        setError("Didn't catch that — try again.");
        setStatus("idle");
        return;
      }

      const userMessage: ChatMessage = { role: "user", content: text };
      const updatedHistory = [...messages, userMessage];
      setMessages(updatedHistory);
      await requestSofiaReply(updatedHistory);
    } catch (err) {
      console.error("Transcription error:", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong transcribing your audio."
      );
      setStatus("idle");
    }
  }

  async function requestSofiaReply(history: ChatMessage[]) {
    if (!level) return;
    setStatus("thinking");
    try {
      const res = await fetch("/api/converse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history, level }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sofía couldn't respond.");

      const reply: string = data.reply;
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (err) {
      console.error("Converse error:", err);
      setError(
        err instanceof Error ? err.message : "Something went wrong reaching Sofía."
      );
      setStatus("idle");
    }
  }

  function speak(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus("idle");
      return;
    }
    setStatus("speaking");
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickSpanishVoice();
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "es-ES";
    }
    utterance.onend = () => void startRecording();
    utterance.onerror = () => setStatus("idle");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  if (!level) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-black">
        <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Charla
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Practice speaking Spanish with Sofía. Pick your level to start.
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {LEVELS.map((option) => (
              <button
                key={option}
                onClick={() => setLevel(option)}
                className="rounded-xl border border-zinc-200 px-4 py-3 text-left text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-900 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-200 dark:hover:border-zinc-50 dark:hover:bg-zinc-900"
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const isRecordButtonDisabled = status !== "idle" && status !== "recording";

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Charla con Sofía
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{level}</p>
        </div>
        <button
          onClick={resetToLevelSelect}
          className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Change level
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="mt-10 text-center text-sm text-zinc-400 dark:text-zinc-600">
            Tap the mic below and say hello to Sofía.
          </p>
        ) : (
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-zinc-200 bg-white px-4 py-5 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-3">
          {error && (
            <p className="text-center text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
            {STATUS_TEXT[status]}
          </p>
          <button
            onClick={handleRecordButtonClick}
            disabled={isRecordButtonDisabled}
            aria-label={status === "recording" ? "Stop recording" : "Start recording"}
            className={`flex h-16 w-16 items-center justify-center rounded-full transition-colors ${
              status === "recording"
                ? "animate-pulse bg-red-600 hover:bg-red-700"
                : "bg-zinc-900 hover:bg-zinc-700 dark:bg-zinc-50 dark:hover:bg-zinc-200"
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`h-7 w-7 ${
                status === "recording" ? "text-white" : "text-white dark:text-zinc-900"
              }`}
            >
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
