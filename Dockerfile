# Build stage: collect only the application files needed at runtime.
FROM python:3.12-slim AS build
WORKDIR /app
COPY index.html style.css servidor.py ./
COPY js/ ./js/
COPY sounds/ ./sounds/

# Runtime stage: standard-library-only app, non-root user, persistent data mount.
FROM python:3.12-slim AS runtime
ENV PORT=8080 \
    HOST=0.0.0.0 \
    DB_PATH=/data/alquimia.db \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --no-create-home app \
    && mkdir -p /data \
    && chown app:app /data
COPY --from=build --chown=app:app /app/ ./
VOLUME ["/data"]
EXPOSE 8080
USER app
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"]
CMD ["python", "servidor.py"]
