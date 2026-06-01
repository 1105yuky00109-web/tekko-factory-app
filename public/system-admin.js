const firebaseConfig = {
    apiKey: "AIzaSyBero5buqjW670UPObtf4QiVX-rkhhFfPs",
    authDomain: "weekly-report-93e5f.firebaseapp.com",
    projectId: "weekly-report-93e5f",
    storageBucket: "weekly-report-93e5f.firebasestorage.app",
    messagingSenderId: "905872831436",
    appId: "1:905872831436:web:1367ad0b1d54d9bba7a369"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, query } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 開発者以外のログインを弾くためのメールリスト
const DEVELOPER_EMAILS = ['1105yuky00109@gmail.com'];

let currentUser = null;
let allReports = [];
let allCompanies = [];
let selectedCompanyFilter = '';

// DOM要素
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');
const currentEmailLabel = document.getElementById('current-user-email');

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    if (user && DEVELOPER_EMAILS.includes(user.email)) {
        currentUser = user;
        if (currentEmailLabel) currentEmailLabel.textContent = user.email;
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        
        // 初回ロード
        await reloadData();
    } else {
        if (user) {
            // 開発者以外の場合はログアウト
            await signOut(auth);
            alert("この画面は開発者専用です。一般ユーザーはアクセスできません。");
        }
        currentUser = null;
        loginContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
});

// ログイン処理
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');
    
    if (!DEVELOPER_EMAILS.includes(email)) {
        errorMsg.classList.remove('hidden');
        errorMsg.textContent = 'ログイン権限がありません。開発者のメールアドレスを入力してください。';
        return;
    }

    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            errorMsg.classList.add('hidden');
        })
        .catch((error) => {
            console.error(error);
            errorMsg.classList.remove('hidden');
            errorMsg.textContent = 'ログインに失敗しました。認証情報を確認してください。';
        });
});

// ログアウト処理
btnLogout.addEventListener('click', () => {
    signOut(auth).catch(err => console.error(err));
});

// Firestoreから本番データ取得
const adminLoadAllReports = async () => {
    try {
        const compSnap = await getDocs(query(collection(db, 'companies')));
        allCompanies = compSnap.docs.map(d => d.data());
    } catch(e) {
        console.error("Error loading companies list: ", e);
    }
    try {
        const snap = await getDocs(query(collection(db, 'reports')));
        allReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading reports: ", e);
    }
};

// ダミーデータと実データをマージ
const buildAdminData = () => {
    const dummy = [
        { id:'da1', companyId:'test-kensetsu.co.jp', author:'山田 太郎', week:'2026-W20', status:'approved',   timestamp:'2026-05-18T09:00:00Z' },
        { id:'da2', companyId:'test-kensetsu.co.jp', author:'鈴木 花子', week:'2026-W20', status:'confirmed', timestamp:'2026-05-18T10:30:00Z' },
        { id:'da3', companyId:'test-kensetsu.co.jp', author:'山田 太郎', week:'2026-W21', status:'confirmed', timestamp:'2026-05-25T09:00:00Z' },
        { id:'db1', companyId:'sample-design.com',   author:'佐藤 次郎', week:'2026-W20', status:'approved',   timestamp:'2026-05-19T14:00:00Z' },
        { id:'db2', companyId:'sample-design.com',   author:'田中 美咲', week:'2026-W20', status:'plan',      timestamp:'2026-05-17T08:00:00Z' },
        { id:'db3', companyId:'sample-design.com',   author:'高橋 健一', week:'2026-W21', status:'confirmed', timestamp:'2026-05-26T11:00:00Z' },
    ];
    return [...dummy, ...allReports];
};

// データの再読み込みと画面描画
async function reloadData() {
    const reloadBtn = document.getElementById('admin-reload-btn');
    if (reloadBtn) {
        reloadBtn.textContent = '⏳ 読み込み中...';
        reloadBtn.disabled = true;
    }
    
    try {
        await adminLoadAllReports();
        const data = buildAdminData();
        renderAdminCards(data);
        renderAdminTable(data, selectedCompanyFilter);
    } catch (err) {
        alert("データのロードに失敗しました: " + err.message);
    } finally {
        if (reloadBtn) {
            reloadBtn.textContent = '🔄 本番データ再読み込み';
            reloadBtn.disabled = false;
        }
    }
}

