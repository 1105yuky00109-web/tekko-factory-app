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
import { getFirestore, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 開発者以外のログインを弾くためのメールリスト
const DEVELOPER_EMAILS = ['steelworks@areva.co.jp'];

let currentUser = null;
let allCompanies = [];
let allSchedules = [];
let selectedCompanyId = "";
let currentCompanyReports = []; // 選択された会社の日報データ
let reportChartInstance = null; // Chart.jsのグラフインスタンス


// DOM要素
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');
const currentEmailLabel = document.getElementById('current-user-email');

// 開発者判定ヘルパー
const checkIsDeveloper = (user) => {
    if (!user) return false;
    const devUid = 'uQ2CTFIUMha6kxbXOWrpnIDjeRq2';
    const devEmail = 'steelworks@areva.co.jp';
    
    // UIDによる判定（最も確実）
    if (user.uid === devUid) return true;
    
    // メールアドレスによる判定（表記揺れ考慮）
    if (user.email && user.email.toLowerCase().trim() === devEmail) return true;
    
    return false;
};

// 認証状態の監視
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const isDev = checkIsDeveloper(user);
        
        if (isDev) {
            currentUser = user;
            if (currentEmailLabel) currentEmailLabel.textContent = user.email || 'steelworks@areva.co.jp';
            loginContainer.classList.add('hidden');
            appContainer.classList.remove('hidden');
            
            // 初回ロード
            await reloadData();
        } else {
            // 開発者ではない場合は、一時的なメールアドレス未ロード状態でないことを確認した上で一般アプリへリダイレクト
            // user.email が存在しない瞬間は、判定が確定するまでリダイレクトを保留する
            if (user.email === undefined || user.email === null) {
                console.log("onAuthStateChanged: user.email is not loaded yet in system-admin.js. Waiting...");
                return;
            }
            
            // 開発者ではないことが確定したため、一般アプリ画面へリダイレクト
            window.location.href = "app.html";
        }
    } else {
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
    
    if (!DEVELOPER_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase().trim())) {
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
const adminLoadAllData = async () => {
    try {
        const compSnap = await getDocs(query(collection(db, 'companies')));
        allCompanies = compSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading companies list: ", e);
    }
    try {
        const schedSnap = await getDocs(query(collection(db, 'schedules')));
        allSchedules = schedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch(e) {
        console.error("Error loading schedules: ", e);
    }
};

// データの再読み込みと画面描画
async function reloadData() {
    const reloadBtn = document.getElementById('admin-reload-btn');
    if (reloadBtn) {
        reloadBtn.textContent = '⏳ 読み込み中...';
        reloadBtn.disabled = true;
    }
    
    try {
        await adminLoadAllData();
        renderAdminCompaniesTable();
        updateCompanyFilterOptions();
        if (selectedCompanyId) {
            await selectAdminCompany(selectedCompanyId);
        }
    } catch (err) {
        alert("データのロードに失敗しました: " + err.message);
    } finally {
        if (reloadBtn) {
            reloadBtn.textContent = '🔄 本番データ再読み込み';
            reloadBtn.disabled = false;
        }
    }
}

// ボタン・セレクトボックスイベント
document.getElementById('admin-reload-btn').addEventListener('click', reloadData);

if (document.getElementById('admin-company-filter')) {
    document.getElementById('admin-company-filter').addEventListener('change', (e) => {
        selectAdminCompany(e.target.value);
    });
}
if (document.getElementById('admin-month-filter')) {
    document.getElementById('admin-month-filter').addEventListener('change', () => {
        aggregateAndRenderReports();
    });
}

// 企業別利用状況一覧テーブルとサマリーの描画
const renderAdminCompaniesTable = () => {
    const tbody = document.getElementById('admin-companies-tbody');
    const cnt = document.getElementById('admin-companies-count');
    const sumCompanies = document.getElementById('summary-total-companies');
    const sumEmployees = document.getElementById('summary-total-employees');
    const sumSchedules = document.getElementById('summary-total-schedules');
    if (!tbody) return;

    // 堅牢な日付解析ヘルパー関数
    const parseFirestoreDate = (field) => {
        if (!field) return null;
        if (typeof field.toDate === 'function') {
            return field.toDate();
        }
        if (typeof field.seconds === 'number') {
            return new Date(field.seconds * 1000);
        }
        if (typeof field === 'number') {
            // 秒単位かミリ秒単位かを桁数で自動判定
            return field > 9999999999 ? new Date(field) : new Date(field * 1000);
        }
        const d = new Date(field);
        return isNaN(d.getTime()) ? null : d;
    };

    // 全社統計の計算
    let totalEmployees = 0;
    
    const companyStats = allCompanies.map(c => {
        const cid = c.companyId || c.id;
        const compSchedules = allSchedules.filter(s => s.companyId === cid || s.company === cid);
        const empCount = (c.employees || []).length;
        totalEmployees += empCount;
        
        return {
            id: cid,
            name: c.companyName || '(未設定)',
            planName: c.planName || '10名プラン',
            maxUsers: c.maxUsers || 10,
            employeeCount: empCount,
            scheduleCount: compSchedules.length,
            createdAt: parseFirestoreDate(c.createdAt),
            trialEnd: parseFirestoreDate(c.trialEnd),
            adminEmail: (c.adminEmails && c.adminEmails[0]) || '(なし)',
            paymentMethod: c.paymentMethod || (c.stripeCustomerId ? 'card' : 'card')
        };
    });

    // サマリーカードの描画
    if (sumCompanies) sumCompanies.textContent = `${allCompanies.length} 社`;
    if (sumEmployees) sumEmployees.textContent = `${totalEmployees} 名`;
    if (sumSchedules) sumSchedules.textContent = `${allSchedules.length} 件`;
    if (cnt) cnt.textContent = `${allCompanies.length}社`;

    if (!companyStats.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="padding:30px;text-align:center;color:var(--text-muted);">登録されている企業はありません。</td></tr>';
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
    const getPaymentMethodLabel = (pm) => {
        if (pm === 'invoice') return '<span class="badge-status confirmed" style="background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;">📄 請求書払い</span>';
        return '<span class="badge-status approved" style="background:rgba(16,185,129,0.15);color:#10b981;border-color:rgba(16,185,129,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;">💳 カード決済</span>';
    };

    tbody.innerHTML = companyStats.map(c => {
        const cc = '#93c5fd';
        return `<tr style="border-bottom:1px solid var(--border); cursor: pointer;" class="company-row" data-company-id="${c.id}">
            <td style="padding:12px 15px;">
                <span class="badge-company" style="color:${cc}; font-weight: bold; text-decoration: underline;">${c.id}</span>
                <div style="font-weight:bold;margin-top:4px; color:#60a5fa; text-decoration:underline;">${c.name}</div>
            </td>
            <td style="padding:12px 15px;">
                <div style="font-weight:bold;font-size:0.9rem;">${c.planName}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">上限: ${c.maxUsers}名</div>
            </td>
            <td style="padding:12px 15px;">
                ${getPaymentMethodLabel(c.paymentMethod)}
            </td>
            <td style="padding:12px 15px;text-align:center;font-weight:bold;">${c.employeeCount} / ${c.maxUsers} 名</td>
            <td style="padding:12px 15px;text-align:center;">${c.scheduleCount} 件</td>
            <td style="padding:12px 15px;font-size:0.85rem;">${getTrialBadge(c.trialEnd)}</td>
            <td style="padding:12px 15px;font-size:0.8rem;color:var(--text-muted);word-break:break-all;">${c.adminEmail}</td>
            <td style="padding:12px 15px;font-size:0.8rem;color:var(--text-muted);">${fmtDate(c.createdAt)}</td>
        </tr>`;
    }).join('');

    // 行クリックイベントの付与
    tbody.querySelectorAll('.company-row').forEach(row => {
        row.addEventListener('click', () => {
            const companyId = row.getAttribute('data-company-id');
            selectAdminCompany(companyId);
        });
    });
};

// 会社フィルターのセレクトボックス更新
const updateCompanyFilterOptions = () => {
    const filterSelect = document.getElementById('admin-company-filter');
    if (!filterSelect) return;

    filterSelect.innerHTML = '<option value="">🏢 会社を選択して絞り込み...</option>';

    allCompanies.forEach(c => {
        const cid = c.companyId || c.id;
        const name = c.companyName || cid;
        const opt = document.createElement('option');
        opt.value = cid;
        opt.textContent = `🏢 ${name} (${cid})`;
        filterSelect.appendChild(opt);
    });

    filterSelect.value = selectedCompanyId;
};

// 対象月フィルターのオプション更新
const updateMonthFilterOptions = (months) => {
    const filterSelect = document.getElementById('admin-month-filter');
    if (!filterSelect) return;

    filterSelect.innerHTML = '<option value="">すべての月</option>';

    months.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `${m.substring(0, 4)}年${m.substring(5, 7)}月`;
        filterSelect.appendChild(opt);
    });
};

// 選択された会社の日報データを Firestore からロード
async function selectAdminCompany(companyId) {
    selectedCompanyId = companyId;

    const filterSelect = document.getElementById('admin-company-filter');
    if (filterSelect) {
        filterSelect.value = companyId;
    }

    const detailModal = document.getElementById('company-detail-modal');
    const tbody = document.getElementById('admin-reports-tbody');
    const title = document.getElementById('modal-company-title');

    if (!companyId) {
        if (detailModal) detailModal.classList.remove('show');
        currentCompanyReports = [];
        return;
    }

    // モーダルを表示
    if (detailModal) detailModal.classList.add('show');

    const companyObj = allCompanies.find(c => (c.companyId || c.id) === companyId);
    const companyName = companyObj ? (companyObj.companyName || companyId) : companyId;
    if (title) {
        title.textContent = `🏢 ${companyName} 工事別稼働集計`;
    }

    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding:30px; text-align:center; color:var(--text-muted);">⏳ 日報データを読み込み中...</td></tr>`;
    }

    try {
        const q = query(collection(db, "daily_reports"), where("companyId", "==", companyId));
        const querySnapshot = await getDocs(q);
        currentCompanyReports = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        aggregateAndRenderReports();

    } catch (err) {
        console.error("Error loading company reports: ", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="3" style="padding:30px; text-align:center; color:var(--error);">❌ データの取得に失敗しました: ${err.message}</td></tr>`;
        }
    }
}

// 日報の集計と描画（およびグラフ描画）
function aggregateAndRenderReports() {
    const tbody = document.getElementById('admin-reports-tbody');
    const monthFilter = document.getElementById('admin-month-filter');
    if (!tbody) return;

    if (currentCompanyReports.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding:30px; text-align:center; color:var(--text-muted);">日報データが登録されていません。</td></tr>';
        updateMonthFilterOptions([]);
        if (reportChartInstance) {
            reportChartInstance.destroy();
            reportChartInstance = null;
        }
        return;
    }

    const monthsSet = new Set();
    const aggMap = new Map(); // key: projectName + "::" + month

    currentCompanyReports.forEach(r => {
        const proj = r.projectName || '(不明な工事)';
        const month = r.date ? r.date.substring(0, 7) : '(不明な月)';
        const hours = parseFloat(r.hours) || 0;

        if (r.date && r.date.length >= 7) {
            monthsSet.add(month);
        }

        const key = `${proj}::${month}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, {
                projectName: proj,
                month: month,
                hours: 0
            });
        }
        aggMap.get(key).hours += hours;
    });

    const sortedMonths = Array.from(monthsSet).sort().reverse();
    const selectedMonth = monthFilter ? monthFilter.value : "";
    updateMonthFilterOptions(sortedMonths);

    if (monthFilter) {
        if (sortedMonths.includes(selectedMonth)) {
            monthFilter.value = selectedMonth;
        } else {
            monthFilter.value = "";
        }
    }

    let aggList = Array.from(aggMap.values());
    const activeMonth = monthFilter ? monthFilter.value : "";
    if (activeMonth) {
        aggList = aggList.filter(row => row.month === activeMonth);
    }

    aggList.sort((a, b) => {
        if (a.projectName !== b.projectName) {
            return a.projectName.localeCompare(b.projectName);
        }
        return b.month.localeCompare(a.month);
    });

    if (aggList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="padding:30px; text-align:center; color:var(--text-muted);">選択された月に該当する日報データはありません。</td></tr>';
    } else {
        tbody.innerHTML = aggList.map(row => {
            return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:12px 15px; font-weight:bold;">${row.projectName}</td>
                <td style="padding:12px 15px; color:var(--text-muted); font-size:0.9rem;">${row.month}</td>
                <td style="padding:12px 15px; text-align:right; font-weight:bold; color:#60a5fa; font-size:1.05rem;">${row.hours.toFixed(1)} h</td>
            </tr>`;
        }).join('');
    }

    // X軸用：工事名一覧を取得
    const projects = Array.from(new Set(currentCompanyReports.map(r => r.projectName || '(不明な工事)'))).sort();
    
    // 積み上げ要素（凡例）：対象月を古い順に昇順ソート
    const sortedMonthsAsc = Array.from(monthsSet).sort();

    // 積層カラーパレット定義 (彩度と明度を統一したモダンでシャープなカラー)
    const colorPalette = [
        '#6366f1', // indigo
        '#06b6d4', // cyan
        '#10b981', // emerald
        '#f59e0b', // amber
        '#ec4899', // pink
        '#8b5cf6', // violet
        '#3b82f6', // blue
        '#f43f5e', // rose
        '#14b8a6', // teal
        '#84cc16'  // lime
    ];

    // 月ごとのデータセット作成
    const datasets = sortedMonthsAsc.map((month, idx) => {
        const data = projects.map(proj => {
            const key = `${proj}::${month}`;
            const item = aggMap.get(key);
            return item ? item.hours : 0;
        });

        // 年月のフォーマット（例: "2026-05" -> "26年5月"）
        const year = month.substring(2, 4);
        const mon = parseInt(month.substring(5, 7));
        const formattedMonthLabel = `${year}年${mon}月`;

        return {
            label: formattedMonthLabel,
            data: data,
            backgroundColor: colorPalette[idx % colorPalette.length],
            borderColor: 'transparent',
            borderWidth: 0,
            borderRadius: 6, // バーの角を丸くしてスタイリッシュにする
            borderSkipped: false
        };
    });

    renderChart(projects, datasets);
}

// Chart.jsによる積層棒グラフの描画
function renderChart(labels, datasets) {
    const ctx = document.getElementById('company-report-chart');
    if (!ctx) return;

    if (reportChartInstance) {
        reportChartInstance.destroy();
    }

    reportChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            barPercentage: 0.4, // バーを細くしてシャープにする
            categoryPercentage: 0.8,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#f8fafc',
                        font: {
                            size: 11,
                            family: 'sans-serif',
                            weight: 'bold'
                        },
                        boxWidth: 10,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#60a5fa',
                    bodyColor: '#f8fafc',
                    borderColor: '#334155',
                    borderWidth: 1,
                    cornerRadius: 8,
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(1) + ' h';
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false // X軸のグリッド線を消してシンプルに
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            family: 'sans-serif',
                            size: 11
                        }
                    }
                },
                y: {
                    stacked: true,
                    grid: {
                        color: 'rgba(51, 65, 85, 0.15)' // 薄いグリッド線
                    },
                    ticks: {
                        color: '#94a3b8',
                        font: {
                            family: 'sans-serif',
                            size: 11
                        },
                        callback: function(value) {
                            return value + ' h';
                        }
                    }
                }
            }
        }
    });
}

// モーダルを閉じる処理
function closeDetailModal() {
    const detailModal = document.getElementById('company-detail-modal');
    if (detailModal) {
        detailModal.classList.remove('show');
    }
    if (reportChartInstance) {
        reportChartInstance.destroy();
        reportChartInstance = null;
    }
    // 会社セレクトボックスを初期値に戻す
    selectedCompanyId = "";
    const filterSelect = document.getElementById('admin-company-filter');
    if (filterSelect) {
        filterSelect.value = "";
    }
}

// 閉じるボタンと背景クリックのイベント追加
const btnCloseModal = document.getElementById('btn-close-modal');
if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeDetailModal);
}
const detailModalOverlay = document.getElementById('company-detail-modal');
if (detailModalOverlay) {
    detailModalOverlay.addEventListener('click', (e) => {
        if (e.target === detailModalOverlay) {
            closeDetailModal();
        }
    });
}

