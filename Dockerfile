# LORAN — one image serving both the built frontend and the API on a single origin (D-045).
#
# Single origin is not a packaging convenience, it is what makes the session cookie same-site by
# construction and leaves exactly one port to publish or tunnel. Same reason scripts/serve.sh
# exists for the bare-metal path; both paths stay first-class (D-019).
#
#   docker compose up --build          # reads .env at RUN time
#   docker build -t loran . && docker run --env-file .env -p 8010:8010 loran
#
# NOTHING is configured at build time. No secret, no home coordinate, no token is baked into a
# layer - .dockerignore excludes .env from the context entirely, so it cannot happen by accident.

# ---------------------------------------------------------------------------
# Stage 1: build the frontend.
#
# The whole repo root is the context because the build needs scripts/check_palette.mjs, which
# lives outside frontend/ deliberately - it is the guard that fails the build when palette.ts
# drifts from tokens.css (D-042).
# ---------------------------------------------------------------------------
FROM node:22-slim AS frontend

WORKDIR /build

# Dependencies first, so a source-only change does not re-run npm ci.
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

COPY scripts/check_palette.mjs ./scripts/
COPY frontend/ ./frontend/

# Runs cesium:assets (copies Cesium Workers/Assets/Widgets/ThirdParty out of node_modules),
# check:palette, tsc --noEmit, then vite build. A type error or a palette drift fails the image
# build rather than shipping quietly.
RUN cd frontend && npm run build

# ---------------------------------------------------------------------------
# Stage 2: the runtime. Python only - no node, no build tools, no source maps.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# Unbuffered so container logs appear in `docker logs` immediately rather than on flush.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LORAN_STATIC_DIR=/app/static \
    LORAN_PORT=8010

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend /build/frontend/dist/ ./static/

# Run unprivileged. The app writes nothing to disk today; when the Phase 5 recorder lands it
# will need a mounted volume owned by this uid rather than a writable image.
RUN useradd --system --create-home --uid 10001 loran && chown -R loran:loran /app
USER loran

# The ONE thing baked in at build time, and the exception the header note above is worth reading
# against: this is not configuration, it is an immutable fact ABOUT the layer - which commit it
# was built from. It has to be baked in precisely because it identifies the image; passing it at
# run time would let a container claim any SHA it liked, which is the opposite of provenance.
# It is not a secret: the repo is public.
#
# Placed last so that changing it invalidates nothing above - a new commit re-runs this layer
# alone, not npm ci or the Vite build.
#
#   docker build --build-arg BUILD_SHA=$(git rev-parse HEAD) -t loran:local .
#
# Empty when nobody passes it (a plain `docker build`, or the bare-metal path), and /api/health
# then reports null rather than lying about a commit.
ARG BUILD_SHA=""
ENV LORAN_BUILD_SHA=$BUILD_SHA

EXPOSE 8010

# No curl in slim, and adding it just for a healthcheck is a package for nothing. /api/health is
# deliberately open (it reports uptime and feed status only, never positions), so it works as a
# probe even when access tokens are configured.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python3 -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8010/api/health', timeout=4).status==200 else 1)"

# 0.0.0.0, unlike serve.sh's 127.0.0.1: inside a container, loopback is unreachable from the
# host. The container boundary is the isolation, and access control is LORAN_ACCESS_TOKENS -
# so do NOT publish this port to a public interface without tokens configured.
CMD ["python3", "-m", "uvicorn", "app.main:app", "--app-dir", "backend", \
     "--host", "0.0.0.0", "--port", "8010"]
