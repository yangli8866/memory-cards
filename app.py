import json
from datetime import date
from pathlib import Path
from typing import Dict, Any, List

from flask import Flask, jsonify, request, send_from_directory

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CARDS_FILE = DATA_DIR / "cards.json"
PLANS_FILE = DATA_DIR / "plans.json"
PROGRESS_FILE = DATA_DIR / "progress.json"


def ensure_data_files() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    if not CARDS_FILE.exists():
        CARDS_FILE.write_text("[]", encoding="utf-8")
    if not PLANS_FILE.exists():
        PLANS_FILE.write_text("[]", encoding="utf-8")
    if not PROGRESS_FILE.exists():
        PROGRESS_FILE.write_text("{}", encoding="utf-8")


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def generate_card_id(cards: List[Dict[str, Any]]) -> int:
    if not cards:
        return 1
    return max(card["id"] for card in cards) + 1


def generate_plan_id(plans: List[Dict[str, Any]]) -> int:
    if not plans:
        return 1
    return max(plan["id"] for plan in plans) + 1


ensure_data_files()

app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    return send_from_directory("templates", "index.html")


@app.route("/api/cards", methods=["GET", "POST"])
def cards_collection():
    cards = read_json(CARDS_FILE, [])
    if request.method == "GET":
        return jsonify(cards)

    payload = request.get_json(force=True) or {}
    title = payload.get("title", "").strip()
    key_points = payload.get("key_points", "").strip()
    content = payload.get("content", "").strip()

    if not title:
        return jsonify({"error": "title is required"}), 400

    new_card = {
        "id": generate_card_id(cards),
        "title": title,
        "key_points": key_points,
        "content": content,
    }
    cards.append(new_card)
    write_json(CARDS_FILE, cards)
    return jsonify(new_card), 201


@app.route("/api/cards/<int:card_id>", methods=["GET", "PUT", "DELETE"])
def card_item(card_id: int):
    cards = read_json(CARDS_FILE, [])
    card = next((c for c in cards if c["id"] == card_id), None)
    if not card:
        return jsonify({"error": "card not found"}), 404

    if request.method == "GET":
        return jsonify(card)

    if request.method == "DELETE":
        cards = [c for c in cards if c["id"] != card_id]
        write_json(CARDS_FILE, cards)
        return "", 204

    # PUT
    payload = request.get_json(force=True) or {}
    card["title"] = payload.get("title", card["title"])
    card["key_points"] = payload.get("key_points", card["key_points"])
    card["content"] = payload.get("content", card["content"])
    write_json(CARDS_FILE, cards)
    return jsonify(card)


@app.route("/api/plans", methods=["GET", "POST"])
def plans_collection():
    """Plan: {id, name: str, card_ids: [int], start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD', include_in_daily: bool}"""
    plans = read_json(PLANS_FILE, [])
    if request.method == "GET":
        # Backward compatibility: older plans may not have include_in_daily or name
        changed = False
        for p in plans:
            if "include_in_daily" not in p:
                p["include_in_daily"] = True
                changed = True
            if "name" not in p:
                p["name"] = f"计划 #{p.get('id', '')}"
                changed = True
        if changed:
            write_json(PLANS_FILE, plans)
        return jsonify(plans)

    payload = request.get_json(force=True) or {}
    card_ids = payload.get("card_ids") or []
    start_date_str = payload.get("start_date")
    end_date_str = payload.get("end_date")
    include_in_daily = payload.get("include_in_daily")
    name = (payload.get("name") or "").strip()

    if not card_ids:
        return jsonify({"error": "card_ids is required"}), 400
    if not start_date_str or not end_date_str:
        return jsonify({"error": "start_date and end_date are required"}), 400

    new_id = generate_plan_id(plans)
    new_plan = {
        "id": new_id,
        "name": name or f"计划 #{new_id}",
        "card_ids": card_ids,
        "start_date": start_date_str,
        "end_date": end_date_str,
        # 默认新建计划加入每日背诵计划，除非前端显式关闭
        "include_in_daily": bool(include_in_daily) if include_in_daily is not None else True,
    }
    plans.append(new_plan)
    write_json(PLANS_FILE, plans)
    return jsonify(new_plan), 201


