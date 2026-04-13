import os
import pathlib
from datetime import datetime

import yaml
from flask import Flask, jsonify, render_template, abort, send_from_directory
from flask import request
from markdown import markdown


def find_wiki_path() -> pathlib.Path:
    env = os.environ.get("WIKI_PATH", "").strip()
    candidates = [
        env,
        "/app/wiki",
        "/opt/hermes/wiki",
        str(pathlib.Path.home() / "wiki"),
        str(pathlib.Path(__file__).resolve().parent.parent.parent / "wiki"),
    ]
    for c in candidates:
        if not c:
            continue
        p = pathlib.Path(c).expanduser().resolve()
        if p.exists() and p.is_dir():
            return p
    return pathlib.Path.cwd()


WIKI_ROOT = find_wiki_path()

app = Flask(__name__, template_folder="templates", static_folder="static", static_url_path="/static")


def parse_frontmatter(text: str):
    if not text.startswith("---"):
        return {}, text
    parts = text.split("\n")
    if len(parts) < 3:
        return {}, text
    try:
        # Find the closing '---'
        end_idx = None
        for i in range(1, len(parts)):
            if parts[i].strip() == "---":
                end_idx = i
                break
        if end_idx is None:
            return {}, text
        yaml_block = "\n".join(parts[1:end_idx])
        meta = yaml.safe_load(yaml_block) or {}
        body = "\n".join(parts[end_idx + 1 :])
        if not isinstance(meta, dict):
            meta = {}
        return meta, body
    except Exception:
        return {}, text


def relpath_for(path: pathlib.Path) -> str:
    return str(path.resolve().relative_to(WIKI_ROOT.resolve())).replace("\\", "/")


def read_page(path: pathlib.Path):
    content = path.read_text(encoding="utf-8", errors="ignore")
    meta, body = parse_frontmatter(content)
    stat = path.stat()
    title = str(meta.get("title") or path.stem).strip()
    page_type = str(meta.get("type") or "").strip() or "unknown"
    tags = meta.get("tags") if isinstance(meta.get("tags"), list) else []
    updated = meta.get("updated")
    if not updated:
        updated = datetime.utcfromtimestamp(stat.st_mtime).strftime("%Y-%m-%d")
    return {
        "title": title,
        "type": page_type,
        "tags": tags,
        "updated": updated,
        "path": relpath_for(path),
        "full_path": str(path.resolve()),
        "content": content,
        "meta": meta,
        "body": body,
    }


def list_pages():
    pages = []
    for p in sorted(WIKI_ROOT.rglob("*.md")):
        # Skip hidden / build dirs
        if any(part.startswith(".") for part in p.parts):
            continue
        try:
            pages.append(read_page(p))
        except Exception:
            continue
    # Most recently updated first (best-effort)
    def sort_key(x):
        return str(x.get("updated") or ""), x.get("path") or ""

    pages.sort(key=sort_key, reverse=True)
    return pages


@app.get("/health")
def health():
    return jsonify({"ok": True, "wiki_root": str(WIKI_ROOT)})


@app.get("/")
def dashboard():
    return render_template("dashboard.html")


@app.get("/api/pages")
def api_pages():
    include_content = request.args.get("includeContent", "1") != "0"
    pages = list_pages()
    if not include_content:
        for p in pages:
            p.pop("content", None)
            p.pop("body", None)
    # Match the expected schema fields
    out = []
    for p in pages:
        out.append(
            {
                "title": p.get("title"),
                "type": p.get("type"),
                "tags": p.get("tags") or [],
                "updated": p.get("updated"),
                "path": p.get("path"),
                "full_path": p.get("full_path"),
                "content": p.get("content") if include_content else None,
            }
        )
    return jsonify(out)


@app.get("/view/<path:file_path>")
def view_page(file_path: str):
    safe = (WIKI_ROOT / file_path).resolve()
    if not str(safe).startswith(str(WIKI_ROOT.resolve())):
        abort(404)
    if not safe.exists() or not safe.is_file():
        abort(404)
    page = read_page(safe)
    html = markdown(
        page["body"],
        extensions=["fenced_code", "codehilite", "tables", "toc"],
        output_format="html5",
    )
    return render_template(
        "page_view.html",
        title=page["title"],
        meta=page["meta"],
        tags=page["tags"] or [],
        page_type=page["type"],
        updated=page["updated"],
        path=page["path"],
        html=html,
    )


@app.get("/static/<path:filename>")
def static_files(filename: str):
    return send_from_directory(app.static_folder, filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5001"))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"[wiki-server] wiki_root={WIKI_ROOT} host={host} port={port}")
    app.run(host=host, port=port, debug=False)

