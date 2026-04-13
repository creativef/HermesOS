FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY wiki_server.py .
COPY templates ./templates
COPY static ./static

ENV PORT=5001
EXPOSE 5001

CMD ["python", "wiki_server.py"]

