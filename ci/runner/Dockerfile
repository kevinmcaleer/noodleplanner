# A self-hosted GitHub Actions runner with everything NoodlePlanner's CI jobs
# need: uv + Python 3.12, Node 22, and a Chromium the browser suites can drive.
#
# Why a container rather than the runner installed on the host: the host also
# runs production (the root docker-compose.yml bind-mounts ./packages and
# ./templates into a live --reload container on :8007), and a CI job that can
# write to the host filesystem is a CI job that can deploy by accident. The
# runner gets its own filesystem and its own ephemeral checkout under
# /home/runner/_work.
#
# Debian bookworm rather than Ubuntu 24.04, for one specific reason: the
# browser tests hardcode /usr/bin/chromium and /usr/bin/chromedriver (see
# _create_chrome_driver in tests/test_task_peek.py and friends). Debian ships
# both as real packages at exactly those paths; Ubuntu 24.04 ships Chromium only
# as a snap, which does not work in a container at all. So the suites run here
# unmodified.
FROM debian:bookworm-slim

ARG RUNNER_VERSION=2.328.0
ARG RUNNER_ARCH=x64

ENV DEBIAN_FRONTEND=noninteractive \
    RUNNER_MANUALLY_TRAP_SIG=1 \
    ACTIONS_RUNNER_PRINT_LOG_TO_STDOUT=1

# The first group is the runner's own needs, the second is what the .NET host
# the runner is built on links against, the third is Chromium and the fonts the
# PDF/DOCX export tests render with.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq tar unzip gzip sudo xz-utils \
      libicu72 libssl3 liblttng-ust1 libkrb5-3 zlib1g libstdc++6 \
      chromium chromium-driver \
      fonts-dejavu-core fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Node 22 -- the version the workflows pinned and package.json's test:js expects.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash runner \
    && echo "runner ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/runner

USER runner
WORKDIR /home/runner

RUN curl -fsSL -o runner.tar.gz \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz" \
    && tar xzf runner.tar.gz && rm runner.tar.gz

# uv, and a pinned interpreter, so `uv sync` never has to fetch one mid-job.
RUN curl -fsSL https://astral.sh/uv/install.sh | sh
ENV PATH="/home/runner/.local/bin:${PATH}"
RUN uv python install 3.12

# Read by ci_find_browser() in ci/lib.sh, which uses it to decide whether the
# usability job can run at all. The test files find this same binary through
# their own /usr/bin/chromium lookup.
ENV CHROME_BIN=/usr/bin/chromium

COPY --chown=runner:runner entrypoint.sh /home/runner/entrypoint.sh
RUN chmod +x /home/runner/entrypoint.sh

ENTRYPOINT ["/home/runner/entrypoint.sh"]
