import urllib.request
import json
import time

schedules = [
    {
        "project": "Aビル新築工事",
        "author": "山田 太郎",
        "start": "2026-05-01",
        "end": "2026-05-15",
        "notes": "基本設計図面の作成"
    },
    {
        "project": "E病院増築工事",
        "author": "山田 太郎",
        "start": "2026-05-10",
        "end": "2026-05-25",
        "notes": "設備担当との打ち合わせと反映"
    },
    {
        "project": "Cタワー設計",
        "author": "佐藤 花子",
        "start": "2026-05-05",
        "end": "2026-05-31",
        "notes": "意匠図面一式の作成"
    },
    {
        "project": "B商業施設改修",
        "author": "佐藤 花子",
        "start": "2026-05-20",
        "end": "2026-06-10",
        "notes": "内装パース作成・展開図"
    },
    {
        "project": "Dマンション改修",
        "author": "鈴木 一郎",
        "start": "2026-05-01",
        "end": "2026-05-20",
        "notes": "既存図面のトレースと修正"
    },
    {
        "project": "F学校耐震補強",
        "author": "鈴木 一郎",
        "start": "2026-05-15",
        "end": "2026-06-05",
        "notes": "構造計算書に基づく補強図面作成"
    }
]

for s in schedules:
    s["timestamp"] = "2026-05-20T18:00:00.000Z"
    req = urllib.request.Request('http://localhost:3000/api/schedules', data=json.dumps(s).encode('utf-8'), headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req)

print("予定（スケジュール）のテストデータを登録しました。")
