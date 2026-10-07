# Paper-only SYLPH operator terminal.  Live execution requires a separately
# reviewed signer and release process and is intentionally not shipped here.
FROM node:24-bookworm-slim

WORKDIR /app

# Install python and system build essentials
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests
COPY package.json tsconfig.json ./
COPY terminal/package.json ./terminal/

# Install dependencies
RUN npm install && npm --prefix terminal install

# Copy source trees
COPY src ./src
COPY terminal ./terminal
COPY scripts ./scripts
COPY data ./data

# Compile engine and build terminal UI
RUN npm run build:engine && npm run build:ui

EXPOSE 8793

ENV NODE_ENV=production
ENV MODE=paper
ENV TERMINAL_PORT=8793

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://127.0.0.1:8793/health || exit 1

ENTRYPOINT ["node", "scripts/cloud-trading-runner.mjs"]
CMD ["--duration", "0", "--mode", "paper", "--audit-interval", "600"]
