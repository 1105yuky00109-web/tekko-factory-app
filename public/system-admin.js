import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, query, where, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
};

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
let originalCompanyConfig = null; // モーダルを開いた時点の初期設定値
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
    const devEmails = ['steelworks@areva.co.jp'];
    
    // UIDによる判定（最も確実）
    if (user.uid === devUid) return true;
    
    // メールアドレスによる判定（表記揺れ考慮）
    if (user.email) {
        const emailLower = user.email.toLowerCase().trim();
        if (devEmails.includes(emailLower)) return true;
    }
    
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
            // 開発者ではない場合は、一時的なメールアドレス未ロード状態でないことを確認した上で強制ログアウト
            if (!user.email || user.email.trim() === "") {
                console.log("onAuthStateChanged: user.email is not loaded yet in system-admin.js. Waiting...");
                return;
            }
            
            // 開発者ではないため、システム管理者用画面からは強制サインアウトする
            console.log("Non-developer account detected in system-admin.html. Forcing logout.");
            const errorMsg = document.getElementById('login-error');
            if (errorMsg) {
                errorMsg.classList.remove('hidden');
                errorMsg.textContent = '一般ユーザーはシステム管理者用画面にはログインできません。';
            }
            signOut(auth).catch(err => console.error("SignOut error:", err));
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

