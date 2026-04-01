# ==============================================================================
# NoodlePlanner Dockerfile - Optimized for fast development rebuilds
# ==============================================================================
# Build strategy: two-stage build
#   Stage 1 (builder): installs system build tools + all Python deps
#   Stage 2 (runtime): slim image with only what's needed to run
#
# Layer order within each stage (least to most frequently changed):
#   1. Base image + system packages  (rarely changes)
#   2. uv installer                  (rarely changes)
#   3. Dependency manifests + install (changes when deps change)
#   4. Application source code       (changes frequently)
# ==============================================================================

# ---- Stage 1: Builder ----
FROM python:3.11-slim AS builder

WORKDIR /app

# System build dependencies (gcc needed for C extensions during pip install)
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv with a pinned version for reproducible builds
COPY --from=ghcr.io/astral-sh/uv:0.6.6 /uv /usr/local/bin/uv

# Copy only dependency manifests first. This layer is cached as long as
# pyproject.toml and uv.lock remain unchanged, even when source code changes.
COPY pyproject.toml uv.lock ./
COPY packages/noodle-core/pyproject.toml packages/noodle-core/pyproject.toml
COPY packages/noodle-web/pyproject.toml packages/noodle-web/pyproject.toml
COPY packages/noodle-cli/pyproject.toml packages/noodle-cli/pyproject.toml

# Create minimal package stubs so uv can resolve workspace members without
# copying the full source tree.
RUN mkdir -p packages/noodle-core/src/noodle_core \
             packages/noodle-web/src/noodle_web/static \
             packages/noodle-web/src/noodle_web/templates \
             packages/noodle-web/src/noodle_web/agents \
             packages/noodle-cli/src/noodle_cli && \
    touch packages/noodle-core/src/noodle_core/__init__.py \
          packages/noodle-web/src/noodle_web/__init__.py \
          packages/noodle-cli/src/noodle_cli/__init__.py

# Install all third-party dependencies (cache mount survives layer invalidation)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# Copy application source (ordered from least to most frequently changed)
COPY templates ./templates
COPY packages/noodle-core packages/noodle-core
COPY packages/noodle-web packages/noodle-web
COPY packages/noodle-cli packages/noodle-cli

# Re-sync to link workspace packages against real source
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# ---- Stage 2: Runtime ----
FROM python:3.11-slim AS runtime

# Create non-root user before copying files so COPY --chown works in one pass
RUN useradd -m -u 1000 appuser

WORKDIR /app

# Copy uv binary from builder
COPY --from=ghcr.io/astral-sh/uv:0.6.6 /uv /usr/local/bin/uv

# Copy the entire virtual environment and project from builder, owned by appuser
COPY --from=builder --chown=appuser:appuser /app /app

# Copy environment config
COPY --chown=appuser:appuser .env.example .env

USER appuser

EXPOSE 8007

CMD ["uv", "run", "uvicorn", "noodle_web.app:app", "--host", "0.0.0.0", "--port", "8007"]
