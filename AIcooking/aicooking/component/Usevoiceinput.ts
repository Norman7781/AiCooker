"use client";
/**
 * useVoiceInput
 * Records a short audio clip from the microphone and sends it
 * to the /api/voice (FastAPI + Whisper) endpoint for transcription.
 */

import { useCallback, useRef, useState } from "react";

const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_SERVICE_URL ?? "http://localhost:8000";

interface UseVoiceInputOptions {
  voiceUrl?: string; // default http://localhost:8000/api/voice
  onTranscript?: (text: string) => void;
  onError?: (err: string) => void;
  mimeType?: string; // default "audio/webm"
}

export function useVoiceInput({
  voiceUrl = `${AI_SERVICE_URL}/api/voice`,
  onTranscript,
  onError,
  mimeType = "audio/webm",
}: UseVoiceInputOptions = {}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      setTranscribing(true);
      try {
        const form = new FormData();
        form.append("audio", blob, "recording.webm");

        const res = await fetch(voiceUrl, { method: "POST", body: form });
        if (!res.ok) throw new Error(`Whisper API ${res.status}`);

        const { transcript: text } = await res.json();
        setTranscript(text);
        onTranscript?.(text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onError?.(msg);
      } finally {
        setTranscribing(false);
      }
    },
    [voiceUrl, onTranscript, onError],
  );

  const startRecording = useCallback(async () => {
    if (recording) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType });
      await transcribeBlob(blob);
    };

    recorder.start();
    setRecording(true);
  }, [recording, mimeType, transcribeBlob]);

  const stopRecording = useCallback(() => {
    if (!recording || !recorderRef.current) return;
    recorderRef.current.stop();
    setRecording(false);
  }, [recording]);

  /** Toggle: start if idle, stop if recording */
  const toggleRecording = useCallback(() => {
    if (recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [recording, startRecording, stopRecording]);

  return {
    recording,
    transcribing,
    transcript,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
