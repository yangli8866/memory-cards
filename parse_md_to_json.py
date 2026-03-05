import sys
import json
from pathlib import Path
from typing import List, Dict


def parse_markdown_to_records(md_text: str) -> List[Dict[str, str]]:
    lines = md_text.splitlines()

    records = []
    current_title = None
    current_lines: List[str] = []

    def flush_record():
        nonlocal current_title, current_lines
        if current_title is None:
            return
        block_text = "\n".join(current_lines).rstrip()

        # 提取所有二级标题作为 key_points
        key_points_list = []
        for line in current_lines:
            stripped = line.lstrip()
            if stripped.startswith("## "):
                key_points_list.append(stripped[3:].strip())
        key_points = "、".join(key_points_list)

        records.append(
            {
                "title": current_title,
                "key_points": key_points,
                "content": block_text,
            }
        )
        current_title = None
        current_lines = []

    for idx, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith("# "):  # 一级标题
            # 先把上一个一级标题块写入
            flush_record()
            current_title = stripped[2:].strip()
            current_lines = [line]  # 内容包含这一行（保留原始 markdown）
        else:
            if current_title is not None:
                current_lines.append(line)
            else:
                # 文件开头可能存在非标题内容，直接忽略
                continue

    # 最后一个块
    flush_record()
    return records


def main():
    if len(sys.argv) != 3:
        print("用法: python parse_md_to_json.py <input_md> <output_json>")
        sys.exit(1)

    input_md = Path(sys.argv[1])
    output_json = Path(sys.argv[2])

    if not input_md.is_file():
        print(f"找不到输入文件: {input_md}")
        sys.exit(1)

    text = input_md.read_text(encoding="utf-8")
    records = parse_markdown_to_records(text)

    # 写出 JSON，UTF-8 且保留中文
    output_json.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"已解析 {len(records)} 条记录，写入 {output_json}")


main()