# Docs container: builds Sphinx docs and serves with lightweight HTTP server
FROM python:3.11-slim AS builder

WORKDIR /docs

# Install Sphinx and theme
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy docs source
COPY . .

# Build HTML
RUN sphinx-build -M html . _build

# Serve with a minimal image
FROM python:3.11-slim

WORKDIR /docs

COPY --from=builder /docs/_build/html /docs/html

EXPOSE 8008

CMD ["python", "-m", "http.server", "8008", "--directory", "/docs/html"]