@app.route("/api/plans/<int:plan_id>", methods=["PUT", "DELETE"])
def plan_item(plan_id: int):
    plans = read_json(PLANS_FILE, [])
    plan = next((p for p in plans if p["id"] == plan_id), None)
    if not plan:
        return jsonify({"error": "plan not found"}), 404

    if request.method == "DELETE":
        plans = [p for p in plans if p["id"] != plan_id]
        write_json(PLANS_FILE, plans)
        return "", 204

    # PUT: update editable fields
    payload = request.get_json(force=True) or {}
    if "card_ids" in payload:
        plan["card_ids"] = payload["card_ids"]
    if "start_date" in payload:
        plan["start_date"] = payload["start_date"]
    if "end_date" in payload:
        plan["end_date"] = payload["end_date"]
    if "name" in payload:
        # 编辑模式下，如果前端显式传入 name，则无条件覆盖旧名称
        # 保留原始内容（包括可能存在的前后空格），仅在缺失 key 时才使用旧值
        incoming_name = payload.get("name")
        if incoming_name is not None:
            plan["name"] = incoming_name
    if "include_in_daily" in payload:
        plan["include_in_daily"] = bool(payload["include_in_daily"])

    write_json(PLANS_FILE, plans)
    return jsonify(plan)


@app.route("/api/today-plan", methods=["GET"])
def today_plan():
    """Return today's cards and progress.

    今日背诵卡片 = 所有时间范围覆盖今天且 include_in_daily=True 的计划里的卡片并集。
    """
    today_str = date.today().isoformat()
    cards = read_json(CARDS_FILE, [])
    plans = read_json(PLANS_FILE, [])
    progress: Dict[str, Dict[str, str]] = read_json(PROGRESS_FILE, {})

    active_card_ids: List[int] = []
    for p in plans:
        # 兼容旧数据：未设置 include_in_daily 时视为 True
        if p["start_date"] <= today_str <= p["end_date"] and p.get("include_in_daily", True):
            active_card_ids.extend(p.get("card_ids") or [])

    # unique ids while keeping order
    seen = set()
    active_card_ids_unique: List[int] = []
    for cid in active_card_ids:
        if cid not in seen:
            seen.add(cid)
            active_card_ids_unique.append(cid)

    id_set = set(active_card_ids_unique)
    active_cards = [c for c in cards if c["id"] in id_set]

    today_progress = progress.get(today_str, {})
    remembered_count = sum(1 for cid in active_card_ids_unique if today_progress.get(str(cid)) == "remembered")
    total_count = len(active_card_ids_unique)

    return jsonify(
        {
            "date": today_str,
            "cards": active_cards,
            "progress": today_progress,
            "stats": {
                "remembered": remembered_count,
                "total": total_count,
            },
        }
    )


@app.route("/api/progress", methods=["POST"])
def update_progress():
    """Payload: {card_id: int, status: 'remembered' | 'not_remembered'}"""
    payload = request.get_json(force=True) or {}
    card_id = payload.get("card_id")
    status = payload.get("status")

    if card_id is None or status not in {"remembered", "not_remembered"}:
        return jsonify({"error": "card_id and valid status are required"}), 400

    today_str = date.today().isoformat()
    progress: Dict[str, Dict[str, str]] = read_json(PROGRESS_FILE, {})
    today_progress = progress.get(today_str, {})
    today_progress[str(card_id)] = status
    progress[today_str] = today_progress
    write_json(PROGRESS_FILE, progress)
    return jsonify({"date": today_str, "card_id": card_id, "status": status})


if __name__ == "__main__":
    app.run(debug=True)

