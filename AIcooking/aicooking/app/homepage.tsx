"use client";
/**
 * Home page — create a new cooking session or join an existing one.
 * Calls the signaling server's REST API, then redirects to /session/[id].
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const SIGNALING_URL =
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? "http://localhost:4000";

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [joinId, setJoinId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");

  const createSession = async () => {
    if (!username.trim()) return setError("Enter your name first.");
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${SIGNALING_URL}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, token } = await res.json();
      router.push(`/session/${sessionId}?token=${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setLoading(false);
    }
  };

  const joinSession = async () => {
    if (!username.trim()) return setError("Enter your name first.");
    if (!joinId.trim()) return setError("Enter a session ID.");
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${SIGNALING_URL}/session/${joinId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, token } = await res.json();
      router.push(`/session/${sessionId}?token=${token}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to join session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center p-6"
      style={{ fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* Hero */}
      <div className="text-center mb-10">
        <span className="text-6xl block mb-4">🍳</span>
        <h1 className="text-4xl font-bold tracking-tight mb-2">CookAI</h1>
        <p className="text-gray-400 max-w-sm">
          Your AI-powered culinary coach. Real-time ingredient detection,
          technique analysis, and expert guidance — live.
        </p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-5">
        {/* Name */}
        <div>
          <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
            Your Name
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Chef Gordon…"
            className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm outline-none border border-transparent focus:border-violet-600 placeholder-gray-600 transition-colors"
          />
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl overflow-hidden border border-gray-800">
          {(["create", "join"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-violet-700 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-750"
              }`}
            >
              {m === "create" ? "🆕 New Session" : "🔗 Join Session"}
            </button>
          ))}
        </div>

        {mode === "join" && (
          <div>
            <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1.5">
              Session ID
            </label>
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="Paste session ID…"
              className="w-full bg-gray-800 rounded-xl px-4 py-2.5 text-sm outline-none border border-transparent focus:border-violet-600 placeholder-gray-600 transition-colors font-mono"
            />
          </div>
        )}

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          onClick={mode === "create" ? createSession : joinSession}
          disabled={loading}
          className="w-full bg-violet-700 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl py-3 text-sm font-semibold transition-colors"
        >
          {loading
            ? "Connecting…"
            : mode === "create"
              ? "Start Cooking"
              : "Join Session"}
        </button>
      </div>

      <p className="mt-8 text-xs text-gray-700 text-center max-w-xs">
        Powered by Claude AI vision, Whisper speech-to-text, and WebRTC peer
        streaming.
      </p>
    </div>
  );
}
