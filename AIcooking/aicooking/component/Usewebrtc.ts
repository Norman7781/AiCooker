"use client";
/**
 * useWebRTC — manages WebRTC peer connection + Socket.io signaling.
 *
 * Usage:
 *   const { localStream, remoteStream, peers, connect, disconnect } = useWebRTC({
 *     sessionId, token, signalingUrl, iceServers,
 *     onPeerJoined, onPeerLeft,
 *   });
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface UseWebRTCOptions {
  sessionId: string;
  token: string;
  signalingUrl?: string;
  iceServers?: RTCIceServer[];
  onPeerJoined?: (peerId: string, username: string) => void;
  onPeerLeft?: (peerId: string) => void;
  onChatMessage?: (msg: ChatMessage) => void;
}

export interface ChatMessage {
  from: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface PeerInfo {
  id: string;
  username: string;
  stream?: MediaStream;
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function useWebRTC({
  sessionId,
  token,
  signalingUrl = "http://localhost:4000",
  iceServers = DEFAULT_ICE,
  onPeerJoined,
  onPeerLeft,
  onChatMessage,
}: UseWebRTCOptions) {
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [connected, setConnected] = useState(false);

  // ── Create RTCPeerConnection for a given remote peer ──────────────────────
  const createPc = useCallback(
    (peerId: string): RTCPeerConnection => {
      const pc = new RTCPeerConnection({ iceServers });

      // Add local tracks
      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      // ICE candidate → relay via signaling
      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          socketRef.current?.emit("rtc:ice", { to: peerId, candidate });
        }
      };

      // Remote track → update peer state
      pc.ontrack = ({ streams }) => {
        setPeers((prev) =>
          prev.map((p) => (p.id === peerId ? { ...p, stream: streams[0] } : p)),
        );
      };

      pcRef.current.set(peerId, pc);
      return pc;
    },
    [iceServers],
  );

  // ── Connect local camera/mic + socket ────────────────────────────────────
  const connect = useCallback(async () => {
    // 1. Get local media
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, frameRate: 30 },
      audio: true,
    });
    localStreamRef.current = stream;
    setLocalStream(stream);

    // 2. Connect socket
    const socket = io(signalingUrl, { auth: { token, sessionId } });
    socketRef.current = socket;

    // 3. Signaling event handlers
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    // Existing peers when we join
    socket.on(
      "session:peers",
      async ({ peers: existingPeers }: { peers: string[] }) => {
        for (const peerId of existingPeers) {
          const pc = createPc(peerId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("rtc:offer", { to: peerId, sdp: offer });
        }
      },
    );

    // A new peer joined — they will send us an offer
    socket.on(
      "peer:joined",
      ({ peerId, username }: { peerId: string; username: string }) => {
        setPeers((prev) => [...prev, { id: peerId, username }]);
        onPeerJoined?.(peerId, username);
      },
    );

    socket.on("peer:left", ({ peerId }: { peerId: string }) => {
      pcRef.current.get(peerId)?.close();
      pcRef.current.delete(peerId);
      setPeers((prev) => prev.filter((p) => p.id !== peerId));
      onPeerLeft?.(peerId);
    });

    // Receive offer
    socket.on(
      "rtc:offer",
      async ({
        from,
        sdp,
      }: {
        from: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        if (!pcRef.current.has(from)) createPc(from);
        const pc = pcRef.current.get(from)!;
        await pc.setRemoteDescription(sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("rtc:answer", { to: from, sdp: answer });
      },
    );

    // Receive answer
    socket.on(
      "rtc:answer",
      async ({
        from,
        sdp,
      }: {
        from: string;
        sdp: RTCSessionDescriptionInit;
      }) => {
        await pcRef.current.get(from)?.setRemoteDescription(sdp);
      },
    );

    // Receive ICE candidate
    socket.on(
      "rtc:ice",
      async ({
        from,
        candidate,
      }: {
        from: string;
        candidate: RTCIceCandidateInit;
      }) => {
        try {
          await pcRef.current.get(from)?.addIceCandidate(candidate);
        } catch {
          /* ignore */
        }
      },
    );

    // Chat relay
    socket.on("chat:message", (msg: ChatMessage) => {
      onChatMessage?.(msg);
    });
  }, [
    signalingUrl,
    token,
    sessionId,
    createPc,
    onPeerJoined,
    onPeerLeft,
    onChatMessage,
  ]);

  // ── Send chat message ─────────────────────────────────────────────────────
  const sendChatMessage = useCallback((text: string) => {
    socketRef.current?.emit("chat:message", { text, timestamp: Date.now() });
  }, []);

  // ── Disconnect ────────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current.forEach((pc) => pc.close());
    pcRef.current.clear();
    socketRef.current?.disconnect();
    setLocalStream(null);
    setPeers([]);
    setConnected(false);
  }, []);

  useEffect(
    () => () => {
      disconnect();
    },
    [disconnect],
  );

  return {
    localStream,
    peers,
    connected,
    connect,
    disconnect,
    sendChatMessage,
  };
}
