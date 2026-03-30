FROM python:3.13-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /opt/critjecture-python-sandbox

COPY packages/python-sandbox/pyproject.toml ./pyproject.toml
COPY packages/python-sandbox/README.md ./README.md
COPY packages/python-sandbox/uv.lock ./uv.lock

RUN uv sync --frozen --no-dev

ENV PATH="/opt/critjecture-python-sandbox/.venv/bin:${PATH}" \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1

CMD ["python", "--version"]
