import os
import json
import tempfile
import shutil
import asyncio
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel
import git
import httpx

app = FastAPI(title="Kandryn Graphify Service")

# Simple auth — Kandryn API sends this header
GRAPHIFY_SERVICE_SECRET = os.environ.get("GRAPHIFY_SERVICE_SECRET", "")


def check_auth(x_service_secret: str = Header(default="")):
    if GRAPHIFY_SERVICE_SECRET and x_service_secret != GRAPHIFY_SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized")


class IndexRequest(BaseModel):
    repo_url: str        # e.g. https://github.com/owner/repo
    github_token: str    # user's GitHub PAT
    repo_id: int         # Kandryn repository ID
    callback_url: str    # Kandryn endpoint to POST graph when done


class QueryRequest(BaseModel):
    graph: dict          # the graph.json content
    query: str           # plain text query
    max_results: int = 8


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/index")
async def index_repository(
    req: IndexRequest,
    background_tasks: BackgroundTasks,
    x_service_secret: str = Header(default="")
):
    """
    Clone the repo, run graphify build, POST graph.json to callback_url.
    Runs in background — returns 202 immediately.
    """
    check_auth(x_service_secret)
    background_tasks.add_task(
        _index_and_callback, req.repo_url, req.github_token,
        req.repo_id, req.callback_url
    )
    return {"status": "indexing", "repo_id": req.repo_id}


async def _index_and_callback(
    repo_url: str, github_token: str, repo_id: int, callback_url: str
):
    tmpdir = None
    try:
        # Clone with token auth
        auth_url = repo_url.replace(
            "https://", f"https://{github_token}@"
        )
        tmpdir = tempfile.mkdtemp(prefix="bm_graph_")
        git.Repo.clone_from(auth_url, tmpdir, depth=1)

        # Run graphify — code only, no HTML (smaller output)
        proc = await asyncio.create_subprocess_exec(
            "graphify", "extract", tmpdir,
            "--code-only", "--no-viz", "--no-cluster",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=tmpdir,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)

        graph_path = Path(tmpdir) / "graphify-out" / "graph.json"
        if not graph_path.exists():
            await _post_callback(callback_url, repo_id, None,
                                 f"graphify produced no graph: {stderr.decode()[:500]}")
            return

        graph = json.loads(graph_path.read_text())
        await _post_callback(callback_url, repo_id, graph, None)

    except asyncio.TimeoutError:
        await _post_callback(callback_url, repo_id, None,
                             "Graphify indexing timed out after 120s")
    except Exception as e:
        await _post_callback(callback_url, repo_id, None, str(e)[:500])
    finally:
        if tmpdir:
            shutil.rmtree(tmpdir, ignore_errors=True)


async def _post_callback(callback_url, repo_id, graph, error):
    async with httpx.AsyncClient(timeout=30) as client:
        await client.post(callback_url, json={
            "repo_id": repo_id,
            "graph":   graph,
            "error":   error,
        }, headers={"x-service-secret": GRAPHIFY_SERVICE_SECRET})


@app.post("/query")
def query_graph(
    req: QueryRequest,
    x_service_secret: str = Header(default="")
):
    """
    Query a graph.json (already stored in Kandryn DB) with a
    plain text query. Returns relevant node list.
    """
    check_auth(x_service_secret)

    # Simple keyword scoring (mirrors Phase 1 JS logic)
    keywords = req.query.lower().split()
    nodes    = req.graph.get("nodes", [])
    edges    = req.graph.get("edges", [])

    scored = []
    for node in nodes:
        label  = node.get("label",       "").lower()
        file   = node.get("sourceFile",  "").lower()
        degree = node.get("degree",       0) or 0
        score  = 0
        for kw in keywords:
            if label == kw:         score += 10
            elif label.find(kw) >= 0: score += 5
            if file.find(kw) >= 0:  score += 3
        score += min(degree * 0.1, 2)
        if score > 0:
            scored.append((score, node))

    scored.sort(key=lambda x: -x[0])
    top = [n for _, n in scored[:req.max_results]]

    # One hop: direct edges from top nodes
    top_ids = {n["id"] for n in top}
    neighbor_ids = set()
    for edge in edges:
        if edge.get("relation") in ("calls", "imports", "imports_from"):
            if edge["source"] in top_ids:
                neighbor_ids.add(edge["target"])
            elif edge["target"] in top_ids:
                neighbor_ids.add(edge["source"])

    neighbors = [
        n for n in nodes
        if n["id"] in neighbor_ids and n["id"] not in top_ids
    ][:req.max_results]

    return {
        "direct":    top,
        "neighbors": neighbors,
        "query":     req.query,
    }
