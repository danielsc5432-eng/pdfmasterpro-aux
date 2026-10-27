"""Authenticated, bounded API for the optional Transformers service."""
import hmac
import os
from typing import Annotated
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from engine import ReviewEngine


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    page: Annotated[int, Field(ge=1, le=20)]
    text: Annotated[str, Field(min_length=1, max_length=450)]


class Pair(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    findingId: Annotated[str, Field(min_length=1, max_length=80)]
    evidence: Annotated[list[Evidence], Field(min_length=2, max_length=2)]


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    model: Annotated[str, Field(min_length=1, max_length=200)]
    pairs: Annotated[list[Pair], Field(min_length=1, max_length=10)]


def create_app(engine=None):
    service = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    backend = engine if engine is not None else ReviewEngine()

    @service.get("/health")
    async def health():
        return {"status": "ok", "modelLoaded": backend.generator is not None}

    @service.post("/v1/review")
    async def review(request: Request):
        key = os.getenv("REVIEW_API_KEY", "")
        if not key:
            raise HTTPException(503, "Service not configured")
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), ("Bearer " + key).encode()):
            raise HTTPException(401, "Unauthorized")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > 64 * 1024:
                raise HTTPException(413, "Request too large")
            body.extend(chunk)
        try:
            payload = ReviewRequest.model_validate_json(bytes(body))
            if len({pair.findingId for pair in payload.pairs}) != len(payload.pairs):
                raise ValueError("Duplicate reference")
        except (ValidationError, ValueError):
            raise HTTPException(422, "Invalid request") from None
        try:
            result = await run_in_threadpool(backend.review, payload.model, [pair.model_dump() for pair in payload.pairs])
        except BlockingIOError:
            raise HTTPException(429, "Model busy", headers={"Retry-After": "5"}) from None
        except ValueError:
            raise HTTPException(422, "Review could not be validated") from None
        except Exception:
            raise HTTPException(503, "Model unavailable") from None
        from fastapi.responses import JSONResponse
        return JSONResponse(result, headers={"Cache-Control": "private, no-store"})

    return service


app = create_app()
