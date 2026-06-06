const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, doc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// URLパラメータの確認 (新規登録後のログインなどで強制ログアウトするため)
const urlParams = new URLSearchParams(window.location.search);
const paramTargetEmail = urlParams.get('email') ? decodeURIComponent(urlParams.get('email')).trim() : null;

// 状態管理
let currentUser = null;
let currentCompany = null;
let allReports = [];
let allSchedules = [];
let allMembers = [];
let authStateGeneration = 0; // 認証状態の世代カウンタ

// ユーザーの所属する会社をFirestoreの adminEmails / memberEmails から解決する関数
async function resolveUserCompany(email, uid) {
    try {
        // 1. ownerUid （会社オーナー）がログインユーザーの UID と一致する会社を検索（最優先）
        if (uid) {
            const qOwner = query(collection(db, "companies"), where("ownerUid", "==", uid));
            const ownerSnapshot = await getDocs(qOwner);
            if (!ownerSnapshot.empty) {
                const docSnap = ownerSnapshot.docs[0];
                const companyData = docSnap.data();
                companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
                companyData.role = 'admin'; // 管理者権限
                return companyData;
            }
        }

        // 2. adminEmails（管理者）に含まれる会社をクエリ
        const qAdmin = query(collection(db, "companies"), where("adminEmails", "array-contains", email));
        const adminSnapshot = await getDocs(qAdmin);
        if (!adminSnapshot.empty) {
            const docSnap = adminSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'admin'; // 管理者権限
            return companyData;
        }

        // 3. memberEmails（一般社員）に含まれる会社をクエリ
        const qMember = query(collection(db, "companies"), where("memberEmails", "array-contains", email));
        const memberSnapshot = await getDocs(qMember);
        if (!memberSnapshot.empty) {
            const docSnap = memberSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'employee'; // 一般社員権限
            return companyData;
        }
        
        // いずれにも該当しない場合は null を返す
        return null;
    } catch (e) {
        console.error("Error resolving company:", e);
        return null;
    }
}

// DOM要素
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');

// 認証状態の監視
// 認証状態の監視をセットアップする関数
function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        authStateGeneration++;
        const currentGeneration = authStateGeneration;
        
        // 接続判定が完了したため、ローディング表示を非表示にする
        const loadingContainer = document.getElementById('loading-container');
        if (loadingContainer) {
            loadingContainer.classList.add('hidden');
        }

        try {
            if (user) {
                // メールアドレスの不一致チェック (email パラメータがある場合)
                if (paramTargetEmail && user.email !== paramTargetEmail) {
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    
                    const emailInput = document.getElementById('login-email');
                    if (emailInput) emailInput.value = paramTargetEmail;
                    return;
                }

                // displayNameがまだ反映されていない場合に備えて再読み込み
                if (!user.displayName) {
                    try { await user.reload(); user = auth.currentUser; } catch(e) {}
                }

                // 世代チェック
                if (currentGeneration !== authStateGeneration) return;

                // メールアドレス確認が完了しているかチェック（特定のテスト用・管理者アドレスはバイパス）
                const isBypassEmail = user.email.includes('oowada') || 
                                      user.email.includes('dai-wada') || 
                                      user.email.includes('daiwada') || 
                                      user.email === '1105yuky00109@gmail.com' ||
                                      user.email === '1105yuky00109-web@github.com';
                                      
                // メールアドレス確認は不要のため、チェックを無効化
                if (false) {
                    console.log("User email is not verified. Logging out.");
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    const errorMsg = document.getElementById('login-error');
                    if (errorMsg) {
                        errorMsg.classList.remove('hidden');
                        errorMsg.textContent = 'メールアドレスの確認が完了していません。登録時に送信された案内メールのリンクをクリックしてアカウントを有効化した後、ログインしてください。';
                    }
                    return;
                }

                // ログイン成功時
                currentUser = auth.currentUser;
                document.getElementById('current-user-email').textContent = currentUser.email;
                
                // 所属会社の解決
                const resolvedCompany = await resolveUserCompany(currentUser.email, currentUser.uid);
                
                // 世代チェック
                if (currentGeneration !== authStateGeneration) return;

                if (!resolvedCompany) {
                    // 所属会社が解決できない未登録ユーザーは強制ログアウトしてエラー表示
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    const errorMsg = document.getElementById('login-error');
                    if (errorMsg) {
                        errorMsg.classList.remove('hidden');
                        errorMsg.textContent = 'このメールアドレスはシステムに登録されていません。管理者にお問い合わせください。';
                    }
                    return;
                }
                
                currentCompany = resolvedCompany;
                const compLabel = document.getElementById('current-company-name');
                if (compLabel) {
                    compLabel.textContent = currentCompany.companyName || currentCompany.companyId;
                }
                
                // 役割（管理者のみ）を示すバッジの表示制御
                const roleBadge = document.getElementById('user-role-badge');
                if (roleBadge) {
                    if (currentCompany && currentCompany.role === 'admin') {
                        roleBadge.textContent = '企業管理者用画面';
                        roleBadge.style.backgroundColor = '#ef4444';
                        roleBadge.style.color = '#ffffff';
                        roleBadge.style.display = 'inline-block';
                    } else {
                        roleBadge.style.display = 'none';
                    }
                }
                
                // 担当者入力欄に表示名（氏名）を自動設定（未設定の場合はメールアドレスの@より前を使用）
                const nameDisplay = currentUser.displayName || currentUser.email.split('@')[0];
                const authorEl = document.getElementById('author');
                if (authorEl) authorEl.value = nameDisplay;
                const schedAuthorEl = document.getElementById('sched-author');
                if (schedAuthorEl) schedAuthorEl.value = nameDisplay;
                
                loginContainer.classList.add('hidden');
                appContainer.classList.remove('hidden');
                
                // データ初期読み込み（DOMContentLoaded後に確実に実行されるよう安全に呼び出す）
                await loadMembers();
                
                // 世代チェック
                if (currentGeneration !== authStateGeneration) return;

                const safeLoadAll = async () => {
                    if (typeof window.loadSchedules === 'function') await window.loadSchedules();
                    if (typeof window.loadReports === 'function') await window.loadReports(false);
                };
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', safeLoadAll, { once: true });
                } else {
                    await safeLoadAll();
                }

                // 世代チェック
                if (currentGeneration !== authStateGeneration) return;

                // 管理者の場合は社員管理パネルを初期化、社員の場合は非表示を確実にする
                const empTab = document.getElementById('tab-employee-manage');
                const configTab = document.querySelector('.tab-btn[data-target="qualifications-view"]');
                const registerTab = document.querySelector('.tab-btn[data-target="schedule-input-view"]');

                if (currentCompany && currentCompany.role === 'admin') {
                    if (empTab) empTab.style.display = '';
                    if (configTab) configTab.style.display = '';
                    if (registerTab) registerTab.style.display = '';
                    setTimeout(() => initEmployeeManagePanel(), 200);
                } else {
                    if (empTab) empTab.style.display = 'none';
                    if (configTab) configTab.style.display = 'none';
                    if (registerTab) registerTab.style.display = 'none';

                    // 現在アクティブなタブが管理・登録用のものの場合は、工程管理表に切り替える
                    const activeTab = document.querySelector('.tab-btn.active');
                    if (activeTab && (activeTab === registerTab || activeTab === configTab || activeTab === empTab)) {
                        const ganttTab = document.querySelector('.tab-btn[data-target="gantt-view"]');
                        if (ganttTab) ganttTab.click();
                    }
                }

                // 初回ログイン時のパスワード強制変更のチェック
                const passModal = document.getElementById('password-change-modal');
                if (passModal && currentCompany) {
                    const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid) : null;
                    if (myEmpInfo && myEmpInfo.mustChangePassword === true) {
                        passModal.style.display = 'flex';
                    } else {
                        passModal.style.display = 'none';
                    }
                }
            } else {
                // ログアウト状態
                currentUser = null;
                currentCompany = null;
                loginContainer.classList.remove('hidden');
                appContainer.classList.add('hidden');
                const roleBadge = document.getElementById('user-role-badge');
                if (roleBadge) {
                    roleBadge.style.display = 'none';
                }
                const passModal = document.getElementById('password-change-modal');
                if (passModal) {
                    passModal.style.display = 'none';
                }
                const empTab = document.getElementById('tab-employee-manage');
                if (empTab) {
                    empTab.style.display = 'none';
                }
            }
        } catch (e) {
            console.error("Auth status error", e);
        }
    });
}

// アプリケーションの初期化
const initApp = async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isForceLogout = urlParams.get('logout') === 'true';
    
    if (isForceLogout) {
        try {
            await signOut(auth);
        } catch (e) {
            console.error("Failed to sign out on logout parameter", e);
        }
    }
    
    // ログインフォームへの初期メールアドレス自動入力
    if (paramTargetEmail) {
        const emailInput = document.getElementById('login-email');
        if (emailInput) {
            emailInput.value = paramTargetEmail;
        }
    }
    
    // URLのクレンジング
    if (window.location.search) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
    
    setupAuthListener();
};

initApp();

// ログイン処理
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');
    const btnLogin = document.getElementById('btn-login');
    
    // ボタンの無効化とスピナー表示
    if (btnLogin) {
        btnLogin.disabled = true;
        btnLogin.innerHTML = '<span class="login-spinner"></span> ログイン中...';
    }
    
    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            errorMsg.classList.add('hidden');
        })
        .catch((error) => {
            console.error(error);
            errorMsg.classList.remove('hidden');
            errorMsg.textContent = 'ログインに失敗しました。メールアドレスとパスワードを確認してください。';
        })
        .finally(() => {
            // ログイン状態移行完了後、または失敗時にボタンを元に戻す
            if (btnLogin) {
                btnLogin.disabled = false;
                btnLogin.innerHTML = 'ログイン';
            }
        });
});

// ============================================================
// 🔑 パスワード再設定フォームの制御
// ============================================================
const btnShowReset = document.getElementById('btn-show-reset');
const resetSection = document.getElementById('reset-password-section');
const btnSendReset = document.getElementById('btn-send-reset');
const resetEmailInput = document.getElementById('reset-email');
const resetSuccess = document.getElementById('reset-success');
const resetError = document.getElementById('reset-error');

if (btnShowReset && resetSection) {
    btnShowReset.addEventListener('click', () => {
        const isHidden = resetSection.style.display === 'none';
        resetSection.style.display = isHidden ? 'block' : 'none';
        // リセットフォーム表示時にメール欄をフォーカス
        if (isHidden && resetEmailInput) {
            // ログイン欄に入力済みのメールがあれば自動コピー
            const loginEmailVal = document.getElementById('login-email').value;
            if (loginEmailVal) resetEmailInput.value = loginEmailVal;
            resetEmailInput.focus();
        }
    });
}

if (btnSendReset) {
    btnSendReset.addEventListener('click', async () => {
        const email = resetEmailInput ? resetEmailInput.value.trim() : '';
        if (!email) {
            if (resetError) {
                resetError.textContent = 'メールアドレスを入力してください。';
                resetError.classList.remove('hidden');
            }
            return;
        }

        // ボタンを無効化してUI反映
        btnSendReset.disabled = true;
        btnSendReset.textContent = '送信中...';
        if (resetSuccess) resetSuccess.classList.add('hidden');
        if (resetError) resetError.classList.add('hidden');

        try {
            // 登録済みメールアドレスかどうかの所属検証（未ログインでも安全に確認するためAPIを使用）
            const checkRes = await fetch('/check-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const checkData = await checkRes.json();
            if (!checkRes.ok || !checkData.registered) {
                if (resetError) {
                    resetError.textContent = 'このメールアドレスはシステムに登録されていません。管理者へアカウントの追加を依頼してください。';
                    resetError.classList.remove('hidden');
                }
                btnSendReset.disabled = false;
                btnSendReset.textContent = '送信';
                return;
            }

            // Firebaseのパスワード再設定メールを送信（カスタムURL付き）
            await sendPasswordResetEmail(auth, email, {
                url: 'https://tekko-factory-app.web.app/',
                handleCodeInApp: false
            });
            if (resetSuccess) {
                resetSuccess.textContent = `✅ ${email} にパスワード再設定用のメールを送信しました。メールをご確認ください。`;
                resetSuccess.classList.remove('hidden');
            }
            if (resetEmailInput) resetEmailInput.value = '';
        } catch (err) {
            console.error('sendPasswordResetEmail error:', err);
            if (resetError) {
                resetError.textContent = 'メールの送信に失敗しました。詳細: ' + (err.message || err.code || err);
                resetError.classList.remove('hidden');
            }
        } finally {
            btnSendReset.disabled = false;
            btnSendReset.textContent = '送信';
        }
    });
}


function initEmployeeManagePanel() {
    if (!currentUser || !currentCompany || currentCompany.role !== 'admin') return;

    const tab = document.getElementById('tab-employee-manage');
    if (!tab) return;
    tab.style.display = '';

    const empAddForm = document.getElementById('employee-add-form');
    const empAddMsg = document.getElementById('emp-add-message');
    const empListTbody = document.getElementById('employee-list-tbody');

    // 登録済み社員一覧を描画する関数
    const renderEmployeeList = () => {
        if (!empListTbody) return;
        const employees = currentCompany.employees || [];
        
        // 残り登録可能人数およびバッジの描画 (管理者 + 社員数)
        const maxUsers = currentCompany.maxUsers || 20;
        const adminCount = (currentCompany.adminEmails || []).length;
        const totalCount = adminCount + employees.length;
        const remaining = Math.max(0, maxUsers - totalCount);
        
        const countBadge = document.getElementById('emp-count-badge');
        if (countBadge) {
            countBadge.textContent = `（残り登録可能: ${remaining}名 / 最大${maxUsers}名、現在: ${totalCount}名登録済み）`;
        }

        // 入力フォームとボタンの制御 (上限に達している場合は無効化)
        const submitBtn = empAddForm ? empAddForm.querySelector('button[type="submit"]') : null;
        const nameInput = document.getElementById('emp-name');
        const emailInput = document.getElementById('emp-email');
        if (totalCount >= maxUsers) {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '登録上限に達しています';
                submitBtn.style.backgroundColor = '#94a3b8'; // グレーアウト色
            }
            if (nameInput) nameInput.disabled = true;
            if (emailInput) emailInput.disabled = true;
        } else {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = '社員を追加する';
                submitBtn.style.backgroundColor = ''; // デフォルト色に戻す
            }
            if (nameInput) nameInput.disabled = false;
            if (emailInput) emailInput.disabled = false;
        }

        if (employees.length === 0) {
            empListTbody.innerHTML = `
                <tr>
                    <td colspan="2" style="padding: 20px; text-align: center; color: var(--text-muted);">登録されている社員はいません。</td>
                </tr>
            `;
            return;
        }
        
        // 登録日順（降順）でソート
        const sorted = [...employees].sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
        empListTbody.innerHTML = sorted.map((emp, idx) => {
            const bg = idx % 2 ? '#f8fafc' : '#fff';
            return `
                <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                    <td style="padding: 12px; font-weight: bold; color: var(--text);">${emp.name}</td>
                    <td style="padding: 12px; color: var(--text-muted); font-family: monospace;">${emp.email}</td>
                </tr>
            `;
        }).join('');
    };

    // タブクリック時の追加処理
    tab.addEventListener('click', () => {
        // 表示切り替え処理は共通のタブボタン用イベントリスナーが実行するため、
        // ここでは会社情報をFirestoreから最新にロードして社員一覧を更新する処理のみを行います。
        loadLatestCompanyInfo().then(() => {
            renderEmployeeList();
        });
    });

    // 社員追加フォーム送信処理
    if (empAddForm) {
        empAddForm.onsubmit = async (e) => {
            e.preventDefault();
            empAddMsg.className = 'message';
            empAddMsg.textContent = '登録中...';
            empAddMsg.classList.remove('hidden');

            const name = document.getElementById('emp-name').value.trim();
            const email = document.getElementById('emp-email').value.trim();

            try {
                // Cloud Functions API (addEmployee) の呼び出し
                const response = await fetch('/add-employee', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        companyId: currentCompany.companyId,
                        adminEmail: currentUser.email,
                        adminUid: currentUser.uid,
                        employeeName: name,
                        employeeEmail: email
                    }),
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error || '通信エラーが発生しました。');
                }

                empAddMsg.className = 'message success';
                empAddMsg.textContent = `社員「${name}」のアカウントを正常に追加しました！本人宛てに仮パスワードと再設定案内のメールを送信しました。`;
                empAddForm.reset();

                // 会社情報を最新に更新し、一覧を再描画
                await loadLatestCompanyInfo();
                renderEmployeeList();
            } catch (err) {
                console.error(err);
                empAddMsg.className = 'message error';
                empAddMsg.textContent = `登録に失敗しました: ${err.message}`;
            }
        };
    }
}

// 会社ドキュメントを最新にリロードするヘルパー関数
async function loadLatestCompanyInfo() {
    if (!currentUser || !currentCompany) return;
    try {
        const compDoc = await getDocs(query(collection(db, "companies"), where("companyId", "==", currentCompany.companyId)));
        if (!compDoc.empty) {
            // 現在のロールを保持しながら会社情報を更新
            const role = currentCompany.role;
            currentCompany = compDoc.docs[0].data();
            currentCompany.role = role;
        }
    } catch(e) {
        console.error("Error reloading company info:", e);
    }
}

// ============================================================
// 🏅 資格・担当者マスタ管理機能
// ============================================================

// 役割マッピング
const ROLE_MAP = {
    'sales': '営業担当',
    'const': '工務担当',
    'site': '工事担当',
    'tech': '主任技術者'
};

// 資格マッピング
const QUAL_MAP = {
    '2nd_const_body': '2級建築施工管理技士（躯体）',
    '2nd_const_finish': '2級建築施工管理技士（仕上）',
    '1st_const': '1級建築施工管理技士',
    '1st_civil': '1級土木施工管理技士',
    'practical': '実務経験'
};

