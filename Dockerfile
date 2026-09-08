# syntax=docker/dockerfile:1

# Pulled from the AWS ECR Public mirror rather than Docker Hub directly --
# a shared build server doing many unauthenticated pulls a day can hit
# Docker Hub's anonymous rate limit; the mirror is the same official image,
# just not subject to that limit.
FROM public.ecr.aws/docker/library/python:3.13-slim
WORKDIR /app

ENV PYTHONUNBUFFERED=1
ENV PYTHONUTF8=1
ENV DATA_DIR=/data
ENV PORT=3000

RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app app

COPY requirements.txt ./
# --only-binary forces a wheel-only install: bcrypt and pydantic-core ship
# compiled (Rust) extensions, and this image has no Rust/C toolchain to
# build them from source. Better to fail the build immediately with a clear
# "no matching wheel" error than have pip silently attempt (and hang on) a
# source build that was never going to succeed here.
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt

COPY app ./app
COPY drizzle ./drizzle

RUN mkdir -p /data/uploads && chown -R app:app /data /app
VOLUME ["/data"]

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:3000/api/health').status==200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
