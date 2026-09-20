# One image, three roles (API, worker, one-off CLI) — the same code path that runs locally.
# Build: docker build -t logorder .    Run API: docker run -p 8000:8000 --env-file .env logorder

# ---------------------------------------------------------------- frontend build
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# `npm run build` is `tsc -b && vite build`: a type error fails the image, not the deploy.
RUN npm run build

# ---------------------------------------------------------------- runtime
FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

# Pinned versions from the tested set; wheels only, so no build toolchain is needed.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY ml/ ml/
COPY config/ config/
COPY scripts/ scripts/
COPY tasks.py pyproject.toml ./
COPY --from=frontend /build/dist frontend/dist

ENV PYTHONPATH=/app/backend:/app \
    API_HOST=0.0.0.0 \
    API_PORT=8000 \
    CONFIG_DIR=/app/config \
    MODEL_DIR=/app/ml/artifacts \
    STATIC_DIR=/app/frontend/dist \
    UPLOAD_DIR=/app/data/uploads

RUN mkdir -p /app/data/uploads && useradd -r -u 10001 app && chown -R app /app/data
USER app

EXPOSE 8000
# Overridden per service: the worker runs `python -m scripts.serve_worker`.
CMD ["python", "-m", "scripts.serve_api"]
