"use client";
/**
 * useVisionAnalysis
 * Captures a webcam frame every `intervalMs` milliseconds,
 * sends it to /api/vision (FastAPI) and returns structured feedback.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";

export interface VisionResult {
  ingredients: string[];
  heat_level: "low" | "medium" | "high" | "unknown";
  technique_issues: string[];
  suggestions: string[];
  timestamp: number;
}

interface UseVisionAnalysisOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  intervalMs?: number; // default 4000 (4 sec)
  recipeContext?: string;
  analysisUrl?: string; // default http://localhost:8000/api/vision
  onResult?: (result: VisionResult) => void;
  onError?: (err: string) => void;
}

export function useVisionAnalysis({
  videoRef,
  enabled,
  intervalMs = 4000,
  recipeContext,
  analysisUrl = `${AI_SERVICE_URL}/api/vision`,
  onResult,
  onError,
}: UseVisionAnalysisOptions) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastResult, setLastResult] = useState<VisionResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Create off-screen canvas once
  useEffect(() => {
    canvasRef.current = document.createElement("canvas");
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    canvas.width = 640; // Reduce resolution for faster upload
    canvas.height = 360;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Returns base64 JPEG (strip the data:image/jpeg;base64, prefix)
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    return dataUrl.split(",")[1];
  }, [videoRef]);

  const runAnalysis = useCallback(async () => {
    if (analyzing) return; // Skip if previous request still in-flight

    const frame = captureFrame();
    if (!frame) return;

    setAnalyzing(true);
    try {
      const res = await fetch(analysisUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frame_base64: frame,
          media_type: "image/jpeg",
          recipe_context: recipeContext ?? null,
        }),
      });

      if (!res.ok) throw new Error(`Vision API ${res.status}`);

      const data: Omit<VisionResult, "timestamp"> = await res.json();
      const result: VisionResult = { ...data, timestamp: Date.now() };
      setLastResult(result);
      onResult?.(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onError?.(msg);
    } finally {
      setAnalyzing(false);
    }
  }, [analyzing, captureFrame, analysisUrl, recipeContext, onResult, onError]);

  // Start / stop periodic analysis
  useEffect(() => {
    if (enabled) {
      timerRef.current = setInterval(runAnalysis, intervalMs);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, intervalMs, runAnalysis]);

  return { lastResult, analyzing };
}
