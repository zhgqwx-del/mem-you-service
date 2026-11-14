FROM python:3.12-slim

LABEL org.opencontainers.image.revision="f1791daa86d469249c9b002f62644d58a1eb96a0"

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MEM0_TELEMETRY=false
WORKDIR /opt/mem0-src
COPY pyproject.toml README.md LICENSE ./
COPY mem0 ./mem0
COPY server/requirements.txt /tmp/server-requirements.txt
RUN python -m pip install --no-cache-dir . -r /tmp/server-requirements.txt \
    && python -m pip check \
    && python -c 'from importlib.metadata import version; assert version("mem0ai") == "2.2.1"' \
    && python -m pip freeze > /opt/mem0-build-freeze.txt

WORKDIR /app
COPY server/*.py server/alembic.ini ./
COPY server/alembic ./alembic
COPY server/routers ./routers
COPY server/scripts ./scripts
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"]
