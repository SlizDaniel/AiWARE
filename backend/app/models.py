"""Modele domenowe współdzielone przez parser i API."""
from dataclasses import dataclass


@dataclass(frozen=True)
class ItemRef:
    """Minimalna referencja pozycji magazynowej dla seamu intencja→narzędzie."""

    id: int
    name: str
