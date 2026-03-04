# ==============================================================================
# NoodlePlanner Dockerfile - Optimized for fast development rebuilds
# ==============================================================================
# Layer order (least to most frequently changed):
#   1. System dependencies (rarely changes)
#   2. uv installer (rarely changes)
#   3. Dependency manifests + install (changes when deps change)
#   4. Application source code (changes frequently)
#   5. Runtime configuration (rarely changes)
# ==============================================================================

FROM python:3.11-slim

WORKDIR /app

# ---------- Layer 1: System dependencies (rarely changes) ----------
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---------- Layer 2: Install uv (rarely changes) ----------
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# ---------- Layer 3: Dependency install (changes only when deps change) ----------
# Copy only the dependency manifests first. This layer is cached as long as
# pyproject.toml and uv.lock files remain unchanged, even if source code changes.
COPY pyproject.toml uv.lock ./
COPY packages/noodle-core/pyproject.toml packages/noodle-core/pyproject.toml
COPY packages/noodle-web/pyproject.toml packages/noodle-web/pyproject.toml
COPY packages/noodle-cli/pyproject.toml packages/noodle-cli/pyproject.toml

# Create minimal package stubs so uv can resolve workspace members without
# copying the full source tree. This keeps the dependency layer independent
# of source code changes.
RUN mkdir -p packages/noodle-core/src/noodle_core && \
    touch packages/noodle-core/src/noodle_core/__init__.py && \
    mkdir -p packages/noodle-web/src/noodle_web && \
    touch packages/noodle-web/src/noodle_web/__init__.py && \
    mkdir -p packages/noodle-cli/src/noodle_cli && \
    touch packages/noodle-cli/src/noodle_cli/__init__.py

# Install dependencies with a cache mount to speed up rebuilds even when
# the dependency layer is invalidated (uv reuses cached downloads).
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# ---------- Layer 4: Application source code (changes frequently) ----------
# Copy only the packages needed at runtime (excludes noodle-ios, obsidian-noodle-planner)
COPY packages/noodle-core packages/noodle-core
COPY packages/noodle-web packages/noodle-web
COPY packages/noodle-cli packages/noodle-cli

# Copy project templates and test infrastructure
COPY templates ./templates
COPY tests ./tests
COPY pytest.ini .

# Copy alembic migration configuration
COPY alembic.ini .
COPY alembic ./alembic

# Re-sync to register the real source (uses cached deps, only links packages)
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen

# ---------- Layer 5: Runtime configuration ----------
COPY .env.example .env

# Create a non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8007

CMD ["uv", "run", "uvicorn", "noodle_web.app:app", "--host", "0.0.0.0", "--port", "8007"]
