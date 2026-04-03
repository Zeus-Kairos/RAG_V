import os
from typing import Any, Dict, List, Optional

import requests
from fastapi import HTTPException


def playground_chat_answer(
    *,
    query: str,
    chunks: List[Dict[str, Any]],
    ollama_base_url: Optional[str] = None,
    ollama_model: Optional[str] = None,
    ollama_api_key: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Single-turn chat grounded only on provided chunks (Playground).

    This is backend business logic; the FastAPI route should call this.
    """
    try:
        query = (query or "").strip()
        if not query:
            raise HTTPException(status_code=400, detail="query is required")

        if not chunks:
            raise HTTPException(status_code=400, detail="chunks is required")

        base_url = (
            (ollama_base_url if ollama_base_url is not None else os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434"))
            or ""
        ).rstrip("/")
        model = ((ollama_model if ollama_model is not None else os.getenv("OLLAMA_MODEL")) or "").strip()
        api_key = ((ollama_api_key if ollama_api_key is not None else os.getenv("OLLAMA_API_KEY")) or "").strip()

        if not model:
            raise HTTPException(status_code=400, detail="OLLAMA_MODEL is required (set it in .env)")

        chunks_sorted = sorted(
            [
                {"index": int(c["index"]), "content": str(c.get("content") or "")}
                for c in chunks
                if c is not None and c.get("index") is not None
            ],
            key=lambda x: x["index"],
        )
        if not chunks_sorted:
            raise HTTPException(
                status_code=400,
                detail="chunks must include at least one item with a valid index",
            )

        chunk_block = "\n\n".join([f"[{c['index']}]\n{c['content']}" for c in chunks_sorted])

        prompt = (
            "You are a retrieval-grounded assistant.\n"
            "Answer the user's question using ONLY the information provided in the CHUNKS.\n"
            "If the CHUNKS do not contain enough information, say: Can't answer this question.\n"
            "When you use a chunk, cite it inline using ASCII square brackets with the chunk number, e.g. [1] [3].\n"
            "Citation format is STRICT: use ONLY [number]. Do NOT use 【number】, ［number］, (number), or any other reference style.\n"
            "Before finalizing your answer, scan your own output and fix any citation that is not exactly in the form [number].\n\n"
            f"QUESTION:\n{query}\n\n"
            f"CHUNKS:\n{chunk_block}\n\n"
            "ANSWER (with citations):\n"
        )

        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            headers["X-API-Key"] = api_key

        url = f"{base_url}/api/generate"
        resp = requests.post(
            url,
            headers=headers,
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0},
            },
            timeout=180,
        )
        try:
            data = resp.json()
        except Exception:
            raise HTTPException(status_code=502, detail=f"Ollama error: {resp.status_code}: {resp.text}")
        if not resp.ok:
            raise HTTPException(status_code=502, detail=f"Ollama error: {resp.status_code}: {data}")

        answer = data.get("response") or ""

        import re

        answer = re.sub(r"[【［]\s*(\d+)\s*[】］]", r"[\1]", str(answer))
        refs = sorted({int(m.group(1)) for m in re.finditer(r"\[(\d+)\]", str(answer))})

        return {"success": True, "answer": answer, "referenced_chunk_indices": refs}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

