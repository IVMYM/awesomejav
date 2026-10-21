#!/usr/bin/env python3
"""Absorb user screenshots into public/samples and rebuild thumbs.

Intended Drive layout (Google Drive folder「番号截图」):
  番号截图/{CODE}/*.jpg|png|webp
  folderId: 15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl
  URL: https://drive.google.com/drive/folders/15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl

Agent sync (Drive MCP, not callable from this script):
  1. list children of folderId via user-Google-drive MCP
  2. for each CODE subfolder, download_file_content / DownloadFile into
     /workspace/jav-site/inbox/{CODE}/
  3. run:  python3 sync_drive_uploads.py [--code CODE] [--inbox DIR]
  4. this script copies as public/samples/{CODE}/u01.jpg …, updates samples.json,
     regenerates thumbs under public/thumbs/samples/{CODE}/
  5. python3 deploy.py --no-scrape  then MCP upload + create_deployment

Local / inbox absorb:
  python3 sync_drive_uploads.py                 # all codes under inbox/
  python3 sync_drive_uploads.py --code OKB-197  # one code
  python3 sync_drive_uploads.py --paths a.jpg b.png --code OKB-197
"""
from __future__ import annotations
import argparse, json, os, re, shutil, sys
from datetime import datetime
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = Path(__file__).resolve().parent
PUB = ROOT / "public"
SAMPLES = PUB / "samples"
THUMBS = PUB / "thumbs" / "samples"
SAMPLES_JSON = PUB / "samples.json"
DRIVE_CFG = ROOT / "data" / "drive_uploads.json"
INBOX = ROOT / "inbox"
CODE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{1,32}$")
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def load_drive_cfg() -> dict:
    if DRIVE_CFG.exists():
        return json.loads(DRIVE_CFG.read_text())
    return {
        "folderId": "15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl",
        "folderName": "番号截图",
        "url": "https://drive.google.com/drive/folders/15nFZ_HG6lJJEUHFP2VWQ2fwdTW6E-phl",
    }


def load_samples() -> dict:
    if SAMPLES_JSON.exists():
        return json.loads(SAMPLES_JSON.read_text())
    return {"updated": "", "samples": {}}


def save_samples(data: dict) -> None:
    data["updated"] = datetime.now().strftime("%Y-%m-%d %H:%M")
    SAMPLES_JSON.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def next_u_index(code_dir: Path) -> int:
    n = 0
    if code_dir.exists():
        for p in code_dir.iterdir():
            m = re.match(r"^u(\d+)\.", p.name, re.I)
            if m:
                n = max(n, int(m.group(1)))
    return n + 1


def make_thumb(src: Path, dest: Path, max_w: int = 480) -> None:
    if Image is None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        w, h = im.size
        if w > max_w:
            nh = max(1, int(h * max_w / w))
            im = im.resize((max_w, nh), Image.Resampling.LANCZOS)
        im.save(dest, "JPEG", quality=72, optimize=True)


def merge_user_samples(code: str, file_paths: list[str | Path]) -> list[str]:
    """Copy files into public/samples/{CODE}/uNN.*, thumbs, update samples.json.

    Returns the new relative paths added (samples/CODE/uNN.jpg).
    """
    code = str(code or "").upper().strip()
    if not CODE_RE.match(code):
        raise ValueError(f"invalid code: {code}")
    paths = [Path(p) for p in file_paths if Path(p).is_file() and Path(p).suffix.lower() in IMG_EXT]
    if not paths:
        return []

    code_dir = SAMPLES / code
    code_dir.mkdir(parents=True, exist_ok=True)
    idx = next_u_index(code_dir)
    added_rel: list[str] = []
    for src in paths:
        ext = src.suffix.lower()
        if ext == ".jpeg":
            ext = ".jpg"
        name = f"u{idx:02d}{ext}"
        dest = code_dir / name
        shutil.copy2(src, dest)
        thumb_dest = THUMBS / code / name
        if thumb_dest.suffix.lower() in (".png", ".webp", ".gif"):
            thumb_dest = thumb_dest.with_suffix(".jpg")
        make_thumb(dest, thumb_dest)
        # store path matching existing samples.json style (samples/CODE/file)
        rel = f"samples/{code}/{name}"
        added_rel.append(rel)
        idx += 1

    data = load_samples()
    cur = list(data.setdefault("samples", {}).get(code, []))
    for rel in added_rel:
        if rel not in cur:
            cur.append(rel)
    data["samples"][code] = cur
    save_samples(data)
    print(f"merge_user_samples {code}: +{len(added_rel)} -> {code_dir}")
    return added_rel


def absorb_inbox(inbox: Path, only_code: str | None = None) -> dict[str, list[str]]:
    """Walk inbox/{CODE}/* and merge. Returns {code: [rel paths]}."""
    out: dict[str, list[str]] = {}
    if not inbox.is_dir():
        print(f"inbox missing: {inbox}")
        return out
    for d in sorted(inbox.iterdir()):
        if not d.is_dir():
            continue
        code = d.name.upper()
        if only_code and code != only_code.upper():
            continue
        if not CODE_RE.match(code):
            print(f"skip bad folder name: {d.name}")
            continue
        files = sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in IMG_EXT)
        if not files:
            continue
        out[code] = merge_user_samples(code, files)
    return out


def print_drive_help() -> None:
    cfg = load_drive_cfg()
    print("=== Drive sync helper (agent / routine) ===")
    print(f"folderId:   {cfg.get('folderId')}")
    print(f"folderName: {cfg.get('folderName')}")
    print(f"url:        {cfg.get('url')}")
    print("layout:     番号截图/{CODE}/*.jpg|png|webp")
    print()
    print("MCP steps (user-Google-drive):")
    print("  1. list / search children under folderId")
    print("  2. DownloadFile or download_file_content -> /workspace/jav-site/inbox/{CODE}/")
    print("  3. python3 sync_drive_uploads.py")
    print("  4. python3 deploy.py --no-scrape && MCP upload_file + create_deployment")
    print()
    print("This Python process cannot call Drive MCP; parent agent must download first.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--code", help="番号 CODE")
    ap.add_argument("--inbox", default=str(INBOX), help="inbox root (default: jav-site/inbox)")
    ap.add_argument("--paths", nargs="*", help="explicit image paths (requires --code)")
    ap.add_argument("--help-drive", action="store_true", help="print Drive MCP sync instructions")
    args = ap.parse_args()

    if args.help_drive or (not args.paths and not Path(args.inbox).is_dir() and not args.code):
        print_drive_help()
        if args.help_drive:
            return 0

    if args.paths:
        if not args.code:
            print("--paths requires --code", file=sys.stderr)
            return 2
        merge_user_samples(args.code, args.paths)
        return 0

    absorb_inbox(Path(args.inbox), args.code)
    print_drive_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