// 会社別サマリーカード描画
const renderAdminCards = (data) => {
    const cards = document.getElementById('admin-company-cards');
    if (!cards) return;
    const map = {};
    
    data.forEach(r => {
        const c = r.companyId || '(未設定)';
        if (!map[c]) map[c] = { n:0, members:new Set(), weeks:new Set() };
        map[c].n++;
        if (r.author) map[c].members.add(r.author);
        if (r.week)   map[c].weeks.add(r.week);
    });

    const compMap = {};
    allCompanies.forEach(c => {
        compMap[c.companyId] = c.companyName;
        if (!map[c.companyId]) {
            map[c.companyId] = { n:0, members:new Set(), weeks:new Set() };
        }
    });

    compMap['test-kensetsu.co.jp'] = 'テスト建設株式会社';
    compMap['sample-design.com'] = 'サンプルデザイン設計';

    const companies = Object.keys(map).sort();
    const sel = document.getElementById('admin-company-filter');
    if (sel) {
        sel.innerHTML = '<option value="">🏢 全社データ表示</option>';
        companies.forEach(c => {
            const name = compMap[c] || c;
            sel.innerHTML += `<option value="${c}">${name}</option>`;
        });
        sel.value = selectedCompanyFilter;
    }

    const palette = [
        'linear-gradient(135deg,#6366f1,#4f46e5)',
        'linear-gradient(135deg,#10b981,#059669)',
        'linear-gradient(135deg,#f59e0b,#d97706)',
        'linear-gradient(135deg,#8b5cf6,#7c3aed)',
        'linear-gradient(135deg,#ec4899,#db2777)',
        'linear-gradient(135deg,#06b6d4,#0891b2)',
    ];
    const icons = ['🏢','🏗️','🏭','🏦','🎬','🏙️'];
    cards.innerHTML = companies.map((c,i) => {
        const d = map[c];
        const companyNameDisplay = compMap[c] || c;
        return `<div class="company-card" style="background:${palette[i%palette.length]};" onclick="adminFilter('${c}')">
          <div style="font-size:2rem;margin-bottom:8px;">${icons[i%icons.length]}</div>
          <div style="font-size:.75rem;opacity:.8;">会社ID: ${c}</div>
          <div style="font-size:.95rem;font-weight:bold;margin:5px 0 15px;word-break:break-all;">${companyNameDisplay}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
            <div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px;"><div style="font-size:1.3rem;font-weight:bold;">${d.n}</div><div style="font-size:.7rem;opacity:.8;">週報件数</div></div>
            <div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px;"><div style="font-size:1.3rem;font-weight:bold;">${d.members.size}</div><div style="font-size:.7rem;opacity:.8;">メンバー</div></div>
            <div style="background:rgba(255,255,255,.2);border-radius:8px;padding:8px;"><div style="font-size:1.3rem;font-weight:bold;">${d.weeks.size}</div><div style="font-size:.7rem;opacity:.8;">週数</div></div>
          </div>
          <div style="margin-top:10px;font-size:.75rem;opacity:.7;text-align:right;">クリックで絞り込み →</div>
        </div>`;
    }).join('');
};

// 全社テーブル描画
const renderAdminTable = (data, filter='') => {
    const tbody = document.getElementById('admin-reports-tbody');
    const title = document.getElementById('admin-table-title');
    const cnt   = document.getElementById('admin-record-count');
    if (!tbody) return;
    
    const compMap = {};
    allCompanies.forEach(c => {
        compMap[c.companyId] = c.companyName;
    });
    compMap['test-kensetsu.co.jp'] = 'テスト建設株式会社';
    compMap['sample-design.com'] = 'サンプルデザイン設計';

    const rows = filter ? data.filter(r=>(r.companyId||'(未設定)')===filter) : data;
    rows.sort((a,b)=>(b.timestamp||'')>(a.timestamp||'')?1:-1);
    
    const filterName = compMap[filter] || filter;
    if (title) title.textContent = filter ? `${filterName} の週報データ` : '全社 週報データ一覧';
    if (cnt)   cnt.textContent   = `全 ${rows.length} 件`;
    
    const badge = s => {
        if (s==='approved')  return '<span class="badge-status approved">✅ 承認済</span>';
        if (s==='confirmed') return '<span class="badge-status confirmed">📝 確定</span>';
        return '<span class="badge-status plan">📌 予定</span>';
    };
    
    const fmt = ts => { 
        if(!ts) return '-'; 
        const d=new Date(ts); 
        return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; 
    };
    
    const weekToMonth = (weekStr) => {
        if (!weekStr) return '-';
        const m = weekStr.match(/^(\d{4})-W(\d{2})$/);
        if (!m) return weekStr;
        const year = parseInt(m[1]), week = parseInt(m[2]);
        const jan4 = new Date(year, 0, 4, 12, 0, 0, 0);
        const dow  = jan4.getDay() || 7;
        const mon  = new Date(jan4.getTime());
        mon.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
        return `${mon.getFullYear()}年${mon.getMonth() + 1}月`;
    };

    if (!rows.length) { 
        tbody.innerHTML='<tr><td colspan="5" style="padding:30px;text-align:center;color:var(--text-muted);">該当データなし</td></tr>'; 
        return; 
    }
    
    tbody.innerHTML = rows.map((r,i) => {
        const c = r.companyId || '(未設定)';
        const cName = compMap[c] || c;
        const cc = r.companyId ? '#93c5fd' : '#f87171';
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:12px 15px;">
            <span class="badge-company" style="color:${cc};">${c}</span>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">${cName}</div>
          </td>
          <td style="padding:12px 15px;font-weight:bold;">${r.author||'-'}</td>
          <td style="padding:12px 15px;font-size:.85rem;">${weekToMonth(r.week)}</td>
          <td style="padding:12px 15px;text-align:center;">${badge(r.status)}</td>
          <td style="padding:12px 15px;font-size:.8rem;color:var(--text-muted);">${fmt(r.timestamp)}</td>
        </tr>`;
    }).join('');
};

// 絞り込み関数をグローバルに公開
window.adminFilter = (cid) => {
    selectedCompanyFilter = cid;
    const filterSel = document.getElementById('admin-company-filter');
    if (filterSel) filterSel.value = cid;
    const data = buildAdminData();
    renderAdminTable(data, cid);
};

// ボタン・セレクトボックスイベント
document.getElementById('admin-reload-btn').addEventListener('click', reloadData);

document.getElementById('admin-view-all-btn').addEventListener('click', () => {
    selectedCompanyFilter = '';
    const filterSel = document.getElementById('admin-company-filter');
    if (filterSel) filterSel.value = '';
    const data = buildAdminData();
    renderAdminTable(data, '');
});

document.getElementById('admin-company-filter').addEventListener('change', (e) => {
    selectedCompanyFilter = e.target.value;
    const data = buildAdminData();
    renderAdminTable(data, selectedCompanyFilter);
});