// プリセットカラー（工事担当者ごとに自動設定される色）
// 視認性が高く、互いに区別しやすい12色
const PRESET_COLORS = [
    '#2563eb', // 青
    '#16a34a', // 緑
    '#ea580c', // オレンジ
    '#9333ea', // 紫
    '#db2777', // ピンク
    '#ca8a04', // 黄
    '#0d9488', // ティール
    '#e11d48', // ローズ
    '#4f46e5', // インディゴ
    '#0284c7', // ライトブルー
    '#059669', // エメラルド
    '#b45309'  // アンバー
];

// 工事担当者ごとの色のキャッシュ
const siteRepColorCache = {};
let colorIndexCounter = 0;

// 工事担当者名から一意の色を決定する関数
function getBarColorForSiteRep(siteRep) {
    if (!siteRep || siteRep.trim() === "" || siteRep === "選択してください") {
        return '#64748b'; // 未指定時はグレー
    }
    const cleanName = siteRep.trim();
    if (siteRepColorCache[cleanName]) {
        return siteRepColorCache[cleanName];
    }
    const color = PRESET_COLORS[colorIndexCounter % PRESET_COLORS.length];
    siteRepColorCache[cleanName] = color;
    colorIndexCounter++;
    return color;
}

// マスタ読み込み
async function loadMembers() {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        const q = query(collection(db, "companies", companyId, "members"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);
        allMembers = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // 各種UIの更新
        updateQualificationsSummary();
        renderMemberList();
        populateMemberDropdowns();
    } catch (e) {
        console.error("Error loading members: ", e);
    }
}

// 資格・担当者マスタ一覧のテーブル描画
function renderMemberList() {
    const tbody = document.getElementById('member-list-tbody');
    if (!tbody) return;

    if (allMembers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">メンバーが登録されていません。</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = allMembers.map((m, idx) => {
        const bg = idx % 2 ? '#f8fafc' : '#fff';
        
        // 役割の日本語表示
        const rolesText = (m.roles || []).map(r => ROLE_MAP[r] || r).join(', ');
        
        // 資格の日本語表示
        const qualList = (m.qualifications || []).map(q => QUAL_MAP[q] || q);
        if (m.customQualifications) {
            qualList.push(m.customQualifications);
        }
        const qualsText = qualList.join(', ') || '資格なし';

        return `
            <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                <td style="padding: 12px; font-weight: bold; color: var(--text);">${m.name}</td>
                <td style="padding: 12px; color: var(--text-main);">${rolesText}</td>
                <td style="padding: 12px; color: var(--text-muted); font-size: 0.85rem;">${qualsText}</td>
                <td style="padding: 12px; text-align: center;">
                    <button class="btn btn-danger btn-small delete-member-btn" data-id="${m.id}" style="padding: 6px 12px;">削除</button>
                </td>
            </tr>
        `;
    }).join('');

    // 削除ボタンのイベント紐付け
    tbody.querySelectorAll('.delete-member-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const memberId = btn.dataset.id;
            const member = allMembers.find(m => m.id === memberId);
            if (member && confirm(`「${member.name}」さんをマスタから削除しますか？\nこの担当者は工程登録の選択肢から除外されます。`)) {
                await deleteMember(memberId);
            }
        });
    });
}

// 資格保有者の動的な人数集計サマリー表示
function updateQualificationsSummary() {
    const container = document.getElementById('qualifications-summary-container');
    if (!container) return;

    // 資格ごとの人数と該当者名リストの集計
    const summary = {};
    Object.keys(QUAL_MAP).forEach(key => {
        summary[key] = { label: QUAL_MAP[key], members: [] };
    });
    // カスタム資格用の集計
    const customSummary = {};

    allMembers.forEach(m => {
        const memberLabel = m.name;

        // 標準資格
        (m.qualifications || []).forEach(q => {
            if (summary[q]) {
                summary[q].members.push(memberLabel);
            }
        });

        // カスタム資格
        if (m.customQualifications) {
            const cq = m.customQualifications.trim();
            if (cq) {
                if (!customSummary[cq]) {
                    customSummary[cq] = { label: cq, members: [] };
                }
                customSummary[cq].members.push(memberLabel);
            }
        }
    });

    // バッジHTMLの生成
    let html = '';
    
    // 標準資格バッジ
    Object.keys(summary).forEach(key => {
        const item = summary[key];
        if (item.members.length > 0) {
            const listStr = item.members.join(', ');
            html += `
                <div class="qual-summary-badge" title="${listStr}">
                    《${item.label}》 ${item.members.map(name => name.split('(')[0]).join('・')}
                    <span class="badge-count">${item.members.length}名</span>
                </div>
            `;
        }
    });

    // カスタム資格バッジ
    Object.keys(customSummary).forEach(key => {
        const item = customSummary[key];
        if (item.members.length > 0) {
            const listStr = item.members.join(', ');
            html += `
                <div class="qual-summary-badge" title="${listStr}">
                    《${item.label}》 ${item.members.map(name => name.split('(')[0]).join('・')}
                    <span class="badge-count">${item.members.length}名</span>
                </div>
            `;
        }
    });

    if (html === '') {
        html = '<div style="color: var(--text-muted); font-size: 0.9rem; padding: 10px;">現在、資格保有者を集計できるメンバーが登録されていません。</div>';
    }

    container.innerHTML = html;
}

// 登録フォームでの担当者プルダウン自動反映
function populateMemberDropdowns() {
    const salesSelect = document.getElementById('sched-sales-rep');
    const constSelect = document.getElementById('sched-const-rep');
    const siteSelect = document.getElementById('sched-site-rep');
    const chiefSelect = document.getElementById('sched-chief-tech');

    // それぞれのプルダウンが存在するか確認
    if (!salesSelect || !constSelect || !siteSelect || !chiefSelect) return;

    // 選択された値を退避
    const curSales = salesSelect.value;
    const curConst = constSelect.value;
    const curSite = siteSelect.value;
    const curChief = chiefSelect.value;

    // プルダウンのクリアと初期化
    const initSelect = (select) => {
        select.innerHTML = '<option value="">選択してください</option>';
    };
    initSelect(salesSelect);
    initSelect(constSelect);
    initSelect(siteSelect);
    initSelect(chiefSelect);

    // メンバーを役割ごとに分類して追加
    allMembers.forEach(m => {
        const roles = m.roles || [];
        const isSales = roles.includes('sales');
        const isConst = roles.includes('const');
        const isSite = roles.includes('site');
        // 主任技術者は資格（標準またはカスタム）を保有しているメンバー全員を対象とする
        const isChiefEligible = (m.qualifications && m.qualifications.length > 0) || (m.customQualifications && m.customQualifications.trim() !== "");

        const optHtml = `<option value="${m.name}">${m.name}</option>`;

        if (isSales) salesSelect.innerHTML += optHtml;
        if (isConst) constSelect.innerHTML += optHtml;
        if (isSite) siteSelect.innerHTML += optHtml;
        if (isChiefEligible) chiefSelect.innerHTML += optHtml;
    });

    // 選択値を復元
    salesSelect.value = curSales;
    constSelect.value = curConst;
    siteSelect.value = curSite;
    chiefSelect.value = curChief;
}

// メンバー登録
async function addMember(name, roles, qualifications, customQualifications, isDedicated) {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        const newMember = {
            name,
            roles,
            qualifications,
            customQualifications,
            isDedicated,
            createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, "companies", companyId, "members"), newMember);
        await loadMembers();
    } catch (e) {
        console.error("Error adding member: ", e);
        alert("メンバーの登録に失敗しました。");
    }
}

// メンバー削除
async function deleteMember(memberId) {
    if (!currentUser || !currentCompany) return;
    try {
        const companyId = currentCompany.companyId;
        await deleteDoc(doc(db, "companies", companyId, "members", memberId));
        await loadMembers();
    } catch (e) {
        console.error("Error deleting member: ", e);
        alert("メンバーの削除に失敗しました。");
    }
}

// DOMContentLoadedの後半でバインドするための初期化処理
document.addEventListener('DOMContentLoaded', () => {
    // メンバー登録フォームの送信処理
    const memberForm = document.getElementById('member-add-form');
    const memberMsg = document.getElementById('member-add-message');

    if (memberForm) {
        memberForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (memberMsg) {
                memberMsg.className = 'message';
                memberMsg.textContent = '登録中...';
                memberMsg.classList.remove('hidden');
            }

            const name = document.getElementById('member-name').value.trim();
            const dedication = "none";
            const customQual = "";

            // 役割ラジオボタン (単一選択)
            const roleEl = document.querySelector('input[name="member-role"]:checked');
            const roles = roleEl ? [roleEl.value] : [];

            // 資格チェックボックス
            const qualifications = [];
            document.querySelectorAll('input[name="member-qual"]:checked').forEach(cb => {
                qualifications.push(cb.value);
            });

            if (roles.length === 0) {
                alert('担当役割は少なくとも1つ選択してください。');
                if (memberMsg) memberMsg.classList.add('hidden');
                return;
            }

            try {
                await addMember(name, roles, qualifications, customQual, dedication);
                
                if (memberMsg) {
                    memberMsg.className = 'message success';
                    memberMsg.textContent = `メンバー「${name}」を登録しました！`;
                }
                memberForm.reset();
                setTimeout(() => {
                    if (memberMsg) memberMsg.classList.add('hidden');
                }, 3000);
            } catch (err) {
                console.error(err);
                if (memberMsg) {
                    memberMsg.className = 'message error';
                    memberMsg.textContent = '登録に失敗しました。';
                }
            }
        });
    }
});



// ログアウト処理
btnLogout.addEventListener('click', () => {
    if (confirm('ログアウトしますか？')) { signOut(auth).catch(err => console.error(err)); }
});

