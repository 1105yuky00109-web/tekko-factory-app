const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const dummySchedules = [
    { author: "山田", project: "Aビル新築工事", start: "2026-05-01", end: "2026-05-15", notes: "基本設計・平面図の作成", timestamp: new Date().toISOString() },
    { author: "山田", project: "Bショッピングモール改装", start: "2026-05-16", end: "2026-05-31", notes: "内装デザインパース作成", timestamp: new Date().toISOString() },
    { author: "佐藤", project: "Cタワー設計", start: "2026-05-01", end: "2026-05-20", notes: "構造計算書の確認・修正", timestamp: new Date().toISOString() },
    { author: "佐藤", project: "Dマンション大規模修繕", start: "2026-05-18", end: "2026-05-31", notes: "足場計画図の作成", timestamp: new Date().toISOString() },
    { author: "鈴木", project: "E物流倉庫計画", start: "2026-05-01", end: "2026-05-14", notes: "配置図・設備図の調整", timestamp: new Date().toISOString() },
    { author: "鈴木", project: "F駅前再開発プロジェクト", start: "2026-05-15", end: "2026-05-31", notes: "地下階の配管ルート検討", timestamp: new Date().toISOString() }
];

const dummyReports = [];
const weeks = ["2026-W19", "2026-W20", "2026-W21", "2026-W22"];

weeks.forEach((w, index) => {
    // 山田のデータ
    dummyReports.push({
        author: "山田", week: w, timestamp: new Date().toISOString(),
        actual: "今週の作業は順調に進行しました。一部設計変更あり。",
        plan: "引き続き予定通り図面作成を進めます。",
        notes: "クライアントとの定例会議議事録を確認してください。",
        dailyLogs: {
            "月": [{ project: index < 2 ? "Aビル新築工事" : "Bショッピングモール改装", detail: "図面作成", hours: "8.0" }],
            "火": [{ project: index < 2 ? "Aビル新築工事" : "Bショッピングモール改装", detail: "図面作成", hours: "8.0" }],
            "水": [{ project: index < 2 ? "Aビル新築工事" : "Bショッピングモール改装", detail: "チェックバック対応", hours: "8.0" }],
            "木": [{ project: index < 2 ? "Aビル新築工事" : "Bショッピングモール改装", detail: "修正作業", hours: "8.0" }],
            "金": [{ project: index < 2 ? "Aビル新築工事" : "Bショッピングモール改装", detail: "成果物提出", hours: "8.0" }]
        }
    });
    // 佐藤のデータ
    dummyReports.push({
        author: "佐藤", week: w, timestamp: new Date().toISOString(),
        actual: "構造計算の確認に少し時間がかかりましたが、問題ありません。",
        plan: "修繕計画のラフ案を作成します。",
        notes: "特になし",
        dailyLogs: {
            "月": [{ project: "Cタワー設計", detail: "構造計算書のレビュー", hours: "8.0" }],
            "火": [{ project: index < 2 ? "Cタワー設計" : "Dマンション大規模修繕", detail: "現地調査", hours: "8.0" }],
            "水": [{ project: index < 2 ? "Cタワー設計" : "Dマンション大規模修繕", detail: "ラフ作成", hours: "8.0" }],
            "木": [{ project: "Dマンション大規模修繕", detail: "図面化", hours: "8.0" }],
            "金": [{ project: "Dマンション大規模修繕", detail: "確認と修正", hours: "8.0" }]
        }
    });
    // 鈴木のデータ
    dummyReports.push({
        author: "鈴木", week: w, timestamp: new Date().toISOString(),
        actual: "設備図の配管ルートで他業者と調整がありました。",
        plan: "調整事項を図面に反映します。",
        notes: "F案件の資料共有をお願いします。",
        dailyLogs: {
            "月": [{ project: index < 2 ? "E物流倉庫計画" : "F駅前再開発プロジェクト", detail: "配置図の作成", hours: "8.0" }],
            "火": [{ project: index < 2 ? "E物流倉庫計画" : "F駅前再開発プロジェクト", detail: "設備業者との打ち合わせ", hours: "4.0" }],
            "水": [{ project: index < 2 ? "E物流倉庫計画" : "F駅前再開発プロジェクト", detail: "図面への落とし込み", hours: "8.0" }],
            "木": [{ project: index < 2 ? "E物流倉庫計画" : "F駅前再開発プロジェクト", detail: "配管ルート修正", hours: "8.0" }],
            "金": [{ project: index < 2 ? "E物流倉庫計画" : "F駅前再開発プロジェクト", detail: "最終図面提出", hours: "8.0" }]
        }
    });
});

async function seedData() {
    try {
        // Schedules投入
        for (const sched of dummySchedules) {
            await addDoc(collection(db, "schedules"), sched);
        }
        // Reports投入
        for (const rep of dummyReports) {
            await addDoc(collection(db, "reports"), rep);
        }
        
        document.getElementById('loading').style.display = 'none';
        document.getElementById('status').textContent = 'テストデータの投入が完了しました！';
        document.getElementById('status').style.color = '#16a34a';
        document.getElementById('back-btn').style.display = 'inline-block';
        
    } catch (e) {
        console.error(e);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('status').textContent = 'エラーが発生しました: ' + e.message;
        document.getElementById('status').style.color = '#dc2626';
    }
}

seedData();