// 企業別利用状況一覧とサマリーの描画
const renderAdminCompaniesTable = () => {
    const cnt = document.getElementById('admin-companies-count');
    const sumCompanies = document.getElementById('summary-total-companies');
    const sumEmployees = document.getElementById('summary-total-employees');
    const sumSchedules = document.getElementById('summary-total-schedules');

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
        
        const getContractRenewalDate = (comp) => {
            if (comp.contractRenewalDate) return parseFirestoreDate(comp.contractRenewalDate);
            if (comp.trialEnd) return parseFirestoreDate(comp.trialEnd);
            const created = parseFirestoreDate(comp.createdAt);
            if (created) {
                const d = new Date(created);
                d.setMonth(d.getMonth() + 1);
                return d;
            }
            return null;
        };

        const renewalDate = getContractRenewalDate(c);
        const invoiceStatus = c.invoiceStatus || 'unpaid';

        const isOverdue = (() => {
            if (c.paymentMethod !== 'invoice') return false;
            if (invoiceStatus === 'paid') return false;
            if (!renewalDate) return false;
            const now = new Date();
            const limitDate = new Date(renewalDate);
            limitDate.setDate(limitDate.getDate() + 30); // 30日遅延猶予
            return now > limitDate;
        })();
        
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
            status: c.status || 'active',
            invoiceStatus: invoiceStatus,
            lastPaymentDate: parseFirestoreDate(c.lastPaymentDate),
            contractRenewalDate: renewalDate,
            isOverdue: isOverdue,
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

    const getTrialBadge = (trialEnd, status) => {
        if (status === 'disabled') {
            return '<span class="badge-status" style="background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;">🔴 無効化</span>';
        }
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

    const getInvoiceStatusLabel = (pm, status, isOverdue, renewalDate) => {
        if (pm !== 'invoice') {
            return '<span style="color:var(--text-muted); font-size:0.8rem;">💳 対象外</span>';
        }
        if (status === 'paid') {
            return '<span class="badge-status approved" style="background:rgba(16,185,129,0.15);color:#10b981;border-color:rgba(16,185,129,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;font-weight:bold;">🟢 支払い済み</span>';
        }
        const dateStr = fmtDate(renewalDate);
        if (isOverdue) {
            return `<span class="badge-status" style="background:rgba(239,68,68,0.15);color:#ef4444;border-color:rgba(239,68,68,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;font-weight:bold;">⚠️ 🚨 未払い (超過)</span><div style="font-size:0.7rem;color:var(--error);margin-top:2px;">更新日: ${dateStr}</div>`;
        }
        return `<span class="badge-status" style="background:rgba(245,158,11,0.15);color:#f59e0b;border-color:rgba(245,158,11,0.3);padding:4px 8px;font-size:0.75rem;border-radius:4px;border:1px solid;display:inline-block;font-weight:bold;">🟡 未払い</span><div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">更新日: ${dateStr}</div>`;
    };

    const buttonsContainer = document.getElementById('company-buttons-container');
    if (!buttonsContainer) return;

    if (!companyStats.length) {
        buttonsContainer.innerHTML = '<div style="grid-column: 1/-1; padding:30px; text-align:center; color:var(--text-muted);">登録されている企業はありません。</div>';
        return;
    }

    buttonsContainer.innerHTML = companyStats.map(c => {
        const isDisabled = c.status === 'disabled';
        const isTrial = c.trialEnd && c.trialEnd > new Date();
        const statusClass = isDisabled ? 'status-disabled' : (isTrial ? 'status-trial' : 'status-active');
        
        return `<button class="btn-company-card ${statusClass}" data-company-id="${c.id}">
            <span class="status-indicator"></span>
            <span style="font-size:0.95rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${c.name}</span>
        </button>`;
    }).join('');

    // ボタンクリックイベントの付与
    buttonsContainer.querySelectorAll('.btn-company-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const companyId = btn.getAttribute('data-company-id');
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

    // 日付解析ヘルパーを関数全体で利用可能にする
    const parseLocalFirestoreDate = (field) => {
        if (!field) return null;
        if (typeof field.toDate === 'function') return field.toDate();
        if (typeof field.seconds === 'number') return new Date(field.seconds * 1000);
        if (typeof field === 'number') return field > 9999999999 ? new Date(field) : new Date(field * 1000);
        const d = new Date(field);
        return isNaN(d.getTime()) ? null : d;
    };

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

    // 初期表示タブを「企業設定」にする
    switchModalTab('config');

    const companyObj = allCompanies.find(c => (c.companyId || c.id) === companyId);
    const companyName = companyObj ? (companyObj.companyName || companyId) : companyId;
    if (title) {
        title.textContent = `🏢 ${companyName}`;
    }

    // 基本情報・社員リストのセット
    if (companyObj) {
        document.getElementById('edit-company-name').value = companyObj.companyName || '';
        document.getElementById('edit-company-max-users').value = companyObj.maxUsers || 10;

        // 登録日のフォーマット表示
        const createdAtDate = parseLocalFirestoreDate(companyObj.createdAt);
        const fmtDate = d => {
            if (!d) return '-';
            return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        };
        document.getElementById('display-company-created-at').textContent = fmtDate(createdAtDate);

        // 社員一覧 (氏名)
        const employeesListDiv = document.getElementById('display-company-employees-list');
        if (employeesListDiv) {
            const employees = companyObj.employees || [];
            if (employees.length === 0) {
                employeesListDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">登録されている社員はいません。</span>';
            } else {
                employeesListDiv.innerHTML = employees.map(emp => {
                    const name = emp.name || '(名前未設定)';
                    const roleLabel = emp.role === 'admin' ? '<span style="font-size:0.75rem; background:#eff6ff; color:#1e40af; padding:2px 6px; border-radius:4px; margin-left:5px; font-weight:bold;">管理者</span>' : '';
                    return `<div style="padding:6px 0; border-bottom:1px solid var(--border); display:flex; align-items:center;">👤 ${name}${roleLabel}</div>`;
                }).join('');
            }
        }

        // 無効化ボタンのテキストと色切り替え
        const disableBtn = document.getElementById('btn-disable-company');
        if (disableBtn) {
            if (companyObj.status === 'disabled') {
                disableBtn.textContent = '🟢 この企業を有効化する';
                disableBtn.style.background = 'var(--success)';
            } else {
                disableBtn.textContent = '🚫 この企業を無効化する';
                disableBtn.style.background = 'var(--error)';
            }
        }

        // 請求書払い管理の表示とデータセット
        const invoiceSection = document.getElementById('invoice-payment-section');
        if (invoiceSection) {
            if (companyObj.paymentMethod === 'invoice') {
                invoiceSection.style.display = 'block';
                
                const invStatus = companyObj.invoiceStatus || 'unpaid';
                const displayStatus = document.getElementById('display-invoice-status');
                const toggleBtn = document.getElementById('btn-toggle-payment-status');
                
                const getLocalContractRenewalDate = (comp) => {
                    if (comp.contractRenewalDate) return parseLocalFirestoreDate(comp.contractRenewalDate);
                    if (comp.trialEnd) return parseLocalFirestoreDate(comp.trialEnd);
                    const created = parseLocalFirestoreDate(comp.createdAt);
                    if (created) {
                        const d = new Date(created);
                        d.setMonth(d.getMonth() + 1);
                        return d;
                    }
                    return null;
                };
                const renewalDate = getLocalContractRenewalDate(companyObj);
                const isOverdue = (() => {
                    if (invStatus === 'paid') return false;
                    if (!renewalDate) return false;
                    const now = new Date();
                    const limitDate = new Date(renewalDate);
                    limitDate.setDate(limitDate.getDate() + 30);
                    return now > limitDate;
                })();

                if (displayStatus) {
                    if (invStatus === 'paid') {
                        displayStatus.innerHTML = '<span style="color:var(--success); font-weight:bold;">🟢 支払い済み</span>';
                    } else if (isOverdue) {
                        displayStatus.innerHTML = '<span style="color:var(--error); font-weight:bold;">⚠️ 🚨 未払い (猶予期限超過)</span>';
                    } else {
                        displayStatus.innerHTML = '<span style="color:var(--warning); font-weight:bold;">🟡 未払い</span>';
                    }
                }

                const displayLastPaid = document.getElementById('display-last-payment-date');
                if (displayLastPaid) {
                    const lastPaidDate = parseLocalFirestoreDate(companyObj.lastPaymentDate);
                    displayLastPaid.textContent = lastPaidDate ? fmtDate(lastPaidDate) : '-';
                }

                const renewalInput = document.getElementById('edit-contract-renewal-date');
                if (renewalInput) {
                    if (renewalDate) {
                        const yyyy = renewalDate.getFullYear();
                        const mm = String(renewalDate.getMonth() + 1).padStart(2, '0');
                        const dd = String(renewalDate.getDate()).padStart(2, '0');
                        renewalInput.value = `${yyyy}-${mm}-${dd}`;
                    } else {
                        renewalInput.value = '';
                    }
                }

                if (toggleBtn) {
                    if (invStatus === 'paid') {
                        toggleBtn.textContent = '🔴 未払いに戻す';
                        toggleBtn.style.background = 'var(--error)';
                        toggleBtn.style.color = '#fff';
                    } else {
                        toggleBtn.textContent = '🟢 支払い済みにする';
                        toggleBtn.style.background = 'var(--success)';
                        toggleBtn.style.color = '#fff';
                    }
                }
            } else {
                invoiceSection.style.display = 'none';
            }
        }
    }

    // 契約プラン状態の初期セット
    const planStatusSelect = document.getElementById('edit-company-plan-status');
    const trialPeriodSettings = document.getElementById('trial-period-settings');
    const trialDaysInput = document.getElementById('edit-company-trial-days');
    
    if (planStatusSelect) {
        const now = new Date();
        const trialEnd = parseLocalFirestoreDate(companyObj.trialEnd);
        
        if (!trialEnd) {
            planStatusSelect.value = 'active';
            if (trialPeriodSettings) trialPeriodSettings.style.display = 'none';
        } else if (trialEnd > now) {
            planStatusSelect.value = 'trial_active';
            if (trialPeriodSettings) {
                trialPeriodSettings.style.display = 'block';
                const diffTime = Math.abs(trialEnd - now);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (trialDaysInput) trialDaysInput.value = diffDays;
            }
        } else {
            planStatusSelect.value = 'trial_expired';
            if (trialPeriodSettings) trialPeriodSettings.style.display = 'none';
        }
    }

    // 会社IDの表示セット
    const displayCompanyId = document.getElementById('display-company-id');
    if (displayCompanyId && companyObj) {
        displayCompanyId.textContent = companyObj.companyId || companyObj.id || '';
    }

    // 管理者名のセット
    const editCompanyAdminName = document.getElementById('edit-company-admin-name');
    if (editCompanyAdminName && companyObj) {
        editCompanyAdminName.value = companyObj.adminName || '';
    }

    // 管理者メールのセット
    const editCompanyAdminEmail = document.getElementById('edit-company-admin-email');
    if (editCompanyAdminEmail && companyObj) {
        editCompanyAdminEmail.value = (companyObj.adminEmails && companyObj.adminEmails[0]) || '';
    }

    // トライアル期間の自動計算表示
    const displayTrialPeriod = document.getElementById('display-company-trial-period');
    if (displayTrialPeriod && companyObj) {
        const trialStart = parseLocalFirestoreDate(companyObj.trialStart);
        const trialEnd = parseLocalFirestoreDate(companyObj.trialEnd);
        const fmtDate = d => {
            if (!d) return '-';
            return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        };
        if (trialStart && trialEnd) {
            displayTrialPeriod.textContent = `${fmtDate(trialStart)} 〜 ${fmtDate(trialEnd)}`;
        } else if (trialEnd) {
            displayTrialPeriod.textContent = `〜 ${fmtDate(trialEnd)}`;
        } else {
            displayTrialPeriod.textContent = '未設定';
        }
    }

    // 登録工事数の表示セット
    const displayCompanySchedulesCount = document.getElementById('display-company-schedules-count');
    if (displayCompanySchedulesCount && companyObj) {
        const targetCid = companyObj.companyId || companyObj.id;
        const compSchedules = allSchedules.filter(s => (s.companyId === targetCid || s.company === targetCid));
        displayCompanySchedulesCount.textContent = `${compSchedules.length} 件`;
    }

    // お支払い方法の初期セット
    const paymentMethodSelect = document.getElementById('edit-company-payment-method');
    if (paymentMethodSelect && companyObj) {
        paymentMethodSelect.value = companyObj.paymentMethod || 'card';
    }

    // 代理ログインボタンのイベント設定
    const btnImpersonate = document.getElementById('btn-impersonate-company');
    if (btnImpersonate && companyObj) {
        // 既存のイベントリスナーを破棄するためクローンを作成
        const newBtn = btnImpersonate.cloneNode(true);
        btnImpersonate.parentNode.replaceChild(newBtn, btnImpersonate);
        newBtn.addEventListener('click', () => {
            const cid = companyObj.companyId || companyObj.id;
            sessionStorage.setItem('impersonate_company_id', cid);
            window.open('app.html', '_blank');
        });
    }

    // 初期値を退避（変更チェック用）
    if (companyObj) {
        originalCompanyConfig = {
            companyName: document.getElementById('edit-company-name').value || '',
            maxUsers: document.getElementById('edit-company-max-users').value || '',
            contractRenewalDate: document.getElementById('edit-contract-renewal-date') ? document.getElementById('edit-contract-renewal-date').value : '',
            planStatus: document.getElementById('edit-company-plan-status') ? document.getElementById('edit-company-plan-status').value : '',
            trialDays: document.getElementById('edit-company-trial-days') ? document.getElementById('edit-company-trial-days').value : '',
            paymentMethod: document.getElementById('edit-company-payment-method') ? document.getElementById('edit-company-payment-method').value : 'card',
            adminName: document.getElementById('edit-company-admin-name') ? document.getElementById('edit-company-admin-name').value : '',
            adminEmail: document.getElementById('edit-company-admin-email') ? document.getElementById('edit-company-admin-email').value : ''
        };
    } else {
        originalCompanyConfig = null;
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

    // まず、存在するすべての月（YYYY-MM）を抽出してフィルターオプションを構築
    const monthsSet = new Set();
    currentCompanyReports.forEach(r => {
        if (r.date && r.date.length >= 7) {
            monthsSet.add(r.date.substring(0, 7));
        }
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

    // 選択された月でフィルタリングされた日報データ
    const activeMonth = monthFilter ? monthFilter.value : "";
    const filteredReports = activeMonth 
        ? currentCompanyReports.filter(r => r.date && r.date.substring(0, 7) === activeMonth)
        : currentCompanyReports;

    // テーブル表示用の集計（工事名 × 対象月 で合計時間を算出）
    const tableAggMap = new Map();
    filteredReports.forEach(r => {
        const proj = r.projectName || '(不明な工事)';
        const month = r.date ? r.date.substring(0, 7) : '(不明な月)';
        const hours = parseFloat(r.hours) || 0;

        const key = `${proj}::${month}`;
        if (!tableAggMap.has(key)) {
            tableAggMap.set(key, {
                projectName: proj,
                month: month,
                hours: 0
            });
        }
        tableAggMap.get(key).hours += hours;
    });

    let aggList = Array.from(tableAggMap.values());
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
            // schedules から製作期間と加工トン数を取得する
            const sched = allSchedules.find(s => 
                (s.project === row.projectName) && 
                (s.companyId === selectedCompanyId || s.company === selectedCompanyId)
            );

            let periodText = "-";
            let tonnageText = "-";

            if (sched) {
                const startStr = sched.start ? sched.start.replace(/-/g, '/') : '';
                const endStr = sched.end ? sched.end.replace(/-/g, '/') : '';
                if (startStr && endStr) {
                    periodText = `${startStr} 〜 ${endStr}`;
                } else if (startStr) {
                    periodText = `${startStr} 〜`;
                } else if (endStr) {
                    periodText = `〜 ${endStr}`;
                }
                
                if (sched.tonnage !== undefined && sched.tonnage !== null) {
                    tonnageText = `${sched.tonnage} t`;
                }
            }

            return `<tr style="border-bottom:1px solid var(--border);">
                <td style="padding:12px 15px; font-weight:bold;">
                    <div style="font-size:0.95rem; color:var(--text);">${row.projectName}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); font-weight:normal; margin-top:4px; display:flex; gap:10px; flex-wrap:wrap;">
                        <span>📅 期間: ${periodText}</span>
                        <span>⚖️ トン数: ${tonnageText}</span>
                    </div>
                </td>
                <td style="padding:12px 15px; color:var(--text-muted); font-size:0.9rem; vertical-align:middle;">${row.month}</td>
                <td style="padding:12px 15px; text-align:right; font-weight:bold; color:#60a5fa; font-size:1.05rem; vertical-align:middle;">${row.hours.toFixed(1)} h</td>
            </tr>`;
        }).join('');
    }

    // グラフ用の集計（X軸：工事名、積層：作業内容）
    const projects = Array.from(new Set(filteredReports.map(r => r.projectName || '(不明な工事)'))).sort();
    const tasksSet = new Set();
    const chartAggMap = new Map(); // key: projectName + "::" + taskName

    filteredReports.forEach(r => {
        const proj = r.projectName || '(不明な工事)';
        const hours = parseFloat(r.hours) || 0;
        const tasks = Array.isArray(r.tasks) ? r.tasks : (r.tasks ? [r.tasks] : []);
        
        // 作業内容が空の場合は「その他」として扱う
        const activeTasks = tasks.length > 0 ? tasks : ['その他'];

        activeTasks.forEach(task => {
            if (!task) return;
            let taskName = task;
            if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                taskName = `その他（${r.notes.trim()}）`;
            }
            tasksSet.add(taskName);

            const key = `${proj}::${taskName}`;
            if (!chartAggMap.has(key)) {
                chartAggMap.set(key, {
                    projectName: proj,
                    taskName: taskName,
                    hours: 0
                });
            }
            // 報告ごとにタスクが複数ある場合は等分する（割合として正しく積み上げるため）
            const distributedHours = hours / activeTasks.length;
            chartAggMap.get(key).hours += distributedHours;
        });
    });

    const sortedTasks = Array.from(tasksSet).sort();

    // 積層カラーパレット定義
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

    // 作業内容ごとのデータセット作成
    const datasets = sortedTasks.map((task, idx) => {
        const data = projects.map(proj => {
            const key = `${proj}::${task}`;
            const item = chartAggMap.get(key);
            return item ? item.hours : 0;
        });

        return {
            label: task,
            data: data,
            backgroundColor: colorPalette[idx % colorPalette.length],
            borderColor: 'transparent',
            borderWidth: 0,
            borderRadius: 6,
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
async function closeDetailModal() {
    // 未保存の変更があるかチェック
    if (originalCompanyConfig) {
        const currentName = document.getElementById('edit-company-name').value || '';
        const currentMaxUsers = document.getElementById('edit-company-max-users').value || '';
        const currentRenewalDate = document.getElementById('edit-contract-renewal-date') ? document.getElementById('edit-contract-renewal-date').value : '';
        const currentPlanStatus = document.getElementById('edit-company-plan-status') ? document.getElementById('edit-company-plan-status').value : '';
        const currentTrialDays = document.getElementById('edit-company-trial-days') ? document.getElementById('edit-company-trial-days').value : '';
        const currentPaymentMethod = document.getElementById('edit-company-payment-method') ? document.getElementById('edit-company-payment-method').value : 'card';

        const currentAdminName = document.getElementById('edit-company-admin-name') ? document.getElementById('edit-company-admin-name').value : '';
        const currentAdminEmail = document.getElementById('edit-company-admin-email') ? document.getElementById('edit-company-admin-email').value : '';

        const isChanged = currentName !== originalCompanyConfig.companyName ||
                          currentMaxUsers !== originalCompanyConfig.maxUsers ||
                          currentRenewalDate !== originalCompanyConfig.contractRenewalDate ||
                          currentPlanStatus !== originalCompanyConfig.planStatus ||
                          (currentPlanStatus === 'trial_active' && currentTrialDays !== originalCompanyConfig.trialDays) ||
                          currentPaymentMethod !== originalCompanyConfig.paymentMethod ||
                          currentAdminName !== originalCompanyConfig.adminName ||
                          currentAdminEmail !== originalCompanyConfig.adminEmail;

        if (isChanged) {
            const saveAndClose = confirm("変更内容が保存されていません。保存して閉じますか？\n\n【OK】保存して閉じる\n【キャンセル】保存せずに閉じる");
            if (saveAndClose) {
                // 保存を実行
                const result = await saveCompanyConfig();
                if (!result || !result.success) {
                    // 保存に失敗した場合はモーダルを閉じずに中断
                    return;
                }
            }
        }
    }

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
    originalCompanyConfig = null; // 変数をクリア
}

// プランステータス変更時の表示制御
const planStatusSelect = document.getElementById('edit-company-plan-status');
const trialPeriodSettings = document.getElementById('trial-period-settings');
if (planStatusSelect && trialPeriodSettings) {
    planStatusSelect.addEventListener('change', () => {
        if (planStatusSelect.value === 'trial_active') {
            trialPeriodSettings.style.display = 'block';
        } else {
            trialPeriodSettings.style.display = 'none';
        }
    });
}

// お支払い方法変更時の表示制御
const paymentMethodSelect = document.getElementById('edit-company-payment-method');
const invoiceSection = document.getElementById('invoice-payment-section');
if (paymentMethodSelect && invoiceSection) {
    paymentMethodSelect.addEventListener('change', () => {
        if (paymentMethodSelect.value === 'invoice') {
            invoiceSection.style.display = 'block';
        } else {
            invoiceSection.style.display = 'none';
        }
    });
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

// モーダルのタブ切り替え
function switchModalTab(tabName) {
    const tabConfigBtn = document.getElementById('modal-tab-config');
    const tabStatsBtn = document.getElementById('modal-tab-stats');
    const contentConfig = document.getElementById('modal-content-config');
    const contentStats = document.getElementById('modal-content-stats');

    if (tabName === 'config') {
        if (tabConfigBtn) {
            tabConfigBtn.classList.add('active');
            tabConfigBtn.style.borderBottomColor = 'var(--primary)';
            tabConfigBtn.style.color = 'var(--primary)';
        }
        if (tabStatsBtn) {
            tabStatsBtn.classList.remove('active');
            tabStatsBtn.style.borderBottomColor = 'transparent';
            tabStatsBtn.style.color = 'var(--text-muted)';
        }
        if (contentConfig) contentConfig.classList.remove('hidden');
        if (contentStats) contentStats.classList.add('hidden');
    } else {
        if (tabConfigBtn) {
            tabConfigBtn.classList.remove('active');
            tabConfigBtn.style.borderBottomColor = 'transparent';
            tabConfigBtn.style.color = 'var(--text-muted)';
        }
        if (tabStatsBtn) {
            tabStatsBtn.classList.add('active');
            tabStatsBtn.style.borderBottomColor = 'var(--primary)';
            tabStatsBtn.style.color = 'var(--primary)';
        }
        if (contentConfig) contentConfig.classList.add('hidden');
        if (contentStats) contentStats.classList.remove('hidden');
    }
}

// モーダルタブ切り替えイベント
const tabConfigBtn = document.getElementById('modal-tab-config');
const tabStatsBtn = document.getElementById('modal-tab-stats');
if (tabConfigBtn) tabConfigBtn.addEventListener('click', () => switchModalTab('config'));
if (tabStatsBtn) tabStatsBtn.addEventListener('click', () => switchModalTab('stats'));

// 企業設定の保存処理
async function saveCompanyConfig() {
    if (!selectedCompanyId) return false;

    const newName = document.getElementById('edit-company-name').value.trim();
    const newAdminName = document.getElementById('edit-company-admin-name') ? document.getElementById('edit-company-admin-name').value.trim() : '';
    const newAdminEmail = document.getElementById('edit-company-admin-email') ? document.getElementById('edit-company-admin-email').value.trim() : '';
    const newMaxUsers = parseInt(document.getElementById('edit-company-max-users').value, 10);
    const selectedPlanStatus = document.getElementById('edit-company-plan-status') ? document.getElementById('edit-company-plan-status').value : 'active';
    const selectedPaymentMethod = document.getElementById('edit-company-payment-method') ? document.getElementById('edit-company-payment-method').value : 'card';

    if (!newName) {
        alert('会社名を入力してください。');
        return false;
    }
    if (isNaN(newMaxUsers) || newMaxUsers < 1) {
        alert('有効な社員上限数（1以上）を入力してください。');
        return false;
    }

    const btnSaveCompanyConfig = document.getElementById('btn-save-company-config');
    if (btnSaveCompanyConfig) {
        btnSaveCompanyConfig.disabled = true;
        btnSaveCompanyConfig.textContent = '⏳ 保存中...';
    }

    try {
        const companyObj = allCompanies.find(c => (c.companyId || c.id) === selectedCompanyId);
        
        let newTrialStart = companyObj.trialStart || null;
        let newTrialEnd = companyObj.trialEnd || null;
        let newPlanName = companyObj.planName || '10名プラン';
        
        if (selectedPlanStatus === 'active') {
            newTrialEnd = null;
            if (newPlanName.includes('無料') || newPlanName.includes('トライアル')) {
                newPlanName = '10名パック追加プラン';
            }
        } else if (selectedPlanStatus === 'trial_expired') {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            newTrialEnd = yesterday;
        } else if (selectedPlanStatus === 'trial_active') {
            const trialDays = parseInt(document.getElementById('edit-company-trial-days').value, 10) || 30;
            const now = new Date();
            if (!newTrialStart) {
                newTrialStart = now;
            }
            const trialEndDate = new Date();
            trialEndDate.setDate(now.getDate() + trialDays);
            trialEndDate.setHours(23, 59, 59, 999);
            newTrialEnd = trialEndDate;
            newPlanName = '10名プラン（無料トライアル）';
        }

        const updateFields = {
            companyName: newName,
            adminName: newAdminName,
            adminEmails: newAdminEmail ? [newAdminEmail] : [],
            maxUsers: newMaxUsers,
            trialStart: newTrialStart,
            trialEnd: newTrialEnd,
            planName: newPlanName,
            paymentMethod: selectedPaymentMethod
        };

        if (companyObj && companyObj.paymentMethod === 'invoice') {
            const renewalInputVal = document.getElementById('edit-contract-renewal-date').value;
            if (renewalInputVal) {
                updateFields.contractRenewalDate = new Date(renewalInputVal);
            }
        }

        const companyRef = doc(db, "companies", selectedCompanyId);
        await updateDoc(companyRef, updateFields);
        
        // 差分の検出
        const changes = {};
        if (newName !== originalCompanyConfig.companyName) {
            changes.companyName = { before: originalCompanyConfig.companyName, after: newName };
        }
        if (newAdminName !== originalCompanyConfig.adminName) {
            changes.adminName = { before: originalCompanyConfig.adminName, after: newAdminName };
        }
        if (newAdminEmail !== originalCompanyConfig.adminEmail) {
            changes.adminEmail = { before: originalCompanyConfig.adminEmail, after: newAdminEmail };
        }
        if (String(newMaxUsers) !== originalCompanyConfig.maxUsers) {
            changes.maxUsers = { before: originalCompanyConfig.maxUsers, after: String(newMaxUsers) };
        }
        if (selectedPaymentMethod !== originalCompanyConfig.paymentMethod) {
            changes.paymentMethod = { before: originalCompanyConfig.paymentMethod, after: selectedPaymentMethod };
        }
        if (selectedPlanStatus !== originalCompanyConfig.planStatus) {
            changes.planStatus = { before: originalCompanyConfig.planStatus, after: selectedPlanStatus };
        }

        // 保存成功したため、初期状態の基準値を現在の値に更新する
        originalCompanyConfig = {
            companyName: newName,
            maxUsers: String(newMaxUsers),
            contractRenewalDate: document.getElementById('edit-contract-renewal-date') ? document.getElementById('edit-contract-renewal-date').value : '',
            planStatus: selectedPlanStatus,
            trialDays: document.getElementById('edit-company-trial-days') ? document.getElementById('edit-company-trial-days').value : '',
            paymentMethod: selectedPaymentMethod,
            adminName: newAdminName,
            adminEmail: newAdminEmail
        };

        // メール通知 API の呼び出し（バックグラウンドで非同期実行）
        if (Object.keys(changes).length > 0) {
            fetch('/api/notify-company-settings-change', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId: selectedCompanyId, changes })
            }).then(response => {
                if (!response.ok) console.error("Failed to send settings change notification email");
                else console.log("Settings change notification email sent successfully");
            }).catch(err => {
                console.error("Error calling settings change notification API:", err);
            });
        }
        
        // ローカルデータをリロードしてテーブルを更新
        await reloadData();
        
        // 再読み込みしたらモーダルのタイトル等も同期する
        const title = document.getElementById('modal-company-title');
        if (title) title.textContent = `🏢 ${newName}`;
        
        return { success: true, hasChanges: Object.keys(changes).length > 0 };
    } catch (err) {
        console.error("Failed to save company config:", err);
        alert('設定の保存に失敗しました: ' + err.message);
        return { success: false, hasChanges: false };
    } finally {
        if (btnSaveCompanyConfig) {
            btnSaveCompanyConfig.disabled = false;
            btnSaveCompanyConfig.textContent = '💾 設定を保存する';
        }
    }
}

// 企業設定の保存ボタンのイベント
const btnSaveCompanyConfig = document.getElementById('btn-save-company-config');
if (btnSaveCompanyConfig) {
    btnSaveCompanyConfig.addEventListener('click', async () => {
        const result = await saveCompanyConfig();
        if (result && result.success) {
            if (result.hasChanges) {
                alert('企業設定を保存しました。管理者へ通知メールを送信しました。');
            } else {
                alert('企業設定を保存しました。');
            }
        }
    });
}

// 企業の無効化／有効化トグル
const btnDisableCompany = document.getElementById('btn-disable-company');
if (btnDisableCompany) {
    btnDisableCompany.addEventListener('click', async () => {
        if (!selectedCompanyId) return;

        const companyObj = allCompanies.find(c => (c.companyId || c.id) === selectedCompanyId);
        if (!companyObj) return;

        const isCurrentlyDisabled = companyObj.status === 'disabled';
        
        let confirmMsg = "";
        let newStatus = "";

        if (isCurrentlyDisabled) {
            confirmMsg = 'この企業アカウントを有効化（ブロック解除）しますか？';
            newStatus = 'active';
        } else {
            confirmMsg = 'この企業を無効化しますか？\nログインができなくなります。';
            newStatus = 'disabled';
        }

        if (!confirm(confirmMsg)) return;

        btnDisableCompany.disabled = true;

        try {
            const companyRef = doc(db, "companies", selectedCompanyId);
            await updateDoc(companyRef, {
                status: newStatus
            });

            alert(newStatus === 'disabled' ? '企業を無効化しました。' : '企業を有効化しました。');
            
            // ローカルデータをリロードしてテーブルを更新
            await reloadData();

            // モーダル内のボタン表示を切り替える
            if (newStatus === 'disabled') {
                btnDisableCompany.textContent = '🟢 この企業を有効化する';
                btnDisableCompany.style.background = 'var(--success)';
            } else {
                btnDisableCompany.textContent = '🚫 この企業を無効化する';
                btnDisableCompany.style.background = 'var(--error)';
            }

        } catch (err) {
            console.error("Failed to update company status:", err);
            alert('状態の更新に失敗しました: ' + err.message);
        } finally {
            btnDisableCompany.disabled = false;
        }
    });
}

// 支払い状況のトグル切り替え（請求書払い企業向け）
const btnTogglePaymentStatus = document.getElementById('btn-toggle-payment-status');
if (btnTogglePaymentStatus) {
    btnTogglePaymentStatus.addEventListener('click', async () => {
        if (!selectedCompanyId) return;

        const companyObj = allCompanies.find(c => (c.companyId || c.id) === selectedCompanyId);
        if (!companyObj) return;

        const currentStatus = companyObj.invoiceStatus || 'unpaid';
        const isPaid = currentStatus === 'paid';
        
        let confirmMsg = "";
        const updateFields = {};

        // 堅牢な日付解析ヘルパー関数（ローカルコピー）
        const parseLocalFirestoreDate = (field) => {
            if (!field) return null;
            if (typeof field.toDate === 'function') return field.toDate();
            if (typeof field.seconds === 'number') return new Date(field.seconds * 1000);
            if (typeof field === 'number') return field > 9999999999 ? new Date(field) : new Date(field * 1000);
            const d = new Date(field);
            return isNaN(d.getTime()) ? null : d;
        };

        if (isPaid) {
            confirmMsg = 'この企業の支払い状況を「未払い」に戻しますか？';
            updateFields.invoiceStatus = 'unpaid';
        } else {
            confirmMsg = 'この企業の支払い状況を「支払い済み」にしますか？\n最終支払日を本日に更新し、次回契約更新日を1ヶ月進めます。';
            updateFields.invoiceStatus = 'paid';
            
            const now = new Date();
            updateFields.lastPaymentDate = now;

            // 次回更新日を1ヶ月進める
            const renewalInput = document.getElementById('edit-contract-renewal-date');
            let baseDate = now;
            if (renewalInput && renewalInput.value) {
                baseDate = new Date(renewalInput.value);
            } else if (companyObj.contractRenewalDate) {
                baseDate = parseLocalFirestoreDate(companyObj.contractRenewalDate);
            } else if (companyObj.trialEnd) {
                baseDate = parseLocalFirestoreDate(companyObj.trialEnd);
            } else if (companyObj.createdAt) {
                baseDate = parseLocalFirestoreDate(companyObj.createdAt);
                baseDate.setMonth(baseDate.getMonth() + 1);
            }
            
            const nextRenewal = new Date(baseDate);
            nextRenewal.setMonth(nextRenewal.getMonth() + 1);
            updateFields.contractRenewalDate = nextRenewal;
        }

        if (!confirm(confirmMsg)) return;

        btnTogglePaymentStatus.disabled = true;
        btnTogglePaymentStatus.textContent = '⏳ 更新中...';

        try {
            const companyRef = doc(db, "companies", selectedCompanyId);
            await updateDoc(companyRef, updateFields);

            alert(isPaid ? '支払い状況を「未払い」に設定しました。' : '支払い状況を「支払い済み」に設定し、更新日を1ヶ月延長しました。');

            // データの再読み込み
            await reloadData();

        } catch (err) {
            console.error("Failed to toggle payment status:", err);
            alert('支払い状況の更新に失敗しました: ' + err.message);
        } finally {
            btnTogglePaymentStatus.disabled = false;
        }
    });
}



