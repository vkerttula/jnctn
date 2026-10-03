"""Shared response shapes — produced identically by the LLM and the fallback."""

from pydantic import BaseModel, Field


class AttentionItem(BaseModel):
    title: str = Field(max_length=120)
    detail: str = Field(max_length=500)
    location: str | None = Field(default=None, max_length=120)


class Narrative(BaseModel):
    """The user-facing words for one analysis window."""

    summary: str = Field(max_length=500)
    attention_items: list[AttentionItem] = Field(default_factory=list, max_length=5)
    recommendations: list[str] = Field(default_factory=list, max_length=5)
