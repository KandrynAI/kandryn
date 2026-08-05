FROM python:3.12-slim

WORKDIR /app

# Install system deps for gitpython
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Install uv, then the graphify CLI (invoked as a subprocess, not imported).
RUN pip install uv
RUN uv tool install graphifyy==0.9.33

# Add graphify to PATH
ENV PATH="/root/.local/bin:$PATH"

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY main.py .

# Railway/Render inject $PORT; fall back to 8000 for local runs.
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
