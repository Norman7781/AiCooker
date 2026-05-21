/**
 * Signaling Server — Node.js + Socket.io
 * Handles WebRTC peer negotiation, cooking session rooms, and JWT auth.
 *
 *  Rooms: one room per cooking session (sessionId)
 *  Max peers per room: 2 (cook + co-pilot / viewer)
 *  STUN/TURN: configurable via environment variables
 */

require("dotenv").config();
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ── Config ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  // Add TURN server if needed:
  // {
  //   urls: process.env.TURN_URL,
  //   username: process.env.TURN_USER,
  //   credential: process.env.TURN_CRED,
  // },
];

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ["GET", "POST"] },
});

// In-memory session store (swap for Redis in production)
/** @type {Map<string, { peers: string[], recipe: object|null, createdAt: number }>} */
const sessions = new Map();

// ── REST endpoints ─────────────────────────────────────────────────────────────

/**
 * POST /session
 * Create a new cooking session and return a JWT + sessionId.
 */
app.post("/session", (req, res) => {
  const { username, recipe } = req.body;
  if (!username) return res.status(400).json({ error: "username required" });

  const sessionId = uuidv4();
  const token = jwt.sign({ username, sessionId }, JWT_SECRET, {
    expiresIn: "4h",
  });

  sessions.set(sessionId, {
    peers: [],
    recipe: recipe || null,
    createdAt: Date.now(),
  });

  return res.json({ sessionId, token, iceServers: ICE_SERVERS });
});

/**
 * POST /session/:id/join
 * Join an existing session — returns a JWT for the joiner.
 */
app.post("/session/:id/join", (req, res) => {
  const { id } = req.params;
  const { username } = req.body;

  if (!sessions.has(id))
    return res.status(404).json({ error: "Session not found" });
  if (!username) return res.status(400).json({ error: "username required" });

  const token = jwt.sign({ username, sessionId: id }, JWT_SECRET, {
    expiresIn: "4h",
  });
  return res.json({ sessionId: id, token, iceServers: ICE_SERVERS });
});

/**
 * GET /session/:id
 * Public session metadata (recipe title, peer count).
 */
app.get("/session/:id", (req, res) => {
  const sess = sessions.get(req.params.id);
  if (!sess) return res.status(404).json({ error: "Not found" });
  return res.json({
    sessionId: req.params.id,
    peerCount: sess.peers.length,
    recipeTitle: sess.recipe?.title || null,
  });
});

// ── Socket.io middleware — JWT auth ────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("No token"));

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.data.username = payload.username;
    socket.data.sessionId = payload.sessionId;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

// ── Socket.io events ───────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  const { username, sessionId } = socket.data;
  const sess = sessions.get(sessionId);

  if (!sess) {
    socket.emit("error", { message: "Session not found" });
    socket.disconnect();
    return;
  }

  // Join the Socket.io room
  socket.join(sessionId);
  sess.peers.push(socket.id);
  console.log(
    `[+] ${username} joined session ${sessionId} (${sess.peers.length} peers)`,
  );

  // Notify others in the room
  socket.to(sessionId).emit("peer:joined", { peerId: socket.id, username });

  // Send current peer list to the newly joined socket
  socket.emit("session:peers", {
    peers: sess.peers.filter((id) => id !== socket.id),
    recipe: sess.recipe,
  });

  // ── WebRTC signaling relay ──────────────────────────────────────────────────

  /** Relay SDP offer to a specific peer */
  socket.on("rtc:offer", ({ to, sdp }) => {
    io.to(to).emit("rtc:offer", { from: socket.id, sdp });
  });

  /** Relay SDP answer */
  socket.on("rtc:answer", ({ to, sdp }) => {
    io.to(to).emit("rtc:answer", { from: socket.id, sdp });
  });

  /** Relay ICE candidate */
  socket.on("rtc:ice", ({ to, candidate }) => {
    io.to(to).emit("rtc:ice", { from: socket.id, candidate });
  });

  // ── Chat relay (plain text, AI responses handled client-side via Claude API) ─
  socket.on("chat:message", ({ text, timestamp }) => {
    io.to(sessionId).emit("chat:message", {
      from: socket.id,
      username,
      text,
      timestamp: timestamp || Date.now(),
    });
  });

  // ── Recipe sync ─────────────────────────────────────────────────────────────
  socket.on("recipe:update", (recipe) => {
    if (sess) sess.recipe = recipe;
    socket.to(sessionId).emit("recipe:update", recipe);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────────
  socket.on("disconnect", () => {
    if (sess) sess.peers = sess.peers.filter((id) => id !== socket.id);
    socket.to(sessionId).emit("peer:left", { peerId: socket.id, username });
    console.log(`[-] ${username} left session ${sessionId}`);

    // Clean up empty sessions after 30 min
    if (sess && sess.peers.length === 0) {
      setTimeout(
        () => {
          if (sessions.get(sessionId)?.peers.length === 0) {
            sessions.delete(sessionId);
            console.log(`[~] Session ${sessionId} cleaned up`);
          }
        },
        30 * 60 * 1000,
      );
    }
  });
});

// ── Start ──────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});
