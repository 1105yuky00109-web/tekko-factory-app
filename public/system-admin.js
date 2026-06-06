const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
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
let allSchedules = [];
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
        allCompanies = compSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading companies list: ", e);
    }
    try {
        const snap = await getDocs(query(collection(db, 'reports')));
        allReports = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading reports: ", e);
    }
    try {
        const schedSnap = await getDocs(query(collection(db, 'schedules')));
        allSchedules = schedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading schedules: ", e);
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
        renderAdminCompaniesTable();
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

// 企業別利用状況一覧テーブルとサマリーの描画
const renderAdminCompaniesTable = () => {
    const tbody = document.getElementById('admin-companies-tbody');
    const cnt = document.getElementById('admin-companies-count');
    const sumCompanies = document.getElementById('summary-total-companies');
    const sumEmployees = document.getElementById('summary-total-employees');
    const sumSchedules = document.getElementById('summary-total-schedules');
    const sumReports = document.getElementById('summary-total-reports');
    if (!tbody) return;

    // 全社統計の計算
    let totalEmployees = 0;
    
    const companyStats = allCompanies.map(c => {
        const cid = c.companyId || c.id;
        const compSchedules = allSchedules.filter(s => s.companyId === cid || s.company === cid);
        const compReports = allReports.filter(r => r.companyId === cid || r.company === cid);
        const empCount = (c.employees || []).length;
        totalEmployees += empCount;
        
        return {
            id: cid,
            name: c.companyName || '(未設定)',
            planName: c.planName || '10名プラン',
            maxUsers: c.maxUsers || 10,
            employeeCount: empCount,
            scheduleCount: compSchedules.length,
            reportCount: compReports.length,
            createdAt: c.createdAt ? new Date(c.createdAt.seconds * 1000) : null,
            trialEnd: c.trialEnd ? new Date(c.trialEnd.seconds * 1000) : null,
            adminEmail: (c.adminEmails && c.adminEmails[0]) || '(なし)'
        };
    });

    // サマリーカードの描画
    if (sumCompanies) sumCompanies.textContent = `${allCompanies.length} 社`;
    if (sumEmployees) sumEmployees.textContent = `${totalEmployees} 名`;
    if (sumSchedules) sumSchedules.textContent = `${allSchedules.length} 件`;
    if (sumReports) sumReports.textContent = `${allReports.length} 件`;
    if (cnt) cnt.textContent = `${allCompanies.length}社`;

    if (!companyStats.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding:30px;text-align:center;color:var(--text-muted);">登録されている企業はありません。</td></tr>';
        return;
    }

    const fmtDate = d => {
        if (!d) return '-';
        return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    };

    const getTrialBadge = (trialEnd) => {
        if (!trialEnd) return '<span class="badge-active">🟢 本契約</span>';
        const now = new Date();
        if (trialEnd < now) {
            return '<span class="badge-active" style="background:rgba(100,116,139,0.15);color:#94a3b8;border-color:rgba(100,116,139,0.3);">⚫ 期限切れ</span>';
        }
        const diffTime = Math.abs(trialEnd - now);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return `<span class="badge-trial">🔴 トライアル (残り${diffDays}日)</span><div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">期限: ${fmtDate(trialEnd)}</div>`;
    };

    tbody.innerHTML = companyStats.map(c => {
        const cc = '#93c5fd';
        return `<tr style="border-bottom:1px solid var(--border);">
            <td style="padding:12px 15px;">
                <span class="badge-company" style="color:${cc};">${c.id}</span>
                <div style="font-weight:bold;margin-top:4px;">${c.name}</div>
            </td>
            <td style="padding:12px 15px;">
                <div style="font-weight:bold;font-size:0.9rem;">${c.planName}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">上限: ${c.maxUsers}名</div>
            </td>
            <td style="padding:12px 15px;text-align:center;font-weight:bold;">${c.employeeCount} / ${c.maxUsers} 名</td>
            <td style="padding:12px 15px;text-align:center;">${c.scheduleCount} 件</td>
            <td style="padding:12px 15px;text-align:center;">${c.reportCount} 件</td>
            <td style="padding:12px 15px;font-size:0.85rem;">${getTrialBadge(c.trialEnd)}</td>
            <td style="padding:12px 15px;font-size:0.8rem;color:var(--text-muted);word-break:break-all;">${c.adminEmail}</td>
            <td style="padding:12px 15px;font-size:0.8rem;color:var(--text-muted);">${fmtDate(c.createdAt)}</td>
        </tr>`;
    }).join('');
};

// タブ切り替え制御
const tabBtnCompanies = document.getElementById('tab-btn-companies');
const tabBtnReports = document.getElementById('tab-btn-reports');
const companiesSection = document.getElementById('companies-section');
const reportsSection = document.getElementById('reports-section');

if (tabBtnCompanies && tabBtnReports && companiesSection && reportsSection) {
    tabBtnCompanies.addEventListener('click', () => {
        tabBtnCompanies.classList.add('active');
        tabBtnReports.classList.remove('active');
        companiesSection.classList.remove('hidden');
        reportsSection.classList.add('hidden');
    });

    tabBtnReports.addEventListener('click', () => {
        tabBtnReports.classList.add('active');
        tabBtnCompanies.classList.remove('active');
        reportsSection.classList.remove('hidden');
        companiesSection.classList.add('hidden');
    });
}
