FROM python:3.12-slim

# System deps: ffmpeg for video processing
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3-pip \
 && pip install --no-cache-dir yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# SQLite DB lives in /app/data — mounted as a volume for persistence
RUN mkdir -p /app/data

EXPOSE 8080

CMD ["python", "server.py"]
