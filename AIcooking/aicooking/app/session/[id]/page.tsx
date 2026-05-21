"use client";
/**
 * /app/session/[id]/page.tsx
 * Main cooking session UI:
 *  - Local webcam feed (react-webcam)
 *  - Vision analysis overlay
 *  - AI chat panel (calls FastAPI → Claude)
 *  - Voice input toggle
 *  - WebRTC peer feed (co-pilot / viewer)
 */

import { use, useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

import { useWebRTC, type ChatMessage } from "@/component/Usewebrtc";
import {
  useVisionAnalysis,
  type VisionResult,
} from "@/component/Usevisionanalysis";
import { useVoiceInput } from "@/component/Usevoiceinput";
import { ConversationSession, type Message } from "@/component/Aiclient";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

const SAMPLE_RECIPE = `
Spaghetti Aglio e Olio
Ingredients: 400g spaghetti, 6 garlic cloves, 100ml olive oil, 1 tsp chili flakes, parsley, parmesan.
Steps:
1. Cook pasta in well-salted boiling water until al dente (8-9 min).
2. Thinly slice garlic. Heat olive oil over medium-low, add garlic, cook until golden (not brown).
3. Add chili flakes. Reserve 1 cup pasta water, drain pasta.
4. Toss pasta in garlic oil, add pasta water to emulsify. Finish with parsley and parmesan.
`.trim();

// ── Component ─────────────────────────────────────────────────────────────────
export default function CookingSessionPage({
  params,
  searchParams,
}: PageProps) {
  const { id: sessionId } = use(params);
  const { token = "" } = use(searchParams);

  // Refs
  const webcamRef = useRef<Webcam>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const convSession = useRef<ConversationSession>(
    new ConversationSession(SAMPLE_RECIPE, sessionId),
  );

  // State
  const [chatMessages, setChatMessages] = useState<
    Array<Message & { id: string; isAI?: boolean }>
  >([]);
  const [inputText, setInputText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [visionEnabled, setVisionEnabled] = useState(true);
  const [latestVision, setLatestVision] = useState<VisionResult | null>(null);
  const [showVisionPanel, setShowVisionPanel] = useState(true);

  // ── Chat helpers ────────────────────────────────────────────────────────────
  const addMessage = useCallback(
    (role: "user" | "assistant", content: string, isAI = false) => {
      setChatMessages((prev) => [
        ...prev,
        { role, content, id: `${Date.now()}-${Math.random()}`, isAI },
      ]);
    },
    [],
  );

  // ── WebRTC ──────────────────────────────────────────────────────────────────
  const {
    localStream,
    peers,
    connected,
    connect,
    disconnect,
  } = useWebRTC({
    sessionId,
    token,
    signalingUrl: SIGNALING_URL,
    onChatMessage: (msg: ChatMessage) => {
      addMessage("user", `${msg.username}: ${msg.text}`, false);
    },
  });

  // ── Vision analysis ─────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    videoRef.current = webcamRef.current?.video ?? null;
  });

  const { analyzing } = useVisionAnalysis({
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    enabled: visionEnabled && !!localStream,
    intervalMs: 5000,
    recipeContext: SAMPLE_RECIPE,
    onResult: (result) => {
      setLatestVision(result);
      // Surface critical issues as chat messages
      if (result.technique_issues.length > 0) {
        addMessage(
          "assistant",
          `⚠️ Technique tip: ${result.technique_issues[0]}`,
          true,
        );
      }
    },
  });

  // ── Voice input ─────────────────────────────────────────────────────────────
  const { recording, transcribing, toggleRecording } = useVoiceInput({
    onTranscript: (text) => {
      setInputText(text);
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || aiLoading) return;

    setInputText("");
    addMessage("user", text, false);
    setAiLoading(true);

    try {
      const reply = await convSession.current.send(text);
      addMessage("assistant", reply, true);
    } catch {
      addMessage(
        "assistant",
        "Sorry, I couldn't connect to the AI service.",
        true,
      );
    } finally {
      setAiLoading(false);
    }
  }, [inputText, aiLoading, addMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  // Using inline styles + Tailwind utilities for portability
  // (swap to CSS modules or shadcn in production)

  return (
    <div
      className="min-h-screen bg-gray-950 text-gray-100 flex flex-col"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* ── Top bar ── */}
      <header className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🍳</span>
          <span className="font-semibold text-lg tracking-tight">CookAI</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-300 font-mono">
            {connected ? "● live" : "○ connecting..."}
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">
            Session:{" "}
            <code className="text-amber-400">{sessionId.slice(0, 8)}</code>
          </span>
          <button
            onClick={connected ? disconnect : connect}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              connected
                ? "bg-red-900 hover:bg-red-800 text-red-300"
                : "bg-emerald-700 hover:bg-emerald-600 text-white"
            }`}
          >
            {connected ? "Leave" : "Join"}
          </button>
        </div>
      </header>

      <main className="flex flex-1 overflow-hidden">
        {/* ── Left: Video feeds ── */}
        <section className="flex flex-col gap-3 p-4 w-full max-w-2xl">
          {/* Local webcam */}
          <div className="relative rounded-2xl overflow-hidden bg-gray-900 border border-gray-800">
            <Webcam
              ref={webcamRef}
              audio={false}
              mirrored
              videoConstraints={{
                width: 1280,
                height: 720,
                facingMode: "user",
              }}
              className="w-full object-cover"
              style={{ maxHeight: 360 }}
            />

            {/* Vision overlay badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <button
                onClick={() => setVisionEnabled((v) => !v)}
                className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                  visionEnabled
                    ? "bg-violet-700 text-white"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {analyzing
                  ? "🔍 analyzing…"
                  : visionEnabled
                    ? "🔍 vision ON"
                    : "👁 vision OFF"}
              </button>
              {latestVision && (
                <span
                  className={`px-2 py-1 rounded text-xs font-mono ${
                    latestVision.heat_level === "high"
                      ? "bg-red-800 text-red-200"
                      : latestVision.heat_level === "medium"
                        ? "bg-amber-800 text-amber-200"
                        : "bg-teal-900 text-teal-300"
                  }`}
                >
                  🔥 {latestVision.heat_level}
                </span>
              )}
            </div>

            <div className="absolute bottom-3 right-3 text-xs text-gray-500 font-mono">
              you
            </div>
          </div>

          {/* Vision analysis panel */}
          {latestVision && showVisionPanel && (
            <div className="rounded-xl bg-gray-900 border border-violet-800/40 p-4 text-sm space-y-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-violet-400 font-semibold text-xs uppercase tracking-wider">
                  Vision Analysis
                </span>
                <button
                  onClick={() => setShowVisionPanel(false)}
                  className="text-gray-600 hover:text-gray-400 text-xs"
                >
                  ✕
                </button>
              </div>

              {latestVision.ingredients.length > 0 && (
                <div>
                  <span className="text-gray-500 text-xs">
                    Ingredients detected:{" "}
                  </span>
                  <span className="text-gray-200">
                    {latestVision.ingredients.join(", ")}
                  </span>
                </div>
              )}

              {latestVision.technique_issues.length > 0 && (
                <div className="text-amber-300">
                  ⚠️ {latestVision.technique_issues.join(" · ")}
                </div>
              )}

              {latestVision.suggestions.map((s, i) => (
                <div key={i} className="text-emerald-400 text-xs">
                  💡 {s}
                </div>
              ))}
            </div>
          )}

          {/* Remote peer feeds */}
          {peers.map((peer) =>
            peer.stream ? (
              <PeerVideo
                key={peer.id}
                stream={peer.stream}
                username={peer.username}
              />
            ) : null,
          )}
        </section>

        {/* ── Right: Chat panel ── */}
        <aside className="flex flex-col w-96 border-l border-gray-800 bg-gray-900">
          {/* Recipe context */}
          <div className="p-3 border-b border-gray-800 bg-gray-950">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
              Recipe
            </p>
            <p className="text-sm text-amber-300 font-medium">
              Spaghetti Aglio e Olio
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center text-gray-600 text-sm mt-8">
                <p className="text-3xl mb-2">👨‍🍳</p>
                <p>Ask your AI chef anything about the recipe!</p>
              </div>
            )}

            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" && !msg.isAI ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user" && !msg.isAI
                      ? "bg-violet-700 text-white rounded-br-sm"
                      : "bg-gray-800 text-gray-100 rounded-bl-sm"
                  }`}
                >
                  {msg.isAI && (
                    <span className="block text-[10px] text-violet-400 font-mono mb-0.5 uppercase">
                      chef claude
                    </span>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}

            {aiLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-gray-400">
                  <span className="animate-pulse">Thinking…</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="p-4 border-t border-gray-800 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={toggleRecording}
                className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  recording || transcribing
                    ? "bg-red-600 animate-pulse"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
                title={
                  transcribing
                    ? "Transcribing"
                    : recording
                      ? "Stop recording"
                      : "Voice input"
                }
              >
                🎤
              </button>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  transcribing
                    ? "Transcribing..."
                    : recording
                      ? "Listening..."
                      : "Ask the chef..."
                }
                rows={1}
                className="flex-1 bg-gray-800 rounded-xl px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none outline-none border border-transparent focus:border-violet-600 transition-colors"
                style={{ minHeight: 42 }}
              />

              <button
                onClick={handleSend}
                disabled={!inputText.trim() || aiLoading}
                className="flex-shrink-0 w-10 h-10 rounded-xl bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
              >
                ↑
              </button>
            </div>

            <p className="text-[10px] text-gray-600 text-center">
              Shift+Enter for new line · Enter to send
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

// ── Sub-component: remote peer video ─────────────────────────────────────────
function PeerVideo({
  stream,
  username,
}: {
  stream: MediaStream;
  username: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  return (
    <div className="relative rounded-2xl overflow-hidden bg-gray-900 border border-gray-800">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-full object-cover"
        style={{ maxHeight: 200 }}
      />
      <div className="absolute bottom-2 right-3 text-xs text-gray-400 font-mono">
        {username}
      </div>
    </div>
  );
}
