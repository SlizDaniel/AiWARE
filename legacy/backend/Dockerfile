FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Zależności najpierw (cache warstwy)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Kod aplikacji
COPY app ./app

ENV MAGAZYNIER_DB=/data/magazyn.db
VOLUME /data
EXPOSE 8000

CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