// ユーティリティ関数
const getDaysOfWeek = (weekStr) => {
    if (!weekStr) return null;
    const parts = weekStr.split('-W');
    if (parts.length !== 2) return null;
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeekJan4 = jan4.getDay() || 7;
    const firstMonday = new Date(year, 0, 4 - dayOfWeekJan4 + 1);
    const targetMonday = new Date(firstMonday.getTime() + (week - 1) * 7 * 24 * 60 * 60 * 1000);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(new Date(targetMonday.getTime() + i * 24 * 60 * 60 * 1000));
    return days;
};
const formatDate = (dateObj) => `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
const formatWeekRange = (weekStr) => {
    const days = getDaysOfWeek(weekStr);
    return days ? `${formatDate(days[0])}〜${formatDate(days[6])}` : weekStr;
};
const getMonthStr = (weekStr) => {
    const days = getDaysOfWeek(weekStr);
    if (!days) return "";
    const d = days[0]; // 月曜日の日付を含む月をその週の「月」とする
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// タイムラインの48文字から、作業の連続する時間帯を配列で返す関数（例: ["09:00〜12:00", "13:00〜17:00"]）
const getTimelineIntervals = (timelineStr) => {
    if (!timelineStr || timelineStr.length !== 48) return [];
    const intervals = [];
    let inInterval = false;
    let startIdx = -1;
    
    for (let i = 0; i < 48; i++) {
        const state = parseInt(timelineStr[i]);
        if (state === 1) { // 作業
            if (!inInterval) {
                inInterval = true;
                startIdx = i;
            }
        } else {
            if (inInterval) {
                inInterval = false;
                intervals.push({ start: startIdx, end: i });
            }
        }
    }
    if (inInterval) {
        intervals.push({ start: startIdx, end: 48 });
    }
    
    return intervals.map(interval => {
        const formatTime = (idx) => {
            const h = Math.floor(idx / 2);
            const m = (idx % 2 === 0) ? '00' : '30';
            return `${String(h).padStart(2, '0')}:${m}`;
        };
        return `${formatTime(interval.start)}〜${formatTime(interval.end)}`;
    });
};

// 今週のISO週（YYYY-Www）を取得する関数
const getISOWeekString = (date) => {
    const tempDate = new Date(date.valueOf());
    tempDate.setDate(tempDate.getDate() + 4 - (tempDate.getDay() || 7));
    const yearStart = new Date(tempDate.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((tempDate - yearStart) / 86400000) + 1) / 7);
    return `${tempDate.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

// 今年と来年の週（月曜日の日付基準）を逆順でプルダウンの選択肢として生成する関数
const generateWeekOptions = () => {
    const select = document.getElementById('week');
    if (!select) return;
    
    select.innerHTML = '';
    
    const today = new Date();
    const currentWeekStr = getISOWeekString(today);
    const currentYear = today.getFullYear();
    
    const options = [];
    
    // 前年・今年・来年の3年分生成
    for (let year = currentYear - 1; year <= currentYear + 1; year++) {
        const start = new Date(year, 0, 1);
        const dayOfWeek = start.getDay();
        const firstMonday = new Date(start.getTime() + ((dayOfWeek <= 1 ? 1 - dayOfWeek : 8 - dayOfWeek) * 24 * 60 * 60 * 1000));
        
        let currentMonday = new Date(firstMonday.getTime());
        
        while (currentMonday.getFullYear() <= year) {
            const weekStr = getISOWeekString(currentMonday);
            const m = currentMonday.getMonth() + 1;
            const d = currentMonday.getDate();
            const sy = currentMonday.getFullYear();
            
            const sunday = new Date(currentMonday.getTime() + 6 * 24 * 60 * 60 * 1000);
            const sm = sunday.getMonth() + 1;
            const sd = sunday.getDate();
            
            // 重複排除
            if (!options.find(o => o.value === weekStr)) {
                options.push({
                    value: weekStr,
                    text: `${sy}年 ${m}/${d} 〜 ${sm}/${sd} の週`
                });
            }
            
            currentMonday.setDate(currentMonday.getDate() + 7);
        }
    }
    
    // 新しい週が先頭になるよう逆順にして、現在週をselected
    options.sort((a, b) => b.value.localeCompare(a.value));
    options.forEach(opt => {
        const el = document.createElement('option');
        el.value = opt.value;
        el.textContent = opt.text;
        if (opt.value === currentWeekStr) {
            el.selected = true;
        }
        select.appendChild(el);
    });
};

// 週の開始日（月曜日）から各曜日の実際の日付をラベルに表示する関数
const updateDayLabels = () => {
    const weekInput = document.getElementById('week');
    if (!weekInput || !weekInput.value) return;
    
    const getMondayOfISOWeek = (weekStr) => {
        const parts = weekStr.split('-W');
        if (parts.length !== 2) return null;
        const year = parseInt(parts[0], 10);
        const week = parseInt(parts[1], 10);
        
        const simple = new Date(year, 0, 4);
        const dayOfWeek = simple.getDay();
        const ISOweekStart = new Date(simple.valueOf() - (dayOfWeek ? dayOfWeek - 1 : 6) * 86400000);
        return new Date(ISOweekStart.valueOf() + (week - 1) * 7 * 86400000);
    };
    
    const monday = getMondayOfISOWeek(weekInput.value);
    if (!monday) return;
    
    const daysMap = { '月': 0, '火': 1, '水': 2, '木': 3, '金': 4, '土': 5, '日': 6 };
    
    document.querySelectorAll('.day-card').forEach(card => {
        const labelSpan = card.querySelector('.day-label');
        const taskList = card.querySelector('.task-list');
        if (!labelSpan || !taskList) return;
        
        const dayName = taskList.dataset.day;
        const offset = daysMap[dayName];
        if (offset === undefined) return;
        
        const targetDate = new Date(monday.getTime() + offset * 86400000);
        const m = targetDate.getMonth() + 1;
        const d = targetDate.getDate();
        labelSpan.textContent = `${m}/${d} (${dayName})`;
    });
};

// --- 初期化ロジック群 ---
document.addEventListener('DOMContentLoaded', () => {
    const weekInput = document.getElementById('week');
    const weekDisplayHint = document.getElementById('week-display-hint');
    if (weekInput) {
        generateWeekOptions();
        if (!weekInput.value) {
            weekInput.value = getISOWeekString(new Date());
        }
        weekDisplayHint.textContent = weekInput.value ? formatWeekRange(weekInput.value) + ' の報告' : '';
        
        weekInput.addEventListener('change', () => {
            weekDisplayHint.textContent = weekInput.value ? formatWeekRange(weekInput.value) + ' の報告' : '';
            updateDayLabels();
            loadReportForSelectedWeek();
        });
        
        setTimeout(() => {
            updateDayLabels();
            loadReportForSelectedWeek();
        }, 500);
    }

    // テーマ切り替え初期化
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-theme');
        }
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-theme');
            const isDark = document.body.classList.contains('dark-theme');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }

    // 日付ショートカット処理
    document.querySelectorAll('.btn-date-shortcut').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const type = btn.dataset.type;
            const targetInput = document.getElementById(targetId);
            if (!targetInput) return;

            const now = new Date();
            let dateVal = '';

            if (type === 'today') {
                dateVal = now.toISOString().split('T')[0];
            } else if (type === 'tomorrow') {
                now.setDate(now.getDate() + 1);
                dateVal = now.toISOString().split('T')[0];
            } else if (type === 'next-monday') {
                const daysUntilNextMonday = (1 - now.getDay() + 7) % 7 || 7;
                now.setDate(now.getDate() + daysUntilNextMonday);
                dateVal = now.toISOString().split('T')[0];
            }

            targetInput.value = dateVal;
            // 終了日も同じ日に自動設定
            const endInput = document.getElementById('sched-end');
            if (endInput && !endInput.value) {
                endInput.value = dateVal;
            }
        });
    });

    // タブ切り替え
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.target).classList.add('active');
            
            if (btn.dataset.target === 'gantt-view' || btn.dataset.target === 'summary-view') {
                document.body.classList.add('print-a3-landscape');
                if (btn.dataset.target === 'gantt-view') loadSchedules();
                if (btn.dataset.target === 'summary-view') loadReports(true);
            } else {
                document.body.classList.remove('print-a3-landscape');
                if (btn.dataset.target === 'list-view') loadReports(false);
            }
        });
    });

    // フォーム制御関数 (一括 disabled化/活性化)
    const setFormLocked = (isLocked) => {
        const form = document.getElementById('report-form');
        if (!form) return;
        
        // 入力項目, ボタンを一括制御
        form.querySelectorAll('input, textarea, select, button').forEach(el => {
            if (el.id === 'week' || el.id === 'btn-print-weekly' || el.closest('#report-action-buttons')) {
                return;
            }
            el.disabled = isLocked;
        });
        
        // 日報コピー欄の無効化
        const copySelect = document.getElementById('copy-past-report-select');
        const copyBtn = document.getElementById('btn-copy-past-report');
        if (copySelect) copySelect.disabled = isLocked;
        if (copyBtn) copyBtn.disabled = isLocked;
        
        // タイムラインとパレットの操作無効化
        document.querySelectorAll('.timeline-container-scroll, .timeline-palette').forEach(el => {
            if (isLocked) {
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.5';
            } else {
                const row = el.closest('.task-row');
                if (row && row.classList.contains('leave-row')) {
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0.5';
                } else {
                    el.style.pointerEvents = 'auto';
                    el.style.opacity = '1';
                }
            }
        });
        
        // 追加・削除ボタンの非表示・表示切替
        document.querySelectorAll('.btn-add-task, .remove-task-btn, .btn-copy-prev').forEach(btn => {
            if (isLocked) {
                btn.style.display = 'none';
            } else {
                btn.style.display = '';
            }
        });
    };

    // 日次レポート入力欄の無効化・背景グレーアウト制御
    const updateDayReportTextStatus = (dayCard) => {
        if (!dayCard) return;
        const reportTextarea = dayCard.querySelector('.day-report-text');
        if (!reportTextarea) return;
        
        const projInputs = dayCard.querySelectorAll('.task-project');
        let hasLeave = false;
        projInputs.forEach(input => {
            const val = input.value.trim();
            if (['有給', '欠勤', '休日'].includes(val)) {
                hasLeave = true;
            }
        });
        
        const badge = document.getElementById('report-status-badge');
        const isLocked = badge && badge.classList.contains('status-approved');
        
        if (hasLeave) {
            reportTextarea.value = '';
            reportTextarea.disabled = true;
            reportTextarea.style.backgroundColor = '#f1f5f9';
        } else {
            if (isLocked) {
                reportTextarea.disabled = true;
                reportTextarea.style.backgroundColor = '';
            } else {
                reportTextarea.disabled = false;
                reportTextarea.style.backgroundColor = '';
            }
        }
    };

    // 日別入力枠
    const daysName = ['月', '火', '水', '木', '金', '土', '日'];
    const daysContainer = document.getElementById('days-container');
    const taskRowTemplate = document.getElementById('task-row-template');

    const calculateWeekTotal = () => {
        let weekTotal = 0;
        document.querySelectorAll('.total-hours').forEach(span => {
            const h = parseFloat(span.textContent.replace('計 ', '').replace('H', ''));
            if (!isNaN(h)) weekTotal += h;
        });
        const weekTotalSpan = document.getElementById('week-total-hours');
        if (weekTotalSpan) {
            weekTotalSpan.textContent = `合計: ${weekTotal.toFixed(1)}H`;
        }
    };

    const loadReportForSelectedWeek = () => {
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        const badge = document.getElementById('report-status-badge');
        const actionContainer = document.getElementById('report-action-buttons');
        if (!weekInput || !authorInput) return;
        
        const selectedWeek = weekInput.value;
        const currentAuthor = authorInput.value;
        if (!selectedWeek || !currentAuthor) return;
        
        const currentWeek = getISOWeekString(new Date());
        const isFutureWeek = selectedWeek > currentWeek; // 選択された週が今日より未来の週かどうか
        
        const existingReport = allReports.find(r => r.week === selectedWeek && r.author === currentAuthor);
        
        // 全曜日クリア
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.clearAll) {
                taskList.clearAll();
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) reportText.value = '';
            }
        });
        
        // デフォルトではロック解除
        setFormLocked(false);
        
        if (existingReport) {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (taskList && taskList.addTaskRow) {
                    const tasks = existingReport.dailyLogs ? (existingReport.dailyLogs[day] || []) : [];
                    tasks.forEach(t => {
                        taskList.addTaskRow(t.project, t.detail, t.hours, t.timeline || '');
                    });
                    if (tasks.length === 0) {
                        taskList.addTaskRow();
                    }
                    const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                    if (reportText) {
                        reportText.value = (existingReport.dailyReports && existingReport.dailyReports[day]) ? existingReport.dailyReports[day] : '';
                    }
                }
            });
            
            // ステータスに応じた処理
            let status = existingReport.status;
            if (!status) {
                status = isFutureWeek ? 'plan' : 'confirmed'; // 古いデータは未来の週なら予定、過去なら確定済み扱いとする
            }
            // 未来の週は強制的に予定(plan)状態とする
            if (isFutureWeek) {
                status = 'plan';
            }
            
            if (badge) {
                if (status === 'approved') {
                    badge.className = 'status-badge status-approved';
                    badge.textContent = '上長承認済み';
                } else if (status === 'confirmed') {
                    badge.className = 'status-badge status-confirmed';
                    badge.textContent = '実績確定済み';
                } else {
                    badge.className = 'status-badge status-plan';
                    badge.textContent = '予定（未確定）';
                }
            }
            
            // ロック処理
            if (status === 'approved') {
                setFormLocked(true);
            }
            
            if (actionContainer) {
                if (isFutureWeek) {
                    // 未来の週は予定の更新（一時保存）のみ可能
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定を更新（一時保存）</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else if (status === 'approved') {
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-unapprove-report" class="btn btn-danger btn-large">上長承認を取り消す</button>
                    `;
                    const btnUnapprove = document.getElementById('btn-unapprove-report');
                    if (btnUnapprove) {
                        btnUnapprove.addEventListener('click', () => saveReport('confirmed'));
                    }
                } else if (status === 'confirmed') {
                    actionContainer.innerHTML = `
                        <button type="submit" id="btn-submit-report" class="btn btn-success btn-large" style="flex: 1;">実績確定を更新（上書き）</button>
                        <button type="button" id="btn-approve-report" class="btn btn-primary btn-large" style="flex: 1; background-color: var(--primary);">上長承認する</button>
                    `;
                    const btnApprove = document.getElementById('btn-approve-report');
                    if (btnApprove) {
                        btnApprove.addEventListener('click', () => saveReport('approved'));
                    }
                } else {
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定として一時保存</button>
                        <button type="submit" id="btn-submit-report" class="btn btn-primary btn-large" style="flex: 1;">実績として確定登録</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                }
            }
        } else {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (taskList && taskList.addTaskRow) {
                    taskList.addTaskRow();
                }
            });
            
            if (badge) {
                badge.className = 'status-badge status-none';
                badge.textContent = '未登録';
            }
            
            if (actionContainer) {
                if (isFutureWeek) {
                    // 未来の週は予定として一時保存のみ可能
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定として一時保存</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else {
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定として一時保存</button>
                        <button type="submit" id="btn-submit-report" class="btn btn-primary btn-large" style="flex: 1;">実績として確定登録</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                }
            }
        }
        calculateWeekTotal();
        
        // 各曜日の日次レポート欄の状態をアップデート
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
            updateDayReportTextStatus(dayCard);
        });
    };

    if (daysContainer) {
        daysName.forEach(day => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-card';
            const copyBtnHtml = day !== '月' ? `<button type="button" class="btn btn-secondary btn-small btn-copy-prev" style="padding: 2px 8px; font-size: 0.75rem; border-radius: 4px; font-weight: bold;">前日からコピー</button>` : '';
            dayCard.innerHTML = `
                <div class="day-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <span class="day-label">${day}曜日</span>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        ${copyBtnHtml}
                        <span class="total-hours" style="font-size: 0.85rem; font-weight: normal;">計 0.0H</span>
                    </div>
                </div>
                <div class="day-body">
                    <div class="task-list" data-day="${day}"></div>
                    <button type="button" class="btn btn-add-task">＋ 工事・作業を追加</button>
                    <div class="day-report-field" style="margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px;">
                        <label style="font-size: 0.85rem; font-weight: bold; margin-bottom: 5px; display: block; color: var(--text-muted);">📝 日次レポート・備考</label>
                        <textarea class="day-report-text" rows="2" placeholder="今日の作業報告や特記事項を記入してください" style="width: 100%; border: 1px solid var(--border); border-radius: 4px; padding: 8px; font-size: 0.9rem; background: var(--bg); color: var(--text); resize: vertical;"></textarea>
                    </div>
                </div>
            `;
            daysContainer.appendChild(dayCard);
            const taskList = dayCard.querySelector('.task-list');
            
            const copyPrevBtn = dayCard.querySelector('.btn-copy-prev');
            if (copyPrevBtn) {
                copyPrevBtn.addEventListener('click', () => {
                    const prevDayIdx = daysName.indexOf(day) - 1;
                    if (prevDayIdx < 0) return;
                    const prevDay = daysName[prevDayIdx];
                    const prevTaskList = document.querySelector(`.task-list[data-day="${prevDay}"]`);
                    if (!prevTaskList) return;
                    
                    const prevRows = prevTaskList.querySelectorAll('.task-row');
                    if (prevRows.length === 0) {
                        alert('前日の作業データがありません。');
                        return;
                    }
                    
                    const currentRows = taskList.querySelectorAll('.task-row');
                    if (currentRows.length > 0) {
                        const hasInput = Array.from(taskList.querySelectorAll('.task-project, .task-detail'))
                            .some(input => input.value.trim() !== '');
                        if (hasInput && !confirm('前日の内容をコピーしますか？（現在入力されている内容は消去されます）')) {
                            return;
                        }
                    }
                    
                    taskList.clearAll();
                    prevRows.forEach(row => {
                        const proj = row.querySelector('.task-project').value;
                        const detail = row.querySelector('.task-detail').value;
                        const hours = row.querySelector('.task-hours').value;
                        const timeline = row.querySelector('.task-timeline-data').value;
                        taskList.addTaskRow(proj, detail, hours, timeline);
                    });
                });
            }
            
            const calculateTotal = () => {
                let total = 0;
                taskList.querySelectorAll('.task-hours').forEach(sel => {
                    const val = parseFloat(sel.value);
                    if (!isNaN(val)) total += val;
                });
                dayCard.querySelector('.total-hours').textContent = `計 ${total.toFixed(1)}H`;
                calculateWeekTotal();
            };

            const addTaskRow = (projVal = '', detailVal = '', hoursVal = '', timelineVal = '') => {
                const clone = taskRowTemplate.content.cloneNode(true);
                const row = clone.querySelector('.task-row');
                
                const projInput = row.querySelector('.task-project');
                const detailInput = row.querySelector('.task-detail');
                const hoursInput = row.querySelector('.task-hours');
                const timelineInput = row.querySelector('.task-timeline-data');
                const hoursTotalSpan = row.querySelector('.timeline-hours-total');
                
                if (projVal) projInput.value = projVal;
                if (detailVal) detailInput.value = detailVal;
                
                let stateArray = Array(48).fill(0); // 0:なし, 1:作業, 2:休憩
                if (timelineVal && timelineVal.length === 48) {
                    stateArray = timelineVal.split('').map(Number);
                } else if (hoursVal) {
                    const hours = parseFloat(hoursVal);
                    if (!isNaN(hours)) {
                        const slotCount = Math.round(hours * 2);
                        const startSlot = 16; // 8:00
                        for (let i = 0; i < slotCount; i++) {
                            if (startSlot + i < 48) {
                                stateArray[startSlot + i] = 1;
                            }
                        }
                    }
                }
                
                const headerContainer = row.querySelector('.timeline-hours-header');
                for (let h = 0; h < 24; h++) {
                    const lbl = document.createElement('div');
                    lbl.className = 'timeline-hour-label';
                    lbl.textContent = h;
                    headerContainer.appendChild(lbl);
                }
                
                const cellsGrid = row.querySelector('.timeline-cells-grid');
                const cellElements = [];
                for (let i = 0; i < 48; i++) {
                    const cell = document.createElement('div');
                    cell.className = 'timeline-cell';
                    cell.dataset.index = i;
                    cell.dataset.state = stateArray[i];
                    
                    const hour = Math.floor(i / 2);
                    const min = (i % 2 === 0) ? '00' : '30';
                    const nextHour = Math.floor((i + 1) / 2);
                    const nextMin = ((i + 1) % 2 === 0) ? '00' : '30';
                    cell.title = `${String(hour).padStart(2, '0')}:${min}〜${String(nextHour).padStart(2, '0')}:${nextMin}`;
                    
                    cellsGrid.appendChild(cell);
                    cellElements.push(cell);
                }
                
                let currentMode = 1;
                const paletteBtns = row.querySelectorAll('.palette-btn');
                paletteBtns.forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        paletteBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        currentMode = parseInt(btn.dataset.mode);
                    });
                });
                
                let isDrawing = false;
                
                const updateCellState = (index) => {
                    if (index < 0 || index >= 48) return;
                    stateArray[index] = currentMode;
                    cellElements[index].dataset.state = currentMode;
                    
                    const workCount = stateArray.filter(s => s === 1).length;
                    const totalHours = workCount * 0.5;
                    hoursTotalSpan.textContent = totalHours.toFixed(1);
                    hoursInput.value = totalHours.toFixed(1);
                    timelineInput.value = stateArray.join('');
                    
                    calculateTotal();
                };

                cellsGrid.addEventListener('mousedown', (e) => {
                    const cell = e.target.closest('.timeline-cell');
                    if (cell) {
                        isDrawing = true;
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                });
                
                cellsGrid.addEventListener('mousemove', (e) => {
                    if (!isDrawing) return;
                    const cell = e.target.closest('.timeline-cell');
                    if (cell) {
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                });
                
                const stopDrawing = () => { isDrawing = false; };
                window.addEventListener('mouseup', stopDrawing);
                
                cellsGrid.addEventListener('touchstart', (e) => {
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const cell = target ? target.closest('.timeline-cell') : null;
                    if (cell && cell.parentNode === cellsGrid) {
                        isDrawing = true;
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                        e.preventDefault();
                    }
                }, { passive: false });
                
                cellsGrid.addEventListener('touchmove', (e) => {
                    if (!isDrawing) return;
                    const touch = e.touches[0];
                    const target = document.elementFromPoint(touch.clientX, touch.clientY);
                    const cell = target ? target.closest('.timeline-cell') : null;
                    if (cell && cell.parentNode === cellsGrid) {
                        const idx = parseInt(cell.dataset.index);
                        updateCellState(idx);
                    }
                    e.preventDefault();
                }, { passive: false });
                
                cellsGrid.addEventListener('touchend', stopDrawing);
                
                const initialWorkCount = stateArray.filter(s => s === 1).length;
                const initialHours = initialWorkCount * 0.5;
                hoursTotalSpan.textContent = initialHours.toFixed(1);
                hoursInput.value = initialHours.toFixed(1);
                timelineInput.value = stateArray.join('');
                
                // 有給・欠勤・休日時の入力制御ロジック
                const checkProjectStatus = () => {
                    const val = projInput.value.trim();
                    const isLeave = ['有給', '欠勤', '休日'].includes(val);
                    
                    if (isLeave) {
                        row.classList.add('leave-row');
                        detailInput.value = '';
                        detailInput.disabled = true;
                        detailInput.removeAttribute('required');
                        
                        const timelineScroll = row.querySelector('.timeline-container-scroll');
                        const timelinePalette = row.querySelector('.timeline-palette');
                        if (timelineScroll) {
                            timelineScroll.style.pointerEvents = 'none';
                            timelineScroll.style.opacity = '0.5';
                        }
                        if (timelinePalette) {
                            timelinePalette.style.pointerEvents = 'none';
                            timelinePalette.style.opacity = '0.5';
                        }
                        
                        stateArray.fill(0);
                        cellElements.forEach(cell => cell.dataset.state = 0);
                        hoursTotalSpan.textContent = '0.0';
                        hoursInput.value = '0.0';
                        timelineInput.value = stateArray.join('');
                    } else {
                        row.classList.remove('leave-row');
                        if (detailInput.disabled) {
                            detailInput.value = '';
                            detailInput.disabled = false;
                            detailInput.setAttribute('required', 'required');
                        }
                        const timelineScroll = row.querySelector('.timeline-container-scroll');
                        const timelinePalette = row.querySelector('.timeline-palette');
                        if (timelineScroll) {
                            timelineScroll.style.pointerEvents = 'auto';
                            timelineScroll.style.opacity = '1';
                        }
                        if (timelinePalette) {
                            timelinePalette.style.pointerEvents = 'auto';
                            timelinePalette.style.opacity = '1';
                        }
                    }
                    calculateTotal();
                };
                
                projInput.addEventListener('input', checkProjectStatus);
                projInput.addEventListener('change', checkProjectStatus);
                
                if (projVal) {
                    checkProjectStatus();
                }

                row.querySelector('.remove-task-btn').addEventListener('click', () => {
                    window.removeEventListener('mouseup', stopDrawing);
                    row.remove();
                    calculateTotal();
                });
                
                taskList.appendChild(row);
                calculateTotal();
            };

            taskList.addTaskRow = addTaskRow;
            taskList.clearAll = () => {
                taskList.innerHTML = '';
                calculateTotal();
            };

            dayCard.querySelector('.btn-add-task').addEventListener('click', () => addTaskRow());
        });
    }

    // 過去日報コピー処理の実装
    const btnCopy = document.getElementById('btn-copy-past-report');
    const copySelect = document.getElementById('copy-past-report-select');
    if (btnCopy && copySelect) {
        btnCopy.addEventListener('click', () => {
            const selectedIdx = copySelect.value;
            if (selectedIdx === '') {
                alert('コピー元の日報を選択してください。');
                return;
            }
            const myReports = JSON.parse(copySelect.dataset.reportsJson || '[]');
            const sourceReport = myReports[selectedIdx];
            if (!sourceReport || !sourceReport.dailyLogs) {
                alert('日報データの読み込みに失敗しました。');
                return;
            }

            if (!confirm('現在入力中の内容をクリアして、選択した過去の日報をコピーしますか？')) {
                return;
            }

            // コピー実行
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (taskList && taskList.clearAll && taskList.addTaskRow) {
                    taskList.clearAll();
                    const tasks = sourceReport.dailyLogs[day] || [];
                    tasks.forEach(t => {
                        taskList.addTaskRow(t.project, t.detail, t.hours, t.timeline || '');
                    });
                    const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                    if (reportText) {
                        reportText.value = (sourceReport.dailyReports && sourceReport.dailyReports[day]) ? sourceReport.dailyReports[day] : '';
                    }
                }
            });

            calculateWeekTotal();
            alert('コピーが完了しました！必要に応じて編集してください。');
        });
    }

    // 予定(Schedule)保存 - Firebase Firestore
    const schedForm = document.getElementById('schedule-form');
    if (schedForm) {
        schedForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const schedId = document.getElementById('sched-id').value;

            const startVal = document.getElementById('sched-start').value;
            const endVal = document.getElementById('sched-end').value;

            if (startVal && endVal && startVal > endVal) {
                alert('納期 (製作完了日) は製作開始日より後の日付にしてください。');
                return;
            }

            const schedData = {
                companyId,
                project: document.getElementById('sched-project').value.trim(),
                author: document.getElementById('sched-author').value.trim(),
                start: document.getElementById('sched-start').value,
                end: document.getElementById('sched-end').value,
                notes: document.getElementById('sched-notes').value.trim(),
                client: document.getElementById('sched-client').value.trim(),
                address: document.getElementById('sched-address').value.trim(),
                supplier1: document.getElementById('sched-supplier1').value.trim(),
                supplier2: document.getElementById('sched-supplier2').value.trim(),
                supplier3: document.getElementById('sched-supplier3').value.trim(),
                subcontractor: document.getElementById('sched-subcontractor').value.trim(),
                memoQty: document.getElementById('sched-memo-qty').value.trim(),
                salesRep: document.getElementById('sched-sales-rep').value,
                constRep: document.getElementById('sched-const-rep').value,
                siteRep: document.getElementById('sched-site-rep').value,
                chiefTech: document.getElementById('sched-chief-tech').value,
                assignType: "none",
                barColor: getBarColorForSiteRep(document.getElementById('sched-site-rep').value),
                barPattern: document.getElementById('sched-bar-pattern').value,
                completed: document.getElementById('sched-completed').checked,
                timestamp: new Date().toISOString()
            };
            try {
                if (schedId) {
                    await updateDoc(doc(db, "schedules", schedId), schedData);
                    alert('工事情報を更新しました！');
                } else {
                    await addDoc(collection(db, "schedules"), schedData);
                    alert('工事情報を登録しました！');
                }
                const msg = document.getElementById('sched-submit-message');
                msg.textContent = schedId ? '変更を保存しました！' : '予定を保存しました！';
                msg.classList.remove('hidden');
                
                // 編集モードを解除
                resetScheduleEditMode();
                
                // ガントチャートを再読み込み
                await loadSchedules();
                
                setTimeout(() => msg.classList.add('hidden'), 3000);
            } catch (error) {
                console.error("Error saving document: ", error);
                alert('保存に失敗しました。接続設定を確認してください。');
            }
        });
    }

    const schedCancelBtn = document.getElementById('sched-cancel-btn');
    if (schedCancelBtn) {
        schedCancelBtn.addEventListener('click', () => {
            resetScheduleEditMode();
        });
    }

    // 日報(Report)保存 - Firebase Firestore
    const reportForm = document.getElementById('report-form');

    const saveReport = async (status) => {
        if (reportForm && !reportForm.checkValidity()) {
            reportForm.reportValidity();
            return;
        }

        // 工事名が「有給」「欠勤」「休日」以外のとき、作業時間が 0H のままであればエラーにする
        let hasZeroHoursError = false;
        let errorDay = '';
        let errorProject = '';

        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (!taskList) return;
            const rows = taskList.querySelectorAll('.task-row');
            rows.forEach(row => {
                const project = row.querySelector('.task-project').value.trim();
                const hoursVal = row.querySelector('.task-hours').value;
                const hours = parseFloat(hoursVal || 0);
                
                // 工事名が入力されており、かつ「有給」「欠勤」「休日」でない場合
                if (project && !['有給', '欠勤', '休日'].includes(project)) {
                    if (hours <= 0) {
                        hasZeroHoursError = true;
                        errorDay = day;
                        errorProject = project;
                    }
                }
            });
        });

        if (hasZeroHoursError) {
            alert(`【${errorDay}曜日】の「${errorProject}」の作業時間が 0 時間になっています。\nタイムラインをドラッグして作業時間（黒いバー）を入力してください。`);
            return;
        }

        const dailyLogs = {};
        daysName.forEach(day => {
            const rows = document.querySelector(`.task-list[data-day="${day}"]`).querySelectorAll('.task-row');
            const tasks = [];
            rows.forEach(row => {
                const project = row.querySelector('.task-project').value.trim();
                const detail = row.querySelector('.task-detail').value.trim();
                const hours = row.querySelector('.task-hours').value;
                const timeline = row.querySelector('.task-timeline-data').value;
                // 工事名(project)が入力されているタスク行のみを有効なデータとして保存する
                if (project) {
                    tasks.push({ project, detail, hours, timeline });
                }
            });
            dailyLogs[day] = tasks;
        });

        const dailyReports = {};
        daysName.forEach(day => {
            const textVal = document.querySelector(`.task-list[data-day="${day}"]`)
                .closest('.day-card')
                .querySelector('.day-report-text').value.trim();
            dailyReports[day] = textVal;
        });

        const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
        const reportData = {
            companyId,
            week: document.getElementById('week').value,
            author: document.getElementById('author').value,
            dailyLogs,
            dailyReports,
            status,
            timestamp: new Date().toISOString()
        };

        const selectedWeek = reportData.week;
        const currentAuthor = reportData.author;
        const existingReport = allReports.find(r => r.week === selectedWeek && r.author === currentAuthor);

        if (status === 'approved') {
            reportData.approvedAt = new Date().toISOString();
            reportData.approvedBy = currentUser.displayName || currentUser.email.split('@')[0];
        } else {
            reportData.approvedAt = null;
            reportData.approvedBy = null;
        }

        try {
            if (existingReport) {
                await updateDoc(doc(db, "reports", existingReport.id), reportData);
            } else {
                await addDoc(collection(db, "reports"), reportData);
            }
            if (status === 'approved') {
                alert('上長承認を登録しました！');
            } else if (status === 'confirmed') {
                alert('実績を確定登録しました！');
            } else {
                alert('予定を一時保存しました！');
            }
            await loadReports(false);
        } catch (error) {
            console.error("Error saving document: ", error);
            alert('保存に失敗しました。');
        }
    };

    if (reportForm) {
        reportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            await saveReport('confirmed');
        });
    }

    // データ読み込み（ガントチャート）
    const ganttYearSelect = document.getElementById('gantt-year');

    window.loadSchedules = async () => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "schedules"), where("companyId", "==", cid));
            const querySnapshot = await getDocs(q);
            allSchedules = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            renderGanttChart();
            updateProjectSuggestions();
        } catch (e) {
            console.error("Error loading schedules: ", e);
        }
    };

    const renderGanttChart = () => {
        const container = document.getElementById('gantt-container');
        if (!container || !ganttYearSelect) return;

        const selectedYear = parseInt(ganttYearSelect.value, 10);
        if (isNaN(selectedYear)) return;

        // 年度期間: 4月1日〜翌年3月31日
        const startStr = `${selectedYear}-04-01`;
        const endStr = `${selectedYear + 1}-03-31`;

        // 4/1から3/31までの日付リストを生成
        const dateList = [];
        const current = new Date(selectedYear, 3, 1); // 4月1日
        const end = new Date(selectedYear + 1, 2, 31); // 3月31日
        while (current <= end) {
            dateList.push(new Date(current));
            current.setDate(current.getDate() + 1);
        }

        // 年度と重なるスケジュールを抽出
        const targetSchedules = allSchedules.filter(s => s.start <= endStr && s.end >= startStr);
        // 表示順は開始日の早い順、その次は工事名順とする
        targetSchedules.sort((a, b) => (a.start || '') > (b.start || '') ? 1 : ((a.start || '') < (b.start || '') ? -1 : ((a.project || '') > (b.project || '') ? 1 : -1)));

        // 画面表示用に幅を設定し、PCでは画面幅に収め、スマホでは詳細幅があるため自動的にスクロール可能にします。
        container.style.width = '100%';
        container.style.minWidth = '100%';
        container.style.overflow = 'hidden';

        const wrapper = container.closest('.gantt-wrapper');
        if (wrapper) {
            wrapper.style.overflowX = 'auto';
            wrapper.style.width = '100%';
        }

        // 列定義: 左側詳細テーブル（10カラム、合計615pxに縮小） + 右側カレンダー各日(1frで画面幅に収める)
        let html = `<div class="gantt-grid" style="grid-template-columns: 100px 80px 80px 70px 45px 45px 45px 45px 60px 45px repeat(${dateList.length}, 1fr); width: 100%;">`;

        // ==========================================
        // 行1: ヘッダー (左側：10個の詳細カラムヘッダー、右側：各月)
        // ==========================================
        // 左側のテーブル情報ヘッダーエリア（縦割り、sticky固定、並び替え版）
        html += `
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 1; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 0px; z-index: 25;">工事名</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 2; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 100px; z-index: 25;">元請</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 3; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 180px; z-index: 25;">住所</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 4; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 260px; z-index: 25;">仕入</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 5; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 330px; z-index: 25;">数量</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 6; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 375px; z-index: 25;">営業</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 7; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 420px; z-index: 25;">技術者</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 8; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 465px; z-index: 25;">工務</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 9; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 510px; z-index: 25;">補助</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 10; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; border-right: 2px solid var(--border) !important; position: sticky; left: 570px; z-index: 25;">現場</div>
        `;

        // カレンダー部 月ヘッダー (左側10列の次なので 11列目から開始)
        let startCol = 11;
        dateList.forEach((d, idx) => {
            const m = d.getMonth() + 1;
            const nextDate = dateList[idx + 1];
            const isLastDayOfMonth = !nextDate || nextDate.getMonth() !== d.getMonth();

            if (isLastDayOfMonth) {
                const endCol = idx + 12;
                const boundaryClass = !nextDate ? '' : 'month-boundary';
                html += `<div class="gantt-cell gantt-header-cell ${boundaryClass}" style="grid-row: 1; grid-column: ${startCol} / ${endCol}; font-weight: bold; font-size: 0.85rem; height: 35px; border-bottom: 2px solid #cbd5e1;">${m}月</div>`;
                startCol = endCol;
            }
        });

        // ==========================================
        // データ行レンダリング
        // ==========================================
        targetSchedules.forEach((s, index) => {
            const rowIndex = index + 2; // ヘッダーが1行だけなので2行目から

            // 左側テーブルセル
            const completedBadge = s.completed ? '<span class="proj-card-completed-badge" style="background: #dcfce7; color: #15803d; padding: 1px 4px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; margin-right: 5px; flex-shrink: 0;">完了</span>' : '';
            
            // 企業管理者のみ「編集」ボタンを表示
            const editBtnHtml = (currentCompany && currentCompany.role === 'admin') ?
                `<button class="btn btn-secondary btn-small btn-edit-schedule-v4" data-id="${s.id}" style="padding: 2px 6px; font-size: 0.72rem; line-height: 1; height: 18px; margin: 0; white-space: nowrap; background-color: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; flex-shrink: 0;">編集</button>` : '';

            // 10個の縦割りカラム (sticky固定 & 背景色指定、並び替え・仕入れ複数行対応)
            const supplierParts = [s.supplier1, s.supplier2, s.supplier3].filter(Boolean);
            const supplierHtml = supplierParts.length > 0 
                ? supplierParts.map(sup => `<div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; width: 100%; line-height: 1.2;">${sup}</div>`).join('')
                : '-';
            const supplierTitle = supplierParts.length > 0 ? `仕入: ${supplierParts.join(', ')}` : '仕入: -';
            html += `
                <!-- 1. 工事名 -->
                <div class="gantt-cell gantt-proj-cell" style="grid-row: ${rowIndex}; grid-column: 1; text-align: left; justify-content: space-between; padding: 6px 2px; font-size: 0.74rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 0px; z-index: 15; background: var(--card-bg);" title="${s.project || ''}">
                    <div style="display:flex; align-items:center; overflow:hidden; flex:1; text-align: left; margin-right: 1px;">
                        ${completedBadge}
                        <span class="proj-card-project" style="font-weight: bold; color: var(--text-main); font-size: 0.74rem; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.project || ''}</span>
                    </div>
                    ${editBtnHtml}
                </div>
                <!-- 2. 元請 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 2; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary); font-weight: bold; border-bottom: 1px solid var(--border); position: sticky; left: 100px; z-index: 15; background: var(--card-bg);" title="${s.client || ''}">
                    ${s.client || '-'}
                </div>
                <!-- 3. 住所 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 3; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; white-space: normal; word-break: break-all; border-bottom: 1px solid var(--border); position: sticky; left: 180px; z-index: 15; background: var(--card-bg);" title="住所: ${s.address || '-'}">
                    ${s.address || '-'}
                </div>
                <!-- 4. 仕入 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 4; text-align: left; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; padding: 4px 2px; font-size: 0.7rem; border-bottom: 1px solid var(--border); position: sticky; left: 260px; z-index: 15; background: var(--card-bg);" title="${supplierTitle}">
                    ${supplierHtml}
                </div>
                <!-- 5. 数量 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 5; text-align: right; justify-content: flex-end; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 330px; z-index: 15; background: var(--card-bg);" title="数量: ${s.memoQty || '-'}">
                    ${s.memoQty || '-'}
                </div>
                <!-- 6. 営業 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 6; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 375px; z-index: 15; background: var(--card-bg);" title="${s.salesRep || ''}">
                    ${s.salesRep || '-'}
                </div>
                <!-- 7. 技術者 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 7; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 420px; z-index: 15; background: var(--card-bg);" title="${s.chiefTech || ''}">
                    ${s.chiefTech || '-'}
                </div>
                <!-- 8. 工務 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 8; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 465px; z-index: 15; background: var(--card-bg);" title="${s.constRep || ''}">
                    ${s.constRep || '-'}
                </div>
                <!-- 9. 補助 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 9; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); position: sticky; left: 510px; z-index: 15; background: var(--card-bg);" title="補助: ${s.subcontractor || '-'}">
                    ${s.subcontractor || '-'}
                </div>
                <!-- 10. 現場 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 10; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); border-right: 2px solid var(--border) !important; position: sticky; left: 570px; z-index: 15; background: var(--card-bg);" title="${s.siteRep || ''}">
                    ${s.siteRep || '-'}
                </div>
            `;
            // カレンダー部分の背景セル (罫線用)
            dateList.forEach((d, idx) => {
                const day = d.getDay();
                const isSat = day === 6 ? 'weekend-sat' : '';
                const isSun = day === 0 ? 'weekend-sun' : '';

                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();
                const boundaryClass = isLastDay ? 'month-boundary' : '';

                html += `<div class="gantt-bar-bg-cell ${isSat} ${isSun} ${boundaryClass}" style="grid-row: ${rowIndex}; grid-column: ${idx + 11};"></div>`;
            });

            // 工程バーの計算
            const startLimit = new Date(startStr);
            const endLimit = new Date(endStr);
            const sStart = new Date(s.start);
            const sEnd = new Date(s.end);

            // 表示期間内に収めるようにクリップ
            const drawStart = sStart < startLimit ? startLimit : sStart;
            const drawEnd = sEnd > endLimit ? endLimit : sEnd;

            const drawStartStr = drawStart.toISOString().split('T')[0];
            const drawEndStr = drawEnd.toISOString().split('T')[0];

            const startIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawStartStr);
            const endIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawEndStr);

            if (startIdx !== -1 && endIdx !== -1) {
                const gridStart = startIdx + 11;
                const gridEnd = endIdx + 12;

                const color = getBarColorForSiteRep(s.siteRep);
                const patternClass = s.barPattern === 'stripe' ? 'pattern-stripe' : '';
                const completedClass = s.completed ? 'completed-bar' : '';

                const barText = `${s.completed ? ' [完了] ' : ''}${s.project}${s.notes ? ` (${s.notes})` : ''}`;

                html += `<div class="gantt-bar ${patternClass} ${completedClass}" data-id="${s.id}" style="grid-row: ${rowIndex}; grid-column: ${gridStart} / ${gridEnd}; background-color: ${color};" title="【${s.project}】\n期間: ${s.start} 〜 ${s.end}\n備考: ${s.notes || 'なし'}">
                            ${barText}
                         </div>`;
            }
        });

        if (targetSchedules.length === 0) {
            html += `<div style="grid-row: 2; grid-column: 1 / -1; padding: 25px; text-align: center; color: var(--text-muted); font-weight: bold;">選択年度の工程予定は登録されていません。</div>`;
        }

        html += `</div>`;
        container.innerHTML = html;

        // 印刷タイトル更新
        document.getElementById('print-gantt-title').textContent = `${selectedYear}年度 工程管理表`;

        // 工事の脇の「編集」ボタンクリックイベント
        container.querySelectorAll('.btn-edit-schedule-v4[data-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (currentCompany && currentCompany.role === 'admin') {
                    const schedId = btn.dataset.id;
                    const sched = allSchedules.find(s => s.id === schedId);
                    if (sched) {
                        startEditScheduleMode(sched);
                    }
                }
            });
        });
    };

    ganttYearSelect.addEventListener('change', renderGanttChart);

    // 工事名サジェスト（Datalist）の更新
    const updateProjectSuggestions = () => {
        const suggestions = new Set();
        suggestions.add('有給');
        suggestions.add('欠勤');
        suggestions.add('休日');
        allSchedules.forEach(s => { if (s.project) suggestions.add(s.project); });
        allReports.forEach(r => {
            if (r.dailyLogs) {
                Object.values(r.dailyLogs).forEach(tasks => {
                    if (Array.isArray(tasks)) {
                        tasks.forEach(t => { if (t.project) suggestions.add(t.project); });
                    }
                });
            }
        });
        const datalist = document.getElementById('project-suggestions');
        if (datalist) {
            datalist.innerHTML = Array.from(suggestions)
                .sort()
                .map(p => `<option value="${p}">`)
                .join('');
        }
    };

    // コピー選択肢の更新
    const updateCopySelect = () => {
        const select = document.getElementById('copy-past-report-select');
        if (!select || !currentUser) return;
        
        // displayName優先、なければメールのID部分で比較
        const myName = currentUser.displayName || currentUser.email.split('@')[0];
        // 確定済み(confirmed)またはステータス未定義の過去データのみをコピー対象とする
        const myReports = allReports.filter(r => r.author === myName && (r.status === undefined || r.status === 'confirmed'));
        myReports.sort((a, b) => (a.week < b.week ? 1 : -1)); // 降順
        
        select.innerHTML = '<option value="">過去の日報からコピーして作成...</option>';
        myReports.forEach((r, idx) => {
            select.innerHTML += `<option value="${idx}">${r.week} (${formatWeekRange(r.week)})</option>`;
        });
        select.dataset.reportsJson = JSON.stringify(myReports);
    };

    // データ読み込み（日報）
    window.loadReports = async (isSummary = false) => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "reports"), where("companyId", "==", cid));
            const querySnapshot = await getDocs(q);
            allReports = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            updateFilterOptions();
            updateCopySelect();
            updateProjectSuggestions();
            if (isSummary) {
                renderSummaryTable();
            } else {
                renderTable();
                loadReportForSelectedWeek();
            }
        } catch (e) {
            console.error("Error loading reports: ", e);
        }
    };

    // レンダリング処理
    const updateFilterOptions = () => {
        const months = [...new Set(allReports.map(r => getMonthStr(r.week)))].filter(Boolean).sort().reverse();
        const weeks = [...new Set(allReports.map(r => r.week))].filter(Boolean).sort().reverse();
        const authors = [...new Set(allReports.map(r => r.author))].filter(Boolean).sort();

        const filterMonth = document.getElementById('filter-month');
        if (filterMonth) {
            const cur = filterMonth.value;
            filterMonth.innerHTML = '<option value="">すべての月</option>';
            months.forEach(m => filterMonth.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`);
            filterMonth.value = cur;
        }

        const summaryFilterMonth = document.getElementById('summary-filter-month');
        if (summaryFilterMonth) {
            const cur = summaryFilterMonth.value;
            summaryFilterMonth.innerHTML = '<option value="">月を選択してください</option>';
            months.forEach(m => summaryFilterMonth.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`);
            if (cur) {
                summaryFilterMonth.value = cur;
            } else if (months.length > 0) {
                summaryFilterMonth.value = months[0];
            }
        }

        const filterAuthor = document.getElementById('filter-author');
        if (filterAuthor) {
            const cur = filterAuthor.value;
            filterAuthor.innerHTML = '<option value="">すべての担当者</option>';
            authors.forEach(a => filterAuthor.innerHTML += `<option value="${a}">${a}</option>`);
            filterAuthor.value = cur;
        }
    };

    const renderTable = () => {
        const filterMonth = document.getElementById('filter-month').value;
        const filterAuthor = document.getElementById('filter-author').value;
        const tbody = document.getElementById('reports-tbody');
        const printContainer = document.getElementById('print-details-container');
        const personalSummary = document.getElementById('personal-summary-container');

        const filtered = allReports.filter(r => 
            (r.status === undefined || r.status === 'confirmed') &&
            (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
            (filterAuthor === '' || r.author === filterAuthor)
        );
        filtered.sort((a,b) => (a.week < b.week ? 1 : -1)); // 降順
        
        tbody.innerHTML = ''; printContainer.innerHTML = ''; if(personalSummary) personalSummary.innerHTML = '';

        const authorProjectHours = {};

        filtered.forEach(r => {
            // 集計データの蓄積
            if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
            const days = ['月','火','水','木','金','土','日'];
            days.forEach(day => {
                const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                if (ts) ts.forEach(t => {
                    if (t.project && !['有給', '欠勤', '休日'].includes(t.project)) {
                        authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                    }
                });
            });
            const tr = document.createElement('tr');
            const dates = getDaysOfWeek(r.week);
            const getDayLabel = (idx, name) => dates ? `${formatDate(dates[idx])}<br>(${name})` : name;
            const renderCell = (day) => {
                const tasksHtml = (r.dailyLogs && r.dailyLogs[day]) ? r.dailyLogs[day].map(t => `<div class="day-summary-cell"><strong>${t.project}</strong>${t.detail} (${parseFloat(t.hours||0).toFixed(1)}H)</div>`).join('') : '';
                const reportHtml = (r.dailyReports && r.dailyReports[day]) ? `<div class="day-report-summary-cell" style="font-size:0.8rem; color:#0284c7; margin-top:5px; border-top:1px dotted var(--border); padding-top:3px; white-space:pre-wrap; font-style:italic; text-align: left;">📝 ${r.dailyReports[day]}</div>` : '';
                return (tasksHtml || reportHtml) ? (tasksHtml + reportHtml) : '-';
            };

            tr.innerHTML = `
                <td>${formatWeekRange(r.week)}</td>
                <td><strong>${r.author || ''}</strong></td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(0, '月')}</div>${renderCell('月')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(1, '火')}</div>${renderCell('火')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(2, '水')}</div>${renderCell('水')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(3, '木')}</div>${renderCell('木')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(4, '金')}</div>${renderCell('金')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(5, '土')}</div>${renderCell('土')}</td>
                <td><div style="font-size:0.75rem; color:#64748b;">${getDayLabel(6, '日')}</div>${renderCell('日')}</td>
            `;
            tbody.appendChild(tr);

            let printTasksHtml = '';
            daysName.forEach((day, idx) => {
                // ts が undefined になる場合に備えてフォールバック
                const ts = (r.dailyLogs && Array.isArray(r.dailyLogs[day])) ? r.dailyLogs[day] : [];
                const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
                
                if (ts.length > 0) {
                    ts.forEach((t) => {
                        // 行ごとに日付・レポートを繰り返す（rowspanなし・シンプル実装）
                        printTasksHtml += `<tr>
                            <td>${dates ? formatDate(dates[idx]) : ''}(${day})</td>
                            <td>${t.project || ''}</td>
                            <td>${t.detail || ''}</td>
                            <td style="text-align:center;">${parseFloat(t.hours||0).toFixed(1)}H</td>
                            <td style="white-space: pre-wrap; font-size:0.85rem;">${dailyRep}</td>
                        </tr>`;
                    });
                } else if (dailyRep) {
                    // 作業なし・日報のみの日
                    printTasksHtml += `<tr>
                        <td>${dates ? formatDate(dates[idx]) : ''}(${day})</td>
                        <td colspan="3" style="color: #64748b; font-style: italic;">作業記録なし</td>
                        <td style="white-space: pre-wrap; font-size:0.85rem;">${dailyRep}</td>
                    </tr>`;
                }
            });

            printContainer.innerHTML += `
                <div class="print-report-card">
                    <div class="print-report-header">対象期間: ${formatWeekRange(r.week)} ｜ 担当者: ${r.author || ''}</div>
                    <div class="print-report-body">
                        <strong>■ 業務実績（日別詳細）</strong>
                        <table class="print-task-table">
                            <thead><tr><th>日付(曜)</th><th>工事名</th><th>作業内容</th><th>時間</th><th>日次レポート・備考</th></tr></thead>
                            <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b;">記録なし</td></tr>'}</tbody>
                        </table>
                    </div>
                </div>
            `;
        });

        // 下部の個人別集計表を描画
        if (Object.keys(authorProjectHours).length > 0 && personalSummary) {
            let summaryHtml = '<h3 style="padding: 15px; border-bottom: 2px solid var(--border); margin-bottom: 15px;">【月間】個人別 工事稼働時間（集計）</h3><div style="padding: 0 15px 15px 15px; display: flex; gap: 20px; flex-wrap: wrap;">';
            Object.keys(authorProjectHours).sort().forEach(author => {
                summaryHtml += `<div style="flex: 1; min-width: 300px; background: #fff; padding: 15px; border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <h4 style="margin-bottom: 15px; color: var(--primary); font-size: 1.1rem;">${author} さん</h4>
                    <table style="width: 100%; font-size: 0.95rem; border-collapse: collapse;">
                        <thead><tr style="background:#f1f5f9; border-bottom: 2px solid var(--border);"><th style="padding: 8px; text-align: left;">工事名</th><th style="padding: 8px; text-align: right;">時間(H)</th></tr></thead>
                        <tbody>`;
                let total = 0;
                Object.keys(authorProjectHours[author]).sort().forEach(proj => {
                    const hrs = authorProjectHours[author][proj];
                    total += hrs;
                    summaryHtml += `<tr style="border-bottom: 1px solid var(--border);"><td style="padding: 8px;">${proj}</td><td style="padding: 8px; text-align: right; font-weight: bold;">${hrs.toFixed(1)}</td></tr>`;
                });
                summaryHtml += `<tr style="background: #f8fafc; font-weight: bold;"><td style="padding: 10px;">合計</td><td style="padding: 10px; text-align: right; color: var(--primary); font-size: 1.1rem;">${total.toFixed(1)}</td></tr>`;
                summaryHtml += `</tbody></table></div>`;
            });
            summaryHtml += '</div>';
            personalSummary.innerHTML = summaryHtml;
        }
    };

    const renderSummaryTable = () => {
        const filterMonth = document.getElementById('summary-filter-month').value;
        const thead = document.getElementById('summary-thead');
        const tbody = document.getElementById('summary-tbody');
        const printTitle = document.getElementById('print-summary-title');
        
        if (!thead || !tbody) return;
        
        if (!filterMonth) {
            thead.innerHTML = '';
            tbody.innerHTML = '<tr><td style="padding: 20px; text-align: center; color: #64748b;">対象月を選択してください。</td></tr>';
            return;
        }

        const [year, month] = filterMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();
        
        if (printTitle) {
            printTitle.textContent = `${year}年${month}月 工事別作業時間集計`;
        }

        // 1. カレンダーヘッダーの生成
        let headHtml = `<tr>
            <th style="min-width: 150px; background: #f1f5f9; position: sticky; left: 0; z-index: 10;">工事名</th>
            <th style="min-width: 100px; background: #f1f5f9; position: sticky; left: 150px; z-index: 10;">担当者</th>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeekStr = ['日','月','火','水','木','金','土'][dateObj.getDay()];
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 'color:red;' : '';
            headHtml += `<th style="min-width: 35px; text-align: center; font-size: 0.8rem; ${isWeekend}">${d}<br>${dayOfWeekStr}</th>`;
        }
        headHtml += `<th style="min-width: 80px; text-align: right; background: #f1f5f9;">合計</th></tr>`;
        thead.innerHTML = headHtml;

        // 2. データ集計
        const projectMap = {};
        
        allReports.forEach(r => {
            // 実績確定済み(confirmed)またはステータス未定義の過去データのみを集計対象とする
            if (r.status !== undefined && r.status !== 'confirmed') return;
            const days = ['月','火','水','木','金','土','日'];
            const dates = getDaysOfWeek(r.week);
            if (!dates) return;
            
            days.forEach((day, idx) => {
                const dateObj = dates[idx];
                const dYear = dateObj.getFullYear();
                const dMonth = dateObj.getMonth() + 1;
                const dDay = dateObj.getDate();
                
                // 選択された月と一致するかチェック
                if (dYear === year && dMonth === month) {
                    const ts = r.dailyLogs ? r.dailyLogs[day] : [];
                    if (ts) ts.forEach(t => {
                        if (!t.project || !t.hours) return;
                        const proj = t.project;
                        if (['有給', '欠勤', '休日'].includes(proj)) return;
                        const auth = r.author || '不明';
                        const hrs = parseFloat(t.hours || 0);
                        
                        if (!projectMap[proj]) projectMap[proj] = {};
                        if (!projectMap[proj][auth]) {
                            projectMap[proj][auth] = {
                                days: {},
                                total: 0
                            };
                        }
                        
                        projectMap[proj][auth].days[dDay] = (projectMap[proj][auth].days[dDay] || 0) + hrs;
                        projectMap[proj][auth].total += hrs;
                    });
                }
            });
        });

        // 3. テーブル行の生成
        let bodyHtml = '';
        const sortedProjects = Object.keys(projectMap).sort();
        
        if (sortedProjects.length === 0) {
            bodyHtml = `<tr><td colspan="${daysInMonth + 3}" style="padding: 20px; text-align: center; color: #64748b;">該当する作業記録がありません。</td></tr>`;
            tbody.innerHTML = bodyHtml;
            return;
        }

        sortedProjects.forEach(proj => {
            const authors = Object.keys(projectMap[proj]).sort();
            authors.forEach((auth) => {
                const data = projectMap[proj][auth];
                bodyHtml += `<tr>`;
                
                bodyHtml += `<td style="font-weight: bold; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 1px solid var(--border);">${proj}</td>`;
                bodyHtml += `<td style="background: #fff; position: sticky; left: 150px; z-index: 5; border-right: 1px solid var(--border);">${auth}</td>`;
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const hrs = data.days[d];
                    const displayHrs = hrs ? hrs.toFixed(1) : '';
                    const style = hrs ? 'background-color: #f0fdf4; font-weight: bold; text-align: center;' : 'text-align: center; color: #cbd5e1;';
                    bodyHtml += `<td style="${style}">${hrs ? displayHrs : '-'}</td>`;
                }
                
                bodyHtml += `<td style="text-align: right; font-weight: bold; color: var(--primary); background: #f8fafc;">${data.total.toFixed(1)}H</td>`;
                bodyHtml += `</tr>`;
            });
        });
        
        tbody.innerHTML = bodyHtml;
    };

    ['filter-month', 'filter-author'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTable);
    });
    const summaryFilterMonth = document.getElementById('summary-filter-month');
    if(summaryFilterMonth) summaryFilterMonth.addEventListener('change', renderSummaryTable);

    // 印刷ボタン処理（#print-active-areaを一時的に作成または再利用して印刷）
    const doPrint = (contentSourceId, titleText, isLandscape = false) => {
        // 既存の動的スタイルを削除
        const existingStyle = document.getElementById('print-dynamic-style');
        if (existingStyle) existingStyle.remove();

        // 印刷コンテンツを取得
        const sourceEl = document.getElementById(contentSourceId);
        if (!sourceEl) { window.print(); return; }

        // 横向き印刷用の@pageスタイルを動的に追加
        const style = document.createElement('style');
        style.id = 'print-dynamic-style';
        if (isLandscape) {
            style.innerHTML = '@media print { @page { size: A3 landscape !important; margin: 10mm !important; } }';
        } else {
            style.innerHTML = '@media print { @page { size: A4 portrait !important; margin: 10mm !important; } }';
        }
        document.head.appendChild(style);

        // #print-active-areaを取得、存在しなければ作成してbodyに追加
        // （印刷プレビュー生成中のDOM削除バグによるフリーズや白紙を防ぐため、JSでの削除は行わず常駐させ、通常時はCSSで非表示にする）
        let printArea = document.getElementById('print-active-area');
        if (!printArea) {
            printArea = document.createElement('div');
            printArea.id = 'print-active-area';
            document.body.appendChild(printArea);
        }
        // 中身を初期化
        printArea.innerHTML = '';
        printArea.style.cssText = 'background:white; padding:15px; width: 100%;';

        // タイトルを追加
        if (titleText) {
            const titleEl = document.createElement('h2');
            titleEl.className = 'print-gantt-title';
            titleEl.textContent = titleText;
            printArea.appendChild(titleEl);
        }

        // コンテンツをコピー
        const clone = sourceEl.cloneNode(true);
        clone.style.display = 'block';
        
        // 横向きの場合、テーブルがはみ出ないように幅やフォントサイズを調整し、stickyを解除
        if (isLandscape) {
            clone.style.width = 'max-content'; // 横長グリッドが潰れないようにmax-contentにする
            
            // 子要素の gantt-grid のインラインスタイル width: 100% を max-content に上書きして、
            // 365日分のGridセルが極限まで押し潰されてブラウザが無限計算ループ（フリーズ）するのを防ぐ
            // さらに、grid-template-columns の 1fr を固定幅（24px）に書き換えて、無限ループ計算を完全に回避する
            const gridEl = clone.querySelector('.gantt-grid');
            if (gridEl) {
                gridEl.style.width = 'max-content';
                const origCols = gridEl.style.gridTemplateColumns;
                if (origCols) {
                    gridEl.style.gridTemplateColumns = origCols.replace(/1fr/g, '3px');
                }
            }
            
            clone.style.fontSize = '8pt';
            // sticky固定が印刷時に崩れる原因となるため、全セルのpositionをstaticに戻す
            clone.querySelectorAll('th, td, .gantt-cell').forEach(el => {
                el.style.position = 'static';
                el.style.zIndex = 'auto';
            });
        }
        
        printArea.appendChild(clone);

        // レイアウトの計算を強制的に即時実行させる (Force Reflow)
        const forceReflow = printArea.offsetHeight;

        // スタイル適用とレンダリングのための十分なウェイトを挟んでから印刷を実行
        // 巨大なDOMの描画を確実に完了させて白紙プレビューを防ぐため、遅延を 800ms に設定
        setTimeout(() => {
            window.print();
            // 印刷プレビュー表示後のsetTimeout削除処理は廃止（CSSで通常時は非表示にされるため安全）
        }, 800);
    };

    // A4縦印刷（個人別一覧・レポート）
    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) {
        btnPrint.addEventListener('click', () => {
            doPrint('print-details-container', '週次完了レポート（個人別）', false);
        });
    }
    // A3横印刷（工事別集計）
    const btnPrintSummary = document.getElementById('btn-print-summary');
    if (btnPrintSummary) {
        btnPrintSummary.addEventListener('click', () => {
            const filterMonth = document.getElementById('summary-filter-month').value;
            const [year, month] = filterMonth ? filterMonth.split('-') : ['', ''];
            const titleText = year ? `${year}年${month}月 工事別作業時間集計` : '工事別作業時間集計';
            doPrint('summary-table', titleText, true);
        });
    }
    // A3横印刷（ガントチャート）
    const btnPrintGantt = document.getElementById('btn-print-gantt');
    if (btnPrintGantt) {
        btnPrintGantt.addEventListener('click', () => {
            doPrint('gantt-container', document.getElementById('print-gantt-title')?.textContent || '月間作業予定表', true);
        });
    }

    // 週間行動予定表（A4縦）の印刷処理
    const printWeeklyReport = () => {
        try {
            const weekInput = document.getElementById('week');
            const authorInput = document.getElementById('author');
            if (!weekInput || !authorInput) return;
            
            const weekVal = weekInput.value;
            const weekText = weekInput.options[weekInput.selectedIndex]?.text || '';
            const authorVal = authorInput.value;
            
            const badge = document.getElementById('report-status-badge');
            const isApproved = badge && badge.classList.contains('status-approved');
            
            const existingReport = allReports.find(r => r.week === weekVal && r.author === authorVal);
            let approvedDateStr = '';
            if (isApproved && existingReport && existingReport.approvedAt) {
                const appDate = new Date(existingReport.approvedAt);
                approvedDateStr = (appDate.getMonth() + 1) + '/' + appDate.getDate();
            } else if (isApproved) {
                const now = new Date();
                approvedDateStr = (now.getMonth() + 1) + '/' + now.getDate();
            }
            
            // 画面の入力内容を収集
            const daysData = {};
            daysName.forEach(day => {
                const dayCard = document.querySelector('.task-list[data-day="' + day + '"]').closest('.day-card');
                const rows = dayCard.querySelectorAll('.task-row');
                const tasks = [];
                rows.forEach(row => {
                    const project = row.querySelector('.task-project').value.trim();
                    const detail = row.querySelector('.task-detail').value.trim();
                    const hours = parseFloat(row.querySelector('.task-hours').value || 0);
                    const timeline = row.querySelector('.task-timeline-data').value;
                    if (project || detail || hours || timeline) {
                        tasks.push({ project, detail, hours, timeline });
                    }
                });
                const reportText = dayCard.querySelector('.day-report-text').value.trim();
                daysData[day] = { tasks, reportText };
            });
            
            const dates = getDaysOfWeek(weekVal);
            const formatPrintDate = (dateObj, dayName) => {
                if (!dateObj) return dayName + '曜日';
                return (dateObj.getMonth() + 1) + '月' + dateObj.getDate() + '日<br>(' + dayName + ')';
            };
            
            let html = '<div class="weekly-print-wrapper">';
            
            // ヘッダー
            html += '<div class="weekly-print-header">';
            html += '<div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">';
            html += '<h1 class="weekly-print-title">週間行動予定表（工事管理課）</h1>';
            html += '</div>';
            html += '<div style="flex: 0 0 auto;">';
            html += '<table class="approval-table"><thead><tr><th>部長</th><th>上長</th><th>担当者</th></tr></thead>';
            html += '<tbody><tr><td></td><td>';
            if (isApproved) {
                html += '<div class="stamp-approved">済<br><span>' + approvedDateStr + '</span></div>';
            }
            html += '</td>';
            html += '<td class="author-cell">' + authorVal + '</td>';
            html += '</tr></tbody></table></div></div>';
            
            // サブヘッダー
            html += '<div class="weekly-print-subheader">';
            html += '<div>WF申請</div>';
            html += '<div class="legend-box">';
            html += '<div class="legend-item"><span class="legend-color" style="background:#ef4444;"></span><span>→休憩</span></div>';
            html += '<div class="legend-item"><span class="legend-color" style="background:#16a34a;"></span><span>→移動</span></div>';
            html += '</div></div>';

            // カラムヘッダー（1回だけ）
            html += '<table class="print-master-table"><thead><tr>';
            html += '<th class="col-date">日時</th><th class="col-project">訪問先</th>';
            html += '<th class="col-time">時間</th><th class="col-direct">直行直帰</th>';
            html += '<th class="col-detail">記録</th>';
            html += '</tr></thead></table>';
            
            // 各曜日
            daysName.forEach((day, idx) => {
                const dayObj = daysData[day];
                const tasks = dayObj.tasks;
                const reportText = dayObj.reportText;
                const dateObj = dates ? dates[idx] : null;

                // マージタイムライン
                let mergedTimeline = Array(48).fill(0);
                let dayTotal = 0;
                const projectSet = new Set();
                tasks.forEach(task => {
                    dayTotal += parseFloat(task.hours || 0);
                    if (task.project) projectSet.add(task.project);
                    if (task.timeline && task.timeline.length === 48) {
                        for (let i = 0; i < 48; i++) {
                            const val = parseInt(task.timeline[i]);
                            if (val === 1) mergedTimeline[i] = 1;
                            else if (val === 2 && mergedTimeline[i] !== 1) mergedTimeline[i] = 2;
                            else if (val === 3 && mergedTimeline[i] === 0) mergedTimeline[i] = 3;
                            else if (val === 4 && mergedTimeline[i] === 0) mergedTimeline[i] = 4;
                        }
                    }
                });

                html += '<div class="print-day-block">';
                html += '<table class="print-day-table"><tbody>';
    
                if (tasks.length === 0) {
                    html += '<tr>';
                    html += '<td class="col-date">' + formatPrintDate(dateObj, day) + '</td>';
                    html += '<td class="col-project">-</td>';
                    html += '<td class="col-time">-</td>';
                    html += '<td class="col-direct"></td>';
                    html += '<td class="col-detail">' + (reportText || '') + '</td>';
                    html += '</tr>';
                } else {
                    tasks.forEach((task, tIdx) => {
                        const timeIntervals = getTimelineIntervals(task.timeline);
                        const timeStr = timeIntervals.join('<br>') || (task.hours > 0 ? parseFloat(task.hours).toFixed(1) + 'H' : '-');
                        let detailContent = task.detail || '';
                        if (tIdx === tasks.length - 1 && reportText) {
                            detailContent += '<div style="font-size:7pt;color:#475569;margin-top:2px;border-top:1px dashed #94a3b8;padding-top:2px;">📝 ' + reportText + '</div>';
                        }
                        html += '<tr>';
                        if (tIdx === 0) html += '<td class="col-date" rowspan="' + tasks.length + '">' + formatPrintDate(dateObj, day) + '</td>';
                        html += '<td class="col-project">' + (task.project || '') + '</td>';
                        html += '<td class="col-time">' + timeStr + '</td>';
                        if (tIdx === 0) html += '<td class="col-direct" rowspan="' + tasks.length + '"></td>';
                        html += '<td class="col-detail">' + detailContent + '</td>';
                        html += '</tr>';
                    });
                }
                html += '</tbody></table>';

                // 訪問先サマリー行（緑背景）
                const places = [...projectSet].join('、') || '-';
                html += '<div class="print-visit-row">';
                html += '<div class="pv-label">訪問先</div>';
                html += '<div class="pv-empty"></div><div class="pv-empty"></div>';
                html += '<div class="pv-place">' + places + '</div>';
                html += '<div class="pv-empty-w"></div>';
                html += '</div>';
    
                // タイムライン行（7〜19時 + 早朝h/残業h/計）
                const earlyH = mergedTimeline.slice(0, 4).filter(s => s === 1 || s === 3).length * 0.5;
                const overH = mergedTimeline.slice(30, 48).filter(s => s === 1 || s === 3).length * 0.5;
                const totalH = mergedTimeline.filter(s => s === 1 || s === 3).length * 0.5;

                html += '<div class="print-timeline-row">';
                html += '<div class="tl-label">時間</div>';
                html += '<div class="tl-early-val">' + earlyH.toFixed(0) + '</div>';
                html += '<div class="tl-early-lbl">早朝h</div>';
                html += '<div class="tl-hours">';
                html += '<div class="tl-header">';
                for (let h = 7; h <= 20; h++) html += '<div class="tl-hcell">' + (h <= 19 ? h : '') + '</div>';
                html += '</div>';
                html += '<div class="tl-grid">';
                for (let i = 4; i < 30; i++) html += '<div class="tl-cell" data-state="' + mergedTimeline[i] + '"></div>';
                html += '</div></div>';
                html += '<div class="tl-over-lbl">残業h</div>';
                html += '<div class="tl-over-val">' + overH.toFixed(0) + '</div>';
                html += '<div class="tl-total-lbl">計</div>';
                html += '<div class="tl-total-val">' + totalH.toFixed(0) + '</div>';
                html += '</div>';
    
                html += '</div>'; // .print-day-block
            });
            
            html += '</div>'; // .weekly-print-wrapper
            
            // 印刷専用ウィンドウ（現在のページのDOMに一切干渉しない→フリーズ防止）
            var printWin = window.open('', '_blank', 'width=' + screen.width + ',height=' + screen.height + ',left=0,top=0');
            if (!printWin) {
                alert('ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。');
                return;
            }

            var printCSS = [
                '@page { size: A4 portrait; margin: 6mm 10mm; }',
                '* { box-sizing: border-box; margin: 0; padding: 0; }',
                'body { font-family: "Hiragino Kaku Gothic ProN", "MS Gothic", sans-serif; margin: 0; padding: 0; background: #fff; color: #000; font-size: 8pt; }',
                '.weekly-print-wrapper { width: 100%; }',
                '.weekly-print-header { display: flex; justify-content: space-between; align-items: flex-end; width: 100%; margin-bottom: 2px; }',
                '.weekly-print-title { font-size: 14pt; font-weight: bold; text-align: center; letter-spacing: 2px; margin: 0; padding-bottom: 2px; white-space: nowrap; }',
                '.weekly-print-subheader { display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; margin-bottom: 2px; font-weight: bold; }',
                '.legend-box { display: flex; gap: 8px; align-items: center; font-size: 7pt; }',
                '.legend-item { display: flex; align-items: center; gap: 2px; }',
                '.legend-color { width: 12px; height: 10px; border: 1px solid #000; display: inline-block; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.approval-table { border-collapse: collapse; }',
                '.approval-table th { font-size: 7pt; padding: 1px 4px; border: 1px solid #000; background: #f1f5f9; text-align: center; width: 46px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.approval-table td { border: 1px solid #000; width: 46px; height: 46px; text-align: center; vertical-align: middle; font-size: 7.5pt; padding: 2px; }',
                '.author-cell { background: #FFD700 !important; font-weight: bold; font-size: 14pt; text-align: center; vertical-align: middle; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.stamp-approved { font-size: 9pt; font-weight: bold; color: #dc2626; border: 2px solid #dc2626; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; flex-direction: column; margin: 0 auto; }',
                '.stamp-approved span { font-size: 5.5pt; }',
                '.print-master-table { width: 100%; border-collapse: collapse; margin-bottom: 0; }',
                '.print-master-table th { border: 1px solid #16a34a; padding: 2px 4px; font-size: 7.5pt; font-weight: bold; text-align: center; background: #f0fdf4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.print-day-block { border-left: 1px solid #16a34a; border-right: 1px solid #16a34a; border-bottom: 2px solid #16a34a; margin-bottom: 0; page-break-inside: avoid; }',
                '.print-day-table { width: 100%; border-collapse: collapse; }',
                '.print-day-table td { border: 1px solid #ccc; padding: 2px 4px; font-size: 7.5pt; vertical-align: middle; min-height: 18px; }',
                '.col-date { width: 10%; text-align: center; font-weight: bold; font-size: 8pt; border-right: 1px solid #16a34a !important; }',
                '.col-project { width: 12%; font-size: 7.5pt; text-align: left; font-weight: bold; }',
                '.col-time { width: 8%; text-align: center; font-size: 7.5pt; }',
                '.col-direct { width: 8%; text-align: center; }',
                '.col-detail { width: 62%; font-size: 7.5pt; text-align: left; white-space: pre-wrap; }',
                '.print-visit-row { display: flex; align-items: stretch; border-top: 2px solid #16a34a; background: #f0fdf4; height: 18px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.pv-label { width: 10%; font-size: 7pt; font-weight: bold; text-align: center; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; }',
                '.pv-empty { width: 10%; border-right: 1px solid #16a34a; }',
                '.pv-place { flex: 1; font-size: 7.5pt; font-weight: bold; display: flex; align-items: center; padding-left: 4px; border-right: 1px solid #16a34a; }',
                '.pv-empty-w { width: 20%; }',
                '.print-timeline-row { display: flex; align-items: stretch; border-top: 1px solid #16a34a; background: #fff; height: 26px; }',
                '.tl-label { width: 5%; font-size: 7pt; text-align: center; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; background: #f0fdf4; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.tl-early-val { width: 4%; font-size: 7pt; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; background: #fefce8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.tl-early-lbl { width: 5%; font-size: 5.5pt; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; }',
                '.tl-hours { flex: 1; display: flex; flex-direction: column; border-right: 1px solid #16a34a; }',
                '.tl-header { display: flex; justify-content: space-between; font-size: 6pt; height: 10px; line-height: 10px; border-bottom: 1px solid #16a34a; padding: 0 2px; }',
                '.tl-hcell { width: 0; overflow: visible; display: flex; justify-content: center; font-size: 6pt; white-space: nowrap; font-weight: bold; }',
                '.tl-grid { display: flex; flex: 1; padding: 0; }',
                '.tl-cell { flex: 1; border-right: 1px solid #e5e7eb; height: 100%; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.tl-cell:nth-child(2n) { border-right: 1px solid #16a34a; }',
                '.tl-cell:last-child { border-right: none; }',
                '.tl-cell[data-state="0"] { background: #fff; }',
                '.tl-cell[data-state="1"] { background: #000; }',
                '.tl-cell[data-state="2"] { background: #ef4444; }',
                '.tl-cell[data-state="3"] { background: #16a34a; }',
                '.tl-cell[data-state="4"] { background: #2563eb; }',
                '.tl-over-lbl { width: 5%; font-size: 5.5pt; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; }',
                '.tl-over-val { width: 4%; font-size: 7pt; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; background: #fefce8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
                '.tl-total-lbl { width: 4%; font-size: 7pt; font-weight: bold; border-right: 1px solid #16a34a; display: flex; align-items: center; justify-content: center; }',
                '.tl-total-val { width: 5%; font-size: 8pt; font-weight: bold; display: flex; align-items: center; justify-content: center; background: #fefce8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }'
            ].join('\n');

            var fullDoc = '<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>週間行動予定表</title><style>' + printCSS + '</style></head><body>' + html + '</body></html>';

            printWin.document.write(fullDoc);
            printWin.document.close();

            printWin.onload = function() { printWin.focus(); printWin.print(); };
            printWin.onafterprint = function() { printWin.close(); };
            setTimeout(function() {
                try { if (!printWin.closed) { printWin.focus(); printWin.print(); } } catch(e) {}
            }, 500);
        } catch (error) {
            console.error("Print Error:", error);
            alert("印刷プレビューエラーが発生しました:\n" + error.message);
        }
    };

    const btnPrintWeekly = document.getElementById('btn-print-weekly');
    if (btnPrintWeekly) {
        btnPrintWeekly.addEventListener('click', printWeeklyReport);
    }

    // 週の予定と実績のExcel出力
    const btnExportWeekly = document.getElementById('btn-export-weekly');
    if (btnExportWeekly) {
        btnExportWeekly.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') {
                return alert('Excelライブラリの読み込みに失敗しました。ページを再読み込みしてください。');
            }
            
            const weekInput = document.getElementById('week');
            const authorInput = document.getElementById('author');
            if (!weekInput || !authorInput) return;
            
            const weekVal = weekInput.value;
            const weekText = weekInput.options[weekInput.selectedIndex]?.text || '';
            const authorVal = authorInput.value;
            if (!weekVal || !authorVal) {
                return alert('対象週または担当者が正しく選択されていません。');
            }
            
            // 常に画面の最新のDOMデータから収集してエクスポートする
            const daysData = {};
            daysName.forEach(day => {
                const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
                const rows = dayCard.querySelectorAll('.task-row');
                const tasks = [];
                rows.forEach(row => {
                    const project = row.querySelector('.task-project').value.trim();
                    const detail = row.querySelector('.task-detail').value.trim();
                    const hours = parseFloat(row.querySelector('.task-hours').value || 0);
                    const timeline = row.querySelector('.task-timeline-data').value;
                    // 工事名(project)が入力されているタスク行のみを有効なデータとしてエクスポートする
                    if (project) {
                        tasks.push({ project, detail, hours, timeline });
                    }
                });
                const reportText = dayCard.querySelector('.day-report-text').value.trim();
                daysData[day] = { tasks, reportText };
            });
            
            
            const dates = getDaysOfWeek(weekVal);
            if (!dates || dates.length < 7) {
                return alert('週の日付データの取得に失敗しました。');
            }
            
            const originalText = btnExportWeekly.textContent;
            btnExportWeekly.disabled = true;
            btnExportWeekly.textContent = '出力中...';
            
            try {
                const response = await fetch('template-weekly.xlsx');
                if (!response.ok) throw new Error('テンプレートファイルの取得に失敗しました。');
                
                const arrayBuffer = await response.arrayBuffer();
                const workbook = new ExcelJS.Workbook();
                await workbook.xlsx.load(arrayBuffer);
                
                const sheet = workbook.worksheets[0];
                
                const startMonday = dates[0];
                const yyyy = startMonday.getFullYear();
                const mm = String(startMonday.getMonth() + 1).padStart(2, '0');
                const dd = String(startMonday.getDate()).padStart(2, '0');
                sheet.name = `${yyyy}${mm}${dd}`;
                
                const sheetsToRemove = workbook.worksheets.filter((s, idx) => idx > 0);
                sheetsToRemove.forEach(s => workbook.removeWorksheet(s.id));
                
                const authorCell = sheet.getCell('BI3');
                if (authorCell) {
                    authorCell.value = authorVal;
                }
                
                const dayConfig = {
                    '月': { startRow: 10, dateCell: 'B10' },
                    '火': { startRow: 22, dateCell: 'B22' },
                    '水': { startRow: 34, dateCell: 'B34' },
                    '木': { startRow: 46, dateCell: 'B46' },
                    '金': { startRow: 58, dateCell: 'B58' },
                    '土': { startRow: 70, dateCell: 'B70' },
                    '日': { startRow: 80, dateCell: 'B80' }
                };
                
                daysName.forEach((day, idx) => {
                    const config = dayConfig[day];
                    const dateVal = dates[idx];
                    
                    const dateCell = sheet.getCell(config.dateCell);
                    if (dateCell) {
                        const yr = dateVal.getFullYear();
                        const mt = String(dateVal.getMonth() + 1).padStart(2, '0');
                        const dy = String(dateVal.getDate()).padStart(2, '0');
                        dateCell.value = `${yr}-${mt}-${dy}`;
                    }
                    
                    const dayObj = daysData[day];
                    const tasks = dayObj.tasks;
                    const reportText = dayObj.reportText;
                    
                    // 予定行のクリア (月〜土の予定行。日付セルの3行上の行)
                    if (day !== '日') {
                        const planRow = config.startRow - 3;
                        sheet.getCell(planRow, 5).value = null;
                        sheet.getCell(planRow, 13).value = null;
                        sheet.getCell(planRow, 17).value = null;
                        sheet.getCell(planRow, 21).value = null;
                    }

                    const maxRows = (day === '日') ? 2 : 5; // 月〜土は最大5行の実績入力枠があるため5に変更
                    for (let rIdx = 0; rIdx < maxRows; rIdx++) {
                        const targetRow = config.startRow + rIdx; // 1行ずれていたのを修正。日付セルの行（月曜なら10行目）から実績を書き込む
                        
                        const cellProj = sheet.getCell(targetRow, 5);
                        const cellTime = sheet.getCell(targetRow, 13);
                        const cellDirect = sheet.getCell(targetRow, 17);
                        const cellDetail = sheet.getCell(targetRow, 21);
                        
                        const task = tasks[rIdx];
                        if (task) {
                            cellProj.value = task.project || null;
                            cellTime.value = task.hours > 0 ? parseFloat(task.hours) : null;
                            cellDirect.value = null;
                            
                            let detailText = task.detail || '';
                            if (rIdx === tasks.length - 1 && reportText) {
                                detailText += (detailText ? '\n' : '') + `📝 日次報告: ${reportText}`;
                            }
                            cellDetail.value = detailText || null;
                        } else {
                            cellProj.value = null;
                            cellTime.value = null;
                            cellDirect.value = null;
                            if (rIdx === 0 && reportText) {
                                cellDetail.value = `📝 日次報告: ${reportText}`;
                            } else {
                                cellDetail.value = null;
                            }
                        }
                    }
                    
                    let earlyHours = 0;
                    let overtimeHours = 0;
                    let totalHours = 0;
                    
                    let mergedTimeline = Array(48).fill(0);
                    tasks.forEach(task => {
                        totalHours += parseFloat(task.hours || 0);
                        if (task.timeline) {
                            let tlStr = task.timeline;
                            if (tlStr.length === 40) {
                                tlStr = tlStr + '00000000'; // 互換性のため40文字のタイムラインに末尾8文字補完
                            }
                            if (tlStr.length === 48) {
                                for (let i = 0; i < 48; i++) {
                                    const val = parseInt(tlStr[i]);
                                    if (val === 1) {
                                        mergedTimeline[i] = 1;
                                    } else if (val === 2 && mergedTimeline[i] !== 1) {
                                        mergedTimeline[i] = 2;
                                    }
                                }
                            }
                        }
                    });
                    
                    for (let i = 0; i < 14; i++) {
                        if (mergedTimeline[i] === 1) {
                            earlyHours += 0.5;
                        }
                    }
                    for (let i = 38; i < 48; i++) {
                        if (mergedTimeline[i] === 1) {
                            overtimeHours += 0.5;
                        }
                    }
                    
                    // 日曜日はタイムライングリッドが config.startRow + 5 行目（85行目）にあるのを考慮
                    const gridRowIndex = (day === '日') ? (config.startRow + 5) : (config.startRow + 8);
                    
                    const earlyCell = sheet.getCell(gridRowIndex, 4);
                    if (earlyCell) {
                        earlyCell.value = earlyHours > 0 ? earlyHours : 0;
                    }
                    
                    if (day !== '土') {
                        const overtimeCell = sheet.getCell(gridRowIndex, 65);
                        if (overtimeCell) {
                            overtimeCell.value = overtimeHours > 0 ? overtimeHours : 0;
                        }
                    }
                    
                    const totalCell = sheet.getCell(gridRowIndex, 66);
                    if (totalCell) {
                        totalCell.value = totalHours > 0 ? totalHours : 0;
                    }
                    // タイムラインセル（I列 9 〜 BL列 64）の範囲のみを塗りつぶし対象に制限して他の合計セルなどのスタイル破壊を防止
                    for (let col = 9; col <= 64; col++) {
                        const timeVal = 7.0 + (col - 9) * 0.25;
                        
                        let tlIdx = 0;
                        let state = 0;
                        // 24時以降（翌日）は今日のタイムラインデータが存在しないため背景を塗らない
                        if (timeVal < 24.0) {
                            tlIdx = Math.floor(timeVal * 2);
                            state = (tlIdx >= 0 && tlIdx < 48) ? mergedTimeline[tlIdx] : 0;
                        }
                        
                        const cell = sheet.getCell(gridRowIndex, col);
                        cell.style = Object.create(cell.style);
                        
                        if (state === 1) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FF111111' } // 完全な黒 FF000000 から FF111111 に変更してExcelの自動判定バグを回避
                            };
                        } else if (state === 2) {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFEF4444' }
                            };
                        } else {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'none'
                            };
                        }
                    }
                });
                
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `週報_${authorVal}_${weekVal}.xlsx`;
                anchor.click();
                window.URL.revokeObjectURL(url);
                
            } catch (err) {
                console.error('Excel Export Error:', err);
                alert('Excel出力中にエラーが発生しました: ' + err.message);
            } finally {
                btnExportWeekly.disabled = false;
                btnExportWeekly.textContent = originalText;
            }
        });
    }


    // Excel Export (Gantt)
    const btnExportGantt = document.getElementById('btn-export-gantt');
    if (btnExportGantt) {
        btnExportGantt.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') return alert('ExcelJSライブラリの読み込みに失敗しました。');
            
            const selectedYear = parseInt(ganttYearSelect.value, 10);
            if (isNaN(selectedYear)) return alert('年度が選択されていません。');

            const startStr = `${selectedYear}-04-01`;
            const endStr = `${selectedYear + 1}-03-31`;

            // 日付リスト生成
            const dateList = [];
            const current = new Date(selectedYear, 3, 1);
            const end = new Date(selectedYear + 1, 2, 31);
            while (current <= end) {
                dateList.push(new Date(current));
                current.setDate(current.getDate() + 1);
            }

            const targetSchedules = allSchedules.filter(s => s.start <= endStr && s.end >= startStr);
            targetSchedules.sort((a, b) => (a.start || '') > (b.start || '') ? 1 : ((a.start || '') < (b.start || '') ? -1 : 0));

            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet(`${selectedYear}年度 工程管理表`);

            // カラーコード変換ヘルパー
            const hexToARGB = (hex) => {
                if (!hex) return 'FF16A34A';
                return 'FF' + hex.replace('#', '').toUpperCase();
            };

            // 列幅の設定
            const leftWidths = [22, 16, 22, 14, 14, 14, 14, 16, 12, 12, 12, 12, 10, 8];
            sheet.columns = [
                ...leftWidths.map(w => ({ width: w })),
                ...dateList.map(() => ({ width: 1.2 })) // タイムライン列は極細
            ];

            // ----------------------------------------
            // 行1: 月ヘッダー
            // ----------------------------------------
            const row1 = sheet.getRow(1);
            row1.height = 25;
            
            // 左側結合
            sheet.mergeCells(1, 1, 1, 14);
            const detailHeaderCell = row1.getCell(1);
            detailHeaderCell.value = '工程詳細情報';
            detailHeaderCell.font = { name: 'MS Gothic', size: 10, bold: true };
            detailHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
            detailHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            detailHeaderCell.border = {
                top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }, bottom: { style: 'thin' }
            };

            // 右側月ヘッダー結合
            let startCol = 15;
            dateList.forEach((d, idx) => {
                const m = d.getMonth() + 1;
                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                if (isLastDay) {
                    const endCol = idx + 15; // 1-indexed column index
                    sheet.mergeCells(1, startCol, 1, endCol);
                    const mCell = row1.getCell(startCol);
                    mCell.value = `${m}月`;
                    mCell.font = { name: 'MS Gothic', size: 10, bold: true };
                    mCell.alignment = { horizontal: 'center', vertical: 'middle' };
                    mCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                    
                    // 月の右境界線を太くする
                    mCell.border = {
                        top: { style: 'medium' },
                        bottom: { style: 'thin' },
                        left: { style: startCol === 15 ? 'thin' : 'none' },
                        right: { style: !nextDate ? 'medium' : 'medium' }
                    };
                    startCol = endCol + 1;
                }
            });

            // ----------------------------------------
            // 行2: 詳細項目ヘッダー ＆ カレンダー日ヘッダー
            // ----------------------------------------
            const row2 = sheet.getRow(2);
            row2.height = 20;

            const leftHeaders = [
                "工事名", "元請", "現場住所", "仕入先①(柱脚)", "仕入先②(製作1)", "仕入先③(製作2)", 
                "管理補助", "数量メモ", "営業担当", "工務担当", "工事担当", "主任技術者", "専任区分", "完了"
            ];
            
            leftHeaders.forEach((lh, idx) => {
                const cell = row2.getCell(idx + 1);
                cell.value = lh;
                cell.font = { name: 'MS Gothic', size: 9, bold: true };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'medium' },
                    left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                    right: { style: 'thin' }
                };
            });

            dateList.forEach((d, idx) => {
                const colIdx = idx + 15;
                const cell = row2.getCell(colIdx);
                const day = d.getDay();
                const isSat = day === 6;
                const isSun = day === 0;

                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'medium' },
                    left: { style: 'none' },
                    right: { style: isLastDay ? 'medium' : 'thin' }
                };

                if (isSat) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0FA' } }; // 薄い青
                } else if (isSun) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEECEC' } }; // 薄い赤
                } else {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                }
            });

            // ----------------------------------------
            // データ行レンダリング
            // ----------------------------------------
            targetSchedules.forEach((s, index) => {
                const rowIndex = index + 3;
                const row = sheet.getRow(rowIndex);
                row.height = 24;

                const displayAssign = '';
                const displayCompleted = s.completed ? '✓' : '-';

                const leftValues = [
                    s.project || '', s.client || '-', s.address || '-', s.supplier1 || '-', s.supplier2 || '-', s.supplier3 || '-',
                    s.subcontractor || '-', s.memoQty || '-', s.salesRep || '-', s.constRep || '-', s.siteRep || '-', s.chiefTech || '-',
                    displayAssign, displayCompleted
                ];

                leftValues.forEach((val, idx) => {
                    const cell = row.getCell(idx + 1);
                    cell.value = val;
                    cell.font = { name: 'MS Gothic', size: 9 };
                    cell.alignment = { 
                        horizontal: (idx >= 12) ? 'center' : 'left',
                        vertical: 'middle' 
                    };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    // 完了かつ完了カラムなら緑色太字
                    if (idx === 13 && s.completed) {
                        cell.font = { name: 'MS Gothic', size: 9, bold: true, color: { argb: 'FF16A34A' } };
                    }
                });

                // カレンダー背景セルの初期化 (土日・月境界の描画)
                dateList.forEach((d, idx) => {
                    const colIdx = idx + 15;
                    const cell = row.getCell(colIdx);
                    const day = d.getDay();
                    const isSat = day === 6;
                    const isSun = day === 0;

                    const nextDate = dateList[idx + 1];
                    const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: { style: 'none' },
                        right: { style: isLastDay ? 'medium' : 'thin' }
                    };

                    if (isSat) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6F0FA' } };
                    } else if (isSun) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEECEC' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } };
                    }
                });

                // 工程バーの書き込み
                const startLimit = new Date(startStr);
                const endLimit = new Date(endStr);
                const sStart = new Date(s.start);
                const sEnd = new Date(s.end);

                const drawStart = sStart < startLimit ? startLimit : sStart;
                const drawEnd = sEnd > endLimit ? endLimit : sEnd;

                const drawStartStr = drawStart.toISOString().split('T')[0];
                const drawEndStr = drawEnd.toISOString().split('T')[0];

                const startIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawStartStr);
                const endIdx = dateList.findIndex(d => d.toISOString().split('T')[0] === drawEndStr);

                if (startIdx !== -1 && endIdx !== -1) {
                    const barStartCol = startIdx + 15;
                    const barEndCol = endIdx + 15;

                    // バーに該当する各セルにスタイルを適用 (結合されるため、スタイル共有崩れ対策として個別適用)
                    const colorARGB = hexToARGB(getBarColorForSiteRep(s.siteRep));
                    
                    for (let c = barStartCol; c <= barEndCol; c++) {
                        const cell = row.getCell(c);
                        
                        // ストライプか通常塗りつぶしか
                        if (s.barPattern === 'stripe') {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'lightDown',
                                fgColor: { argb: colorARGB },
                                bgColor: { argb: 'FFFFFFFF' } // 背景は白
                            };
                        } else {
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: colorARGB }
                            };
                        }

                        // 完了状態なら半透明グレーに近い枠などを指定するか、値の打消線
                        cell.font = {
                            name: 'MS Gothic',
                            size: 8,
                            bold: true,
                            color: { argb: 'FFFFFFFF' }, // 文字は白
                            strike: s.completed ? true : false
                        };
                    }

                    // セル結合
                    sheet.mergeCells(rowIndex, barStartCol, rowIndex, barEndCol);
                    
                    // 結合後の代表セル（開始セル）にラベルをセット
                    const mergedStartCell = row.getCell(barStartCol);
                    mergedStartCell.value = `${s.completed ? '[完了] ' : ''}${s.project}${s.notes ? ` (${s.notes})` : ''}`;
                    mergedStartCell.alignment = { 
                        horizontal: 'center', 
                        vertical: 'middle',
                        wrapText: false
                    };
                }
            });

            // 右側の最後の列の右境界線を太線にする
            const lastColIdx = leftColCount + dateList.length;
            for (let r = 1; r <= targetSchedules.length + 2; r++) {
                const cell = sheet.getRow(r).getCell(lastColIdx);
                cell.border = {
                    ...cell.border,
                    right: { style: 'medium' }
                };
            }
            // 最終行の下境界線を太線にする
            const lastRowIdx = targetSchedules.length + 2;
            if (lastRowIdx > 2) {
                const lastRow = sheet.getRow(lastRowIdx);
                for (let c = 1; c <= lastColIdx; c++) {
                    const cell = lastRow.getCell(c);
                    cell.border = {
                        ...cell.border,
                        bottom: { style: 'medium' }
                    };
                }
            }

            // ブロードキャスト書き出し
            try {
                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${selectedYear}年度_工程管理表.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (err) {
                console.error("Excel export error: ", err);
                alert("Excel出力中にエラーが発生しました。");
            }
        });
    }

    // Excel Export (List)
    const btnExportList = document.getElementById('btn-export');
    if (btnExportList) {
        btnExportList.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const filterMonth = document.getElementById('filter-month').value;
            const filterAuthor = document.getElementById('filter-author').value;
            const filtered = allReports.filter(r => 
                (r.status === undefined || r.status === 'confirmed') &&
                (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
                (filterAuthor === '' || r.author === filterAuthor)
            );
            const rows = [];
            const authorProjectHours = {};

            filtered.forEach(r => {
                const days = ['月','火','水','木','金','土','日'];
                days.forEach(day => {
                    const tasks = (r.dailyLogs && r.dailyLogs[day]) ? r.dailyLogs[day] : [];
                    const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
                    
                    if (tasks.length > 0) {
                        tasks.forEach(t => {
                            rows.push({
                                "対象期間": formatWeekRange(r.week),
                                "担当者": r.author,
                                "曜日": day,
                                "工事名": t.project,
                                "作業内容": t.detail,
                                "作業時間(H)": t.hours,
                                "日次レポート・備考": dailyRep
                            });
                            
                            if (t.project && !['有給', '欠勤', '休日'].includes(t.project)) {
                                if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
                                authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                            }
                        });
                    } else if (dailyRep) {
                        rows.push({
                            "対象期間": formatWeekRange(r.week),
                            "担当者": r.author,
                            "曜日": day,
                            "工事名": "",
                            "作業内容": "(工事入力なし)",
                            "作業時間(H)": "",
                            "日次レポート・備考": dailyRep
                        });
                    }
                });
            });

            const wb = XLSX.utils.book_new();
            
            // 1シート目: 日報一覧
            const wsList = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, wsList, "日報一覧(詳細)");

            // 2シート目: 個人別集計
            const summaryRows = [];
            Object.keys(authorProjectHours).sort().forEach(author => {
                let total = 0;
                Object.keys(authorProjectHours[author]).sort().forEach(proj => {
                    const hrs = authorProjectHours[author][proj];
                    total += hrs;
                    summaryRows.push({ "担当者": author, "工事名": proj, "合計時間(H)": hrs });
                });
                summaryRows.push({ "担当者": author, "工事名": "【合計】", "合計時間(H)": total });
                summaryRows.push({}); // 空行
            });

            if (summaryRows.length > 0) {
                const wsSum = XLSX.utils.json_to_sheet(summaryRows);
                XLSX.utils.book_append_sheet(wb, wsSum, "個人別集計(月間)");
            }

            XLSX.writeFile(wb, "個人別日報_月間集計.xlsx");
        });
    }

    // Excel Export (Summary)
    const btnExportSummary = document.getElementById('btn-export-summary');
    if (btnExportSummary) {
        btnExportSummary.addEventListener('click', () => {
            if (typeof XLSX === 'undefined') return alert('Excelライブラリの読み込みに失敗しました。');
            const filterMonth = document.getElementById('summary-filter-month').value;
            if (!filterMonth) return alert('対象月を選択してください。');
            
            const [year, month] = filterMonth.split('-').map(Number);
            const table = document.getElementById('summary-table');
            const wb = XLSX.utils.table_to_book(table, { raw: true });
            XLSX.writeFile(wb, `${year}年${month}月_工事別作業時間集計.xlsx`);
        });
    }
});

// --- 予定・工程入力フォーム編集モード制御 ---
function startEditScheduleMode(sched) {
    const idInput = document.getElementById('sched-id');
    const titleEl = document.getElementById('schedule-form-title');
    const submitBtn = document.getElementById('sched-submit-btn');
    const cancelBtn = document.getElementById('sched-cancel-btn');

    if (!idInput || !titleEl || !submitBtn) return;

    idInput.value = sched.id;
    titleEl.textContent = '✏️ 工事情報の編集・修正';
    submitBtn.textContent = '変更を保存する';
    if (cancelBtn) cancelBtn.classList.remove('hidden');

    document.getElementById('sched-project').value = sched.project || '';
    document.getElementById('sched-client').value = sched.client || '';
    document.getElementById('sched-address').value = sched.address || '';
    document.getElementById('sched-start').value = sched.start || '';
    document.getElementById('sched-end').value = sched.end || '';
    document.getElementById('sched-supplier1').value = sched.supplier1 || '';
    document.getElementById('sched-supplier2').value = sched.supplier2 || '';
    document.getElementById('sched-supplier3').value = sched.supplier3 || '';
    document.getElementById('sched-subcontractor').value = sched.subcontractor || '';
    document.getElementById('sched-memo-qty').value = sched.memoQty || '';
    document.getElementById('sched-sales-rep').value = sched.salesRep || '';
    document.getElementById('sched-const-rep').value = sched.constRep || '';
    document.getElementById('sched-site-rep').value = sched.siteRep || '';
    document.getElementById('sched-chief-tech').value = sched.chiefTech || '';
    document.getElementById('sched-bar-pattern').value = sched.barPattern || 'solid';
    document.getElementById('sched-completed').checked = !!sched.completed;
    document.getElementById('sched-notes').value = sched.notes || '';
    document.getElementById('sched-author').value = sched.author || '';

    // タブ切り替え
    const tabBtn = document.querySelector('.tab-btn[data-target="schedule-input-view"]');
    if (tabBtn) tabBtn.click();
}

function resetScheduleEditMode() {
    const idInput = document.getElementById('sched-id');
    const titleEl = document.getElementById('schedule-form-title');
    const submitBtn = document.getElementById('sched-submit-btn');
    const cancelBtn = document.getElementById('sched-cancel-btn');
    const schedForm = document.getElementById('schedule-form');

    if (idInput) idInput.value = '';
    if (titleEl) titleEl.textContent = '工事を登録';
    if (submitBtn) submitBtn.textContent = '工事を登録';
    if (cancelBtn) cancelBtn.classList.add('hidden');
    if (schedForm) {
        schedForm.reset();
        // ログインユーザー名を設定
        if (currentUser) {
            const nameDisplay = currentUser.displayName || currentUser.email.split('@')[0];
            const authorEl = document.getElementById('sched-author');
            if (authorEl) authorEl.value = nameDisplay;
        }
    }
}

// --- ガントチャート予定編集モーダル ---
// openEditModal はDOMContentLoadedの外で定義（クロージャから呼ばれるため）
// db / updateDoc / deleteDoc / doc はモジュールスコープで参照可能
function openEditModal(sched) {
    // 既存モーダルがあれば削除
    const existing = document.getElementById('edit-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'edit-modal-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 9999;
        display: flex; justify-content: center; align-items: center; padding: 20px;
        box-sizing: border-box;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
        background: white; color: #1e293b;
        border-radius: 12px; padding: 30px; width: 100%; max-width: 650px;
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        box-sizing: border-box;
    `;

    // 役割・資格別プルダウン生成
    const makeOptions = (roleKey, currentVal) => {
        let filtered;
        if (roleKey === 'tech') {
            // 主任技術者は資格を保有しているメンバー全員を対象とする
            filtered = allMembers.filter(m => 
                (m.qualifications && m.qualifications.length > 0) || 
                (m.customQualifications && m.customQualifications.trim() !== "")
            );
        } else {
            filtered = allMembers.filter(m => (m.roles || []).includes(roleKey));
        }
        let optHtml = `<option value="">選択してください</option>`;
        filtered.forEach(m => {
            const selected = m.name === currentVal ? 'selected' : '';
            optHtml += `<option value="${m.name}" ${selected}>${m.name}</option>`;
        });
        return optHtml;
    };

    modal.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 1.3rem; border-bottom: 2px solid #2563eb; padding-bottom: 10px; color: #1e293b; font-weight: bold;">
            ✏️ 工程の編集・修正
        </h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">工事名 <span style="color:red">*</span></label>
                <input type="text" id="edit-project" value="${(sched.project || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">元請</label>
                <input type="text" id="edit-client" value="${(sched.client || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="margin-bottom: 15px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">現場住所</label>
            <input type="text" id="edit-address" value="${(sched.address || '').replace(/"/g, '&quot;')}"
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">開始日 <span style="color:red">*</span></label>
                <input type="date" id="edit-start" value="${sched.start || ''}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">終了日 <span style="color:red">*</span></label>
                <input type="date" id="edit-end" value="${sched.end || ''}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">柱脚 (仕入先①)</label>
                <input type="text" id="edit-supplier1" value="${(sched.supplier1 || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">製作工場① (仕入先②)</label>
                <input type="text" id="edit-supplier2" value="${(sched.supplier2 || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">製作工場② (仕入先③)</label>
                <input type="text" id="edit-supplier3" value="${(sched.supplier3 || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">管理補助</label>
                <input type="text" id="edit-subcontractor" value="${(sched.subcontractor || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">建・木 数量等</label>
                <input type="text" id="edit-memo-qty" value="${(sched.memoQty || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 10px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">営業担当</label>
                <select id="edit-sales-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('sales', sched.salesRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">工務担当</label>
                <select id="edit-const-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('const', sched.constRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">工事担当</label>
                <select id="edit-site-rep" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('site', sched.siteRep)}
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:3px; color:#1e293b; font-size:0.85rem;">主任技術者</label>
                <select id="edit-chief-tech" style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.9rem; color:#1e293b;">
                    ${makeOptions('tech', sched.chiefTech)}
                </select>
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 0.8fr; gap: 10px; align-items: center; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">バーの色</label>
                <select id="edit-bar-color" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; color:#1e293b;">
                    <option value="#16a34a" style="background:#16a34a; color:#fff;" ${sched.barColor === '#16a34a' ? 'selected' : ''}>緑</option>
                    <option value="#2563eb" style="background:#2563eb; color:#fff;" ${sched.barColor === '#2563eb' ? 'selected' : ''}>青</option>
                    <option value="#ea580c" style="background:#ea580c; color:#fff;" ${sched.barColor === '#ea580c' ? 'selected' : ''}>オレンジ</option>
                    <option value="#9333ea" style="background:#9333ea; color:#fff;" ${sched.barColor === '#9333ea' ? 'selected' : ''}>紫</option>
                    <option value="#db2777" style="background:#db2777; color:#fff;" ${sched.barColor === '#db2777' ? 'selected' : ''}>ピンク</option>
                    <option value="#ca8a04" style="background:#ca8a04; color:#fff;" ${sched.barColor === '#ca8a04' ? 'selected' : ''}>黄</option>
                </select>
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">バーの模様</label>
                <select id="edit-bar-pattern" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; color:#1e293b;">
                    <option value="solid" ${sched.barPattern === 'solid' ? 'selected' : ''}>通常 (塗りつぶし)</option>
                    <option value="stripe" ${sched.barPattern === 'stripe' ? 'selected' : ''}>ストライプ (斜線)</option>
                </select>
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-top:25px; justify-content:center;">
                <input type="checkbox" id="edit-completed" style="width:20px; height:20px; margin:0;" ${sched.completed ? 'checked' : ''}>
                <label for="edit-completed" style="margin:0; font-weight:bold; white-space:nowrap; cursor:pointer; color:#1e293b;">工程完了</label>
            </div>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">登録者（編集不可）</label>
            <input type="text" id="edit-author" value="${(sched.author || '').replace(/"/g, '&quot;')}" readonly
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; background:#f1f5f9; color:#64748b;">
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">作業内容・備考</label>
            <textarea id="edit-notes" rows="2"
                style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; resize:vertical; box-sizing:border-box; color:#1e293b;">${sched.notes || ''}</textarea>
        </div>
        
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button id="edit-save-btn" style="flex:2; min-width:120px; padding:12px; background:#2563eb; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                💾 保存する
            </button>
            <button id="edit-delete-btn" style="flex:1; min-width:80px; padding:12px; background:#ef4444; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                🗑️ 削除
            </button>
            <button id="edit-cancel-btn" style="flex:1; min-width:80px; padding:12px; background:#64748b; color:#fff; border:none; border-radius:6px; font-weight:700; cursor:pointer; font-size:1rem;">
                ✕ キャンセル
            </button>
        </div>
        <div id="edit-modal-msg" style="display:none; margin-top:12px; padding:10px; border-radius:6px; text-align:center; font-weight:bold;"></div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // オーバーレイ背景クリックで閉じる
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // キャンセルボタン
    document.getElementById('edit-cancel-btn').addEventListener('click', () => overlay.remove());

    // 保存ボタン
    document.getElementById('edit-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('edit-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        const updatedData = {
            companyId: currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1],
            project: document.getElementById('edit-project').value.trim(),
            client: document.getElementById('edit-client').value.trim(),
            address: document.getElementById('edit-address').value.trim(),
            start: document.getElementById('edit-start').value,
            end: document.getElementById('edit-end').value,
            supplier1: document.getElementById('edit-supplier1').value.trim(),
            supplier2: document.getElementById('edit-supplier2').value.trim(),
            supplier3: document.getElementById('edit-supplier3').value.trim(),
            subcontractor: document.getElementById('edit-subcontractor').value.trim(),
            memoQty: document.getElementById('edit-memo-qty').value.trim(),
            salesRep: document.getElementById('edit-sales-rep').value,
            constRep: document.getElementById('edit-const-rep').value,
            siteRep: document.getElementById('edit-site-rep').value,
            chiefTech: document.getElementById('edit-chief-tech').value,
            assignType: "none",
            barColor: document.getElementById('edit-bar-color').value,
            barPattern: document.getElementById('edit-bar-pattern').value,
            completed: document.getElementById('edit-completed').checked,
            notes: document.getElementById('edit-notes').value.trim(),
        };

        if (!updatedData.project || !updatedData.start || !updatedData.end) {
            alert('工事名・開始日・終了日は必須です。');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
            return;
        }
        if (updatedData.start > updatedData.end) {
            alert('終了日は開始日より後の日付にしてください。');
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
            return;
        }

        try {
            await updateDoc(doc(db, "schedules", sched.id), updatedData);

            const msg = document.getElementById('edit-modal-msg');
            msg.style.display = 'block';
            msg.style.background = '#dcfce7';
            msg.style.color = '#166534';
            msg.textContent = '✅ 保存しました！';

            setTimeout(() => {
                overlay.remove();
                window.loadSchedules();
            }, 1000);
        } catch (err) {
            console.error(err);
            alert('保存に失敗しました: ' + err.message);
            saveBtn.disabled = false;
            saveBtn.innerHTML = '💾 保存する';
        }
    });

    // 削除ボタン
    document.getElementById('edit-delete-btn').addEventListener('click', async () => {
        if (!confirm(`「${sched.project}」の予定を削除しますか？\nこの操作は取り消せません。`)) return;

        const delBtn = document.getElementById('edit-delete-btn');
        delBtn.disabled = true;
        delBtn.textContent = '削除中...';

        try {
            await deleteDoc(doc(db, "schedules", sched.id));
            overlay.remove();
            window.loadSchedules();
        } catch (err) {
            console.error(err);
            alert('削除に失敗しました: ' + err.message);
            delBtn.disabled = false;
            delBtn.innerHTML = '🗑️ 削除';
        }
    });
}

