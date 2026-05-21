"""
AI Service — FastAPI
Endpoints:
  POST /api/chat   — Claude chat with recipe context
  POST /api/vision — Claude vision for webcam frame analysis
  POST /api/voice  — Whisper speech-to-text
"""

import os
import base64
import tempfile
from typing import Optional

import anthropic
import whisper
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── App setup ──────────────────────────────────────────────────────────────────
app = FastAPI(title="CookAI – AI Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", os.getenv("FRONTEND_URL", "")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
client = (
    anthropic.Anthropic(api_key=anthropic_api_key)
    if anthropic_api_key
    else None
)
whisper_model = None

# ── Pydantic models ────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str          # "user" | "assistant"
    content: str

class ChatRequest(BaseModel):
    messages: list[Message]
    recipe_context: Optional[str] = None
    session_id: Optional[str] = None

class VisionRequest(BaseModel):
    frame_base64: str                  # raw base64 (no data-URL prefix)
    media_type: str = "image/jpeg"
    recipe_context: Optional[str] = None
    analysis_focus: Optional[str] = None

class VisionResponse(BaseModel):
    ingredients: list[str]
    heat_level: str                    # "low" | "medium" | "high" | "unknown"
    technique_issues: list[str]
    suggestions: list[str]
    raw_analysis: str

# ── Helpers ────────────────────────────────────────────────────────────────────

SYSTEM_CHEF = """You are an expert culinary coach with Michelin-star kitchen experience.
You guide home cooks in real-time during cooking sessions.
Keep responses concise (2-4 sentences max) unless asked for detail.
Adapt your tone to be warm, encouraging, and professional.
If the user is struggling, be extra supportive and break steps into smaller actions."""

def build_system_with_recipe(recipe_context: Optional[str]) -> str:
    if not recipe_context:
        return SYSTEM_CHEF
    return f"""{SYSTEM_CHEF}

CURRENT RECIPE CONTEXT:
{recipe_context}

Use this recipe as your reference when answering cooking questions."""


def parse_vision_response(raw: str) -> VisionResponse:
    """Parse Claude's vision analysis into structured data."""
    lines = raw.lower()

    # Heat level detection
    heat_level = "unknown"
    if any(w in lines for w in ["high heat", "very hot", "smoking", "boiling vigorously"]):
        heat_level = "high"
    elif any(w in lines for w in ["medium heat", "simmering", "gentle boil"]):
        heat_level = "medium"
    elif any(w in lines for w in ["low heat", "warm", "barely"]):
        heat_level = "low"

    return VisionResponse(
        ingredients=[],          # Populated by structured JSON prompt below
        heat_level=heat_level,
        technique_issues=[],
        suggestions=[],
        raw_analysis=raw,
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "cook-ai",
        "ai_enabled": client is not None,
        "voice_enabled": whisper_model is not None,
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    """
    Multi-turn cooking chat using Claude.
    Maintains recipe context in the system prompt.
    """
    if client is None:
        return {
            "reply": (
                "AI chat is running in demo mode because ANTHROPIC_API_KEY is "
                "not set yet. Add the key and restart the API service to enable "
                "live chef responses."
            ),
            "usage": None,
        }

    try:
        anthropic_messages = [
            {"role": m.role, "content": m.content}
            for m in req.messages
        ]

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=512,
            system=build_system_with_recipe(req.recipe_context),
            messages=anthropic_messages,
        )

        text = response.content[0].text
        return {"reply": text, "usage": response.usage.model_dump()}

    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"Claude API error: {e}")


@app.post("/api/vision", response_model=VisionResponse)
async def vision_analysis(req: VisionRequest):
    """
    Analyse a webcam frame captured every 3-5 seconds.
    Returns structured culinary feedback — no external CV model needed.
    """
    if client is None:
        return VisionResponse(
            ingredients=[],
            heat_level="unknown",
            technique_issues=[],
            suggestions=[
                "Vision is in demo mode until ANTHROPIC_API_KEY is configured."
            ],
            raw_analysis="AI vision disabled: ANTHROPIC_API_KEY is not set.",
        )

    try:
        focus = req.analysis_focus or (
            "Identify all visible ingredients, estimate the heat level of any cooking surface, "
            "and flag any technique issues (e.g. overcrowding, wrong cut size, unsafe handling)."
        )

        recipe_hint = ""
        if req.recipe_context:
            recipe_hint = f"\nThe cook is following this recipe:\n{req.recipe_context}\n"

        prompt = f"""{focus}{recipe_hint}

Respond ONLY with a valid JSON object — no markdown, no explanation — matching exactly:
{{
  "ingredients": ["list", "of", "identified", "ingredients"],
  "heat_level": "low|medium|high|unknown",
  "technique_issues": ["list of any problems observed"],
  "suggestions": ["list of 1-3 actionable tips for right now"]
}}"""

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=400,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": req.media_type,
                                "data": req.frame_base64,
                            },
                        },
                        {"type": "text", "text": prompt},
                    ],
                }
            ],
        )

        import json
        raw = response.content[0].text.strip()
        # Strip possible ```json fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        parsed = json.loads(raw)
        return VisionResponse(
            ingredients=parsed.get("ingredients", []),
            heat_level=parsed.get("heat_level", "unknown"),
            technique_issues=parsed.get("technique_issues", []),
            suggestions=parsed.get("suggestions", []),
            raw_analysis=raw,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/voice")
async def voice_to_text(audio: UploadFile = File(...)):
    """
    Accept an audio blob from the browser (webm/ogg/wav) and return
    the transcribed text via OpenAI Whisper (local model).
    """
    global whisper_model
    if whisper_model is None:
        whisper_model = whisper.load_model("base")   # or "small" / "medium"

    try:
        suffix = ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name

        result = whisper_model.transcribe(tmp_path)
        os.unlink(tmp_path)

        return {"transcript": result["text"].strip(), "language": result.get("language", "en")}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
