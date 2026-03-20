from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.routers import requests, analysis, whitespace
from backend.data_loader import get_data

app = FastAPI(title="ChainIQ Sourcing Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(requests.router)
app.include_router(analysis.router)
app.include_router(whitespace.router)


@app.on_event("startup")
async def startup():
    get_data()  # preload


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