// パスワードの表示・非表示切り替えイベントハンドラ
document.addEventListener('DOMContentLoaded', () => {
    const eyeSvg = `<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>`;
    const eyeSlashSvg = `<svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width: 20px; height: 20px;"><path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.388 4.17 5.322 7.178 9.963 7.178.892 0 1.761-.137 2.585-.395m6-.046c.118-.119.231-.242.34-.368a10.457 10.457 0 0 0 2.045-3.777c-1.388-4.17-5.322-7.178-9.963-7.178-.925 0-1.82.146-2.665.418m11.233 11.233-18-18" /><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 8.684A3 3 0 1 0 12.32 12.32" /></svg>`;
    
    document.querySelectorAll('.toggle-password-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                if (input.type === 'password') {
                    input.type = 'text';
                    btn.innerHTML = eyeSlashSvg; // スラッシュ付き目のアイコン（非表示）に変更
                } else {
                    input.type = 'password';
                    btn.innerHTML = eyeSvg; // 通常の目のアイコン（表示）に変更
                }
            }
        });
    });

    // パスワード強制変更フォームの制御
    const pwdForm = document.getElementById('password-change-form');
    if (pwdForm) {
        pwdForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const newPassword = document.getElementById('new-password').value;
            const newPasswordConfirm = document.getElementById('new-password-confirm').value;
            const errorMsg = document.getElementById('password-change-error');
            const submitBtn = pwdForm.querySelector('button[type="submit"]');
            
            errorMsg.className = 'message error hidden';
            errorMsg.textContent = '';
            
            if (newPassword !== newPasswordConfirm) {
                errorMsg.className = 'message error';
                errorMsg.textContent = 'パスワードが一致しません。';
                return;
            }
            if (newPassword.length < 6) {
                errorMsg.className = 'message error';
                errorMsg.textContent = 'パスワードは6文字以上で設定してください。';
                return;
            }

            submitBtn.disabled = true;
            submitBtn.textContent = 'パスワードを設定中...';

            try {
                // Firebase Auth パスワードの更新
                await updatePassword(auth.currentUser, newPassword);
                
                // Firestore の社員オブジェクトから mustChangePassword: true を削除 (または false に変更)
                if (currentCompany && currentCompany.companyId) {
                    await loadLatestCompanyInfo(); // 最新情報に更新
                    const employees = currentCompany.employees || [];
                    const updatedEmployees = employees.map(emp => {
                        if (emp.uid === currentUser.uid) {
                            const newEmp = { ...emp };
                            delete newEmp.mustChangePassword; // フラグを消去
                            return newEmp;
                        }
                        return emp;
                    });
                    
                    const compDocRef = doc(db, "companies", currentCompany.companyId);
                    await updateDoc(compDocRef, { employees: updatedEmployees });
                }
                
                const successMsg = document.getElementById('password-change-success');
                if (successMsg) {
                    successMsg.className = 'message success';
                    successMsg.textContent = 'パスワードの初期設定が完了しました！システムを開始します...';
                    successMsg.classList.remove('hidden');
                }
                setTimeout(() => {
                    const modal = document.getElementById('password-change-modal');
                    if (modal) {
                        modal.style.display = 'none';
                    }
                    if (successMsg) {
                        successMsg.classList.add('hidden');
                    }
                }, 1500);
            } catch (err) {
                console.error("Password change failed", err);
                errorMsg.className = 'message error';
                errorMsg.classList.remove('hidden');
                if (err.code === 'auth/requires-recent-login') {
                    errorMsg.textContent = 'セキュリティ上の理由により、再ログインが必要です。一度ログアウトし、再度ログインしてから変更してください。';
                } else {
                    errorMsg.textContent = 'パスワードの変更に失敗しました: ' + err.message;
                }
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'パスワードを設定して利用開始';
            }
        });
    }

    // パスワード強制変更モーダル内のログアウト処理
    const btnPassChangeLogout = document.getElementById('btn-password-change-logout');
    if (btnPassChangeLogout) {
        btnPassChangeLogout.addEventListener('click', () => {
            if (confirm('ログアウトしますか？')) {
                signOut(auth).catch(err => console.error(err));
            }
        });
    }
});
