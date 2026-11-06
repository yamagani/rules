FROM python:3.12-slim
RUN pip install --no-cache-dir uv==0.9.*
WORKDIR /srv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/srv/.venv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . .
ENV PATH="/srv/.venv/bin:$PATH"
EXPOSE 8000
CMD ["sh", "scripts/start.sh"]
