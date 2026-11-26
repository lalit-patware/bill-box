import logging

from fastapi import FastAPI

from app.routers import extraction

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="billvault API", version="0.1.0")
app.include_router(extraction.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
