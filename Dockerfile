# Single-image deploy: Vite build + FastAPI serving it as static files.
# Render (render.yaml) builds and runs this on every push to main.

FROM node:24-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev
COPY backend/app ./app
COPY --from=frontend /build/dist ./static
ENV STATIC_DIR=/app/static
EXPOSE 8000
# Render injects $PORT; 8000 is the fallback for local runs.
CMD .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
