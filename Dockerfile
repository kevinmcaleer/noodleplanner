FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including curl for uv installation
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Copy workspace configuration first for better caching
COPY pyproject.toml uv.lock .

# Copy all packages
COPY packages ./packages

# Copy tests for running in container
COPY tests ./tests
COPY pytest.ini .

# Copy project templates
COPY templates ./templates

# Add cache-busting argument for app code
ARG CACHEBUST=1

# Install workspace with uv
RUN uv sync --frozen

# Copy additional runtime files
COPY .env.example .env

# Create a non-root user
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8007

# Run the web application using uv
CMD ["uv", "run", "uvicorn", "noodle_web.app:app", "--host", "0.0.0.0", "--port", "8007"]
