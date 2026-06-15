import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword, updateProfile, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, where, doc, updateDoc, deleteDoc, onSnapshot, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
};

const showDebugLog = (msg) => {
    console.log("[DEBUG] " + msg);
};

showDebugLog("1. Start loading imports...");
showDebugLog("2. Imports completed. Initializing Firebase...");

// Firebase初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let messaging = null;

// URLパラメータの確認 (新規登録後のログインなどで強制ログアウトするため)
const urlParams = new URLSearchParams(window.location.search);
const paramTargetEmail = urlParams.get('email') ? decodeURIComponent(urlParams.get('email')).trim() : null;

showDebugLog("3. Firebase Services initialized.");

const isFcmSupported = () => {
    try {
        return (
            'serviceWorker' in navigator &&
            'PushManager' in window &&
            'Notification' in window
        );
    } catch (e) {
        return false;
    }
};

if (isFcmSupported()) {
    try {
        messaging = getMessaging(app);
        showDebugLog("4. Firebase Messaging initialized.");
    } catch (err) {
        console.error("Failed to initialize Firebase Messaging:", err);
        showDebugLog("4. Firebase Messaging failed: " + err.message);
    }
} else {
    showDebugLog("4. FCM is not supported in this browser.");
}

// 状態管理
let currentUser = null;
let currentCompany = null;
let allReports = [];
let allSchedules = [];
let allMembers = [];
let allDailyReports = [];
let currentIsPlanEditable = true;
let currentIsActualEditable = true;
let authStateGeneration = 0; // 認証状態の世代カウンタ
let allAttendanceRecords = []; // 管理者用出退勤月間レコード保管用

// ユーザーの所属する会社をFirestoreから解決する関数 (ownerUid優先)
async function resolveUserCompany(email, uid) {
    showDebugLog("resolveUserCompany started for: " + email + ", uid: " + uid);
    try {
        // 1. ownerUid （会社オーナー）がログインユーザーの UID と一致する会社を検索（最優先）
        if (uid) {
            showDebugLog("Querying ownerUid...");
            const qOwner = query(collection(db, "companies"), where("ownerUid", "==", uid));
            const ownerSnapshot = await getDocs(qOwner);
            if (!ownerSnapshot.empty) {
                const docSnap = ownerSnapshot.docs[0];
                const companyData = docSnap.data();
                companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
                companyData.role = 'admin'; // 管理者権限
                showDebugLog("Company resolved as Owner: " + (companyData.companyName || companyData.companyId));
                return companyData;
            }
        }

        // 2. adminEmails（管理者）に含まれる会社をクエリ
        showDebugLog("Querying adminEmails...");
        const qAdmin = query(collection(db, "companies"), where("adminEmails", "array-contains", email));
        const adminSnapshot = await getDocs(qAdmin);
        if (!adminSnapshot.empty) {
            const docSnap = adminSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'admin'; // 管理者権限
            showDebugLog("Company resolved as Admin: " + (companyData.companyName || companyData.companyId));
            return companyData;
        }

        // 3. memberEmails（一般社員）に含まれる会社をクエリ
        showDebugLog("Querying memberEmails...");
        const qMember = query(collection(db, "companies"), where("memberEmails", "array-contains", email));
        const memberSnapshot = await getDocs(qMember);
        if (!memberSnapshot.empty) {
            const docSnap = memberSnapshot.docs[0];
            const companyData = docSnap.data();
            companyData.companyId = companyData.companyId || docSnap.id; // ドキュメントIDを会社IDとして補完
            companyData.role = 'employee'; // 一般社員権限
            showDebugLog("Company resolved as Employee: " + (companyData.companyName || companyData.companyId));
            return companyData;
        }
        
        // いずれにも該当しない場合は null を返す
        showDebugLog("Company not found for: " + email);
        return null;
    } catch (e) {
        console.error("Error resolving company:", e);
        showDebugLog("Error resolving company: " + e.message);
        return null;
    }
}

// 各種プルダウンに支店データを反映する関数

// 日報用の工事プルダウンを更新する関数
function updateReportProjectDropdown() {
    const reportProjectSelect = document.getElementById('report-project-id');
    const historyProjectSelect = document.getElementById('history-filter-project');
    const summaryProjectSelect = document.getElementById('summary-filter-project');
    
    const makeOptionsHtml = (defaultText) => {
        let html = `<option value="">${defaultText}</option>`;
        // 雑務を常にデフォルトの選択肢として追加
        html += `<option value="雑務">雑務</option>`;
        // 工事名順でソート
        const sortedSchedules = [...allSchedules].sort((a, b) => (a.project || '').localeCompare(b.project || ''));
        sortedSchedules.forEach(sched => {
            html += `<option value="${sched.id}">${sched.project} (${sched.projectNumber || '番号なし'})</option>`;
        });
        return html;
    };

    if (reportProjectSelect) {
        const curVal = reportProjectSelect.value;
        reportProjectSelect.innerHTML = makeOptionsHtml('工事を選択してください');
        reportProjectSelect.value = curVal;
    }
    if (historyProjectSelect) {
        const curVal = historyProjectSelect.value;
        historyProjectSelect.innerHTML = makeOptionsHtml('すべての工事');
        historyProjectSelect.value = curVal;
    }
    if (summaryProjectSelect) {
        const curVal = summaryProjectSelect.value;
        summaryProjectSelect.innerHTML = makeOptionsHtml('すべての工事');
        summaryProjectSelect.value = curVal;
    }
}
window.updateReportProjectDropdown = updateReportProjectDropdown;

function populateBranchDropdowns() {
    // 支店機能廃止に伴い何もしない
}

// 担当者または社員の所属支店を特定するヘルパー関数
function getAuthorBranch(authorName) {
    return '';
}

// 工事(schedules)の担当支店を特定するヘルパー関数
function getProjectBranch(projectName) {
    return '';
}


// DOM要素
const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const btnLogout = document.getElementById('btn-logout');

// 通知設定とFCMトークンの取得・保存
const setupNotification = async () => {
    if (!currentUser || !currentCompany) return;
    if (!messaging) {
        console.log('Notification setup skipped: Messaging is not supported or initialized.');
        return;
    }
    
    try {
        console.log('Requesting notification permission...');
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('Notification permission not granted.');
            return;
        }

        // Service Workerの登録
        const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        console.log('Service Worker registered. Scope:', registration.scope);

        // FCMデバイストークンの取得
        const vapidKey = currentCompany.vapidKey || "BF0d94_Z8_J6N21cZ9tP34U0WpM6v-34U90tS48zNn8P";
        const token = await getToken(messaging, {
            serviceWorkerRegistration: registration,
            vapidKey: vapidKey
        });

        if (token) {
            console.log('FCM Token obtained:', token);
            if (currentCompany.role === 'admin') {
                const tokens = currentCompany.adminFcmTokens || [];
                if (!tokens.includes(token)) {
                    tokens.push(token);
                    await updateDoc(doc(db, "companies", currentCompany.companyId), {
                        adminFcmTokens: tokens
                    });
                    currentCompany.adminFcmTokens = tokens;
                    console.log('Admin FCM Token saved to Firestore.');
                }
            } else {
                // 一般社員のトークン保存
                const employees = currentCompany.employees || [];
                let isUpdated = false;
                const updatedEmployees = employees.map(emp => {
                    if (emp.uid === currentUser.uid || emp.email === currentUser.email) {
                        const tokens = emp.fcmTokens || [];
                        if (!tokens.includes(token)) {
                            tokens.push(token);
                            isUpdated = true;
                            return { ...emp, fcmTokens: tokens };
                        }
                    }
                    return emp;
                });
                
                if (isUpdated) {
                    await updateDoc(doc(db, "companies", currentCompany.companyId), {
                        employees: updatedEmployees
                    });
                    currentCompany.employees = updatedEmployees;
                    console.log('Employee FCM Token saved to Firestore.');
                }
            }
        } else {
            console.warn('No FCM token obtained.');
        }
    } catch (error) {
        console.error('Error during FCM setup:', error);
    }
};

// 認証状態の監視をセットアップする関数
function setupAuthListener() {
    onAuthStateChanged(auth, async (user) => {
        authStateGeneration++;
        const currentGeneration = authStateGeneration;
        showDebugLog("5. onAuthStateChanged triggered (gen: " + currentGeneration + "). User logged in: " + (user ? user.email : "NO_USER"));
        
        try {
            const loadingContainer = document.getElementById('loading-container');

            if (user) {
                const isDeveloper = user && (
                    (user.email && user.email.toLowerCase().trim() === 'steelworks@areva.co.jp') ||
                    (user.uid === 'uQ2CTFIUMha6kxbXOWrpnIDjeRq2')
                );

                // 開発者アカウントの場合は、他のチェックをすべてスキップして即座に管理画面へ遷移
                if (isDeveloper) {
                    showDebugLog("Developer account detected. Redirecting to system-admin.html...");
                    window.location.href = "system-admin.html";
                    return;
                }

                // メールアドレスが一時的にロードされていない場合は処理を保留
                if (user.email === undefined || user.email === null) {
                    showDebugLog("onAuthStateChanged: user.email is not loaded yet. Waiting...");
                    return;
                }

                // メールアドレスの不一致チェック (email パラメータがある場合)
                if (paramTargetEmail && user.email !== paramTargetEmail) {
                    showDebugLog(`Session email mismatch: Logged in as ${user.email}, expected: ${paramTargetEmail}. Forcing logout.`);
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    
                    const emailInput = document.getElementById('login-email');
                    if (emailInput) emailInput.value = paramTargetEmail;
                    
                    if (loadingContainer) loadingContainer.classList.add('hidden');
                    return;
                }

                // displayNameがまだ反映されていない場合に備えて再読み込み
                if (!user.displayName) {
                    try { 
                        showDebugLog("Reloading user profile...");
                        await user.reload(); 
                        user = auth.currentUser; 
                    } catch(e) {
                        showDebugLog("User reload failed: " + e.message);
                    }
                }

                // 世代チェック：非同期処理の間に次のonAuthStateChangedが走っていたら中断
                if (currentGeneration !== authStateGeneration) {
                    showDebugLog("onAuthStateChanged: Generation changed after user reload. Aborting (gen: " + currentGeneration + ").");
                    return;
                }

                // メールアドレス確認が完了しているかチェック（特定のテスト用・管理者アドレスはバイパス）
                const isBypassEmail = user.email.includes('oowada') || 
                                      user.email.includes('dai-wada') || 
                                      user.email.includes('daiwada') || 
                                      user.email === '1105yuky00109@gmail.com' ||
                                      user.email === '1105yuky00109-web@github.com';
                                      
                if (!user.emailVerified && !isBypassEmail) {
                    showDebugLog("User email is not verified. Logging out.");
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    
                    const errorMsg = document.getElementById('login-error');
                    if (errorMsg) {
                        errorMsg.classList.remove('hidden');
                        errorMsg.textContent = 'メールアドレスの確認が完了していません。登録時に送信された案内メールのリンクをクリックしてアカウントを有効化した後、ログインしてください。';
                    }
                    if (loadingContainer) loadingContainer.classList.add('hidden');
                    return;
                }

                // ログイン成功時
                currentUser = auth.currentUser;
                if (currentUser && currentUser.email && currentUser.email.toLowerCase().trim() === 'steelworks@areva.co.jp') {
                    showDebugLog("Developer account detected in app.html. Redirecting to system-admin.html...");
                    window.location.href = "system-admin.html";
                    return;
                }
                
                // 所属会社の解決
                showDebugLog("Resolving company for: " + currentUser.email);
                const resolvedCompany = await resolveUserCompany(currentUser.email, currentUser.uid);
                
                // 世代チェック
                if (currentGeneration !== authStateGeneration) {
                    showDebugLog("onAuthStateChanged: Generation changed after resolveUserCompany. Aborting (gen: " + currentGeneration + ").");
                    return;
                }

                if (!resolvedCompany) {
                    showDebugLog("No company resolved for user. Logging out.");
                    // 所属会社が解決できない未登録ユーザーは強制ログアウトしてエラー表示
                    await signOut(auth);
                    if (currentGeneration !== authStateGeneration) return;
                    
                    const errorMsg = document.getElementById('login-error');
                    if (errorMsg) {
                        errorMsg.classList.remove('hidden');
                        errorMsg.textContent = 'このメールアドレスはシステムに登録されていません。管理者にお問い合わせください。';
                    }
                    if (loadingContainer) loadingContainer.classList.add('hidden');
                    return;
                }
                
                currentCompany = resolvedCompany;
                showDebugLog("Company resolved: " + currentCompany.companyId + ", role: " + currentCompany.role);
                
                // 契約プランバッジとプラン変更ボタンはヘッダーからは常に非表示にする（⚙️設定モーダル内に集約するため）
                const planStatusBadge = document.getElementById('plan-status-badge');
                const currentPlanLimit = document.getElementById('current-plan-limit');
                const btnChangePlan = document.getElementById('btn-change-plan');
                
                if (planStatusBadge) planStatusBadge.style.display = 'none';
                if (btnChangePlan) btnChangePlan.style.display = 'none';
                
                if (currentCompany && currentCompany.role === 'admin') {
                    if (currentPlanLimit) {
                        const maxUsers = currentCompany.maxUsers || 10;
                        currentPlanLimit.textContent = maxUsers;
                    }
                }

                const myEmpInfo = currentCompany.employees ? currentCompany.employees.find(e => e.uid === currentUser.uid || e.email === currentUser.email) : null;
                
                // ユーザー名の決定と表示
                let userNameToShow = currentUser.displayName || currentUser.email;
                if (myEmpInfo && myEmpInfo.name) {
                    userNameToShow = myEmpInfo.name;
                }
                document.getElementById('current-user-email').textContent = userNameToShow;
                
                const compLabel = document.getElementById('current-company-name');
                if (compLabel) {
                    let compText = currentCompany.companyName || currentCompany.companyId;
                    compLabel.textContent = compText;
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
                showDebugLog("Populating member dropdowns...");
                populateMemberDropdowns();
                showDebugLog("Member dropdowns populated. Populating branch dropdowns...");
                populateBranchDropdowns();
                showDebugLog("Branch dropdowns populated.");

                const safeLoadAll = async () => {
                    showDebugLog("6. safeLoadAll started.");
                    try {
                        if (typeof window.loadSchedules === 'function') {
                            showDebugLog("Loading schedules...");
                            await window.loadSchedules();
                        }
                        if (typeof window.loadReports === 'function') {
                            showDebugLog("Loading reports...");
                            await window.loadReports(false);
                        }
                        
                        // 管理者関連のタブはヘッダーからは常に非表示（管理者設定モーダルからのみ遷移させるため）
                        const empTab = document.getElementById('tab-employee-manage');
                        const vendorTab = document.getElementById('tab-vendor-hidden');
                        const configTab = document.querySelector('.tab-btn[data-target="qualifications-view"]');
                        const registerTab = document.querySelector('.tab-btn[data-target="schedule-input-view"]');

                        if (empTab) empTab.style.display = 'none';
                        if (vendorTab) vendorTab.style.display = 'none';
                        if (configTab) configTab.style.display = 'none';
                        if (registerTab) registerTab.style.display = 'none';

                        if (currentCompany && currentCompany.role === 'admin') {
                            setTimeout(() => {
                                initEmployeeManagePanel();
                                initVendorManagePanel();
                            }, 200);
                        }
                        
                        // 世代チェック
                        if (currentGeneration !== authStateGeneration) {
                            showDebugLog("safeLoadAll: Generation changed during data loading. Aborting.");
                            return;
                        }
                        showDebugLog("Setting up notifications...");
                        setupNotification();
                        if ('clearAppBadge' in navigator) {
                            navigator.clearAppBadge().catch(err => console.error('Failed to clear app badge:', err));
                        }
                        showDebugLog("safeLoadAll completed successfully.");
                    } catch (loadError) {
                        console.error("CRITICAL LOAD ERROR:", loadError);
                        showDebugLog("CRITICAL LOAD ERROR: " + loadError.message);
                        alert("データ読み込みエラーが発生しました:\n" + loadError.stack + "\n\nメッセージ: " + loadError.message);
                        const loadingContainer = document.getElementById('loading-container');
                        if (loadingContainer) loadingContainer.classList.add('hidden');
                    }
                };
                if (document.readyState === 'loading') {
                    showDebugLog("Waiting for DOMContentLoaded to trigger safeLoadAll...");
                    document.addEventListener('DOMContentLoaded', safeLoadAll, { once: true });
                } else {
                    showDebugLog("DOM already loaded, running safeLoadAll directly...");
                    await safeLoadAll();
                }

                // 管理者の場合は社員管理パネルを初期化、社員の場合は非表示を確実にする
                const empTab = document.getElementById('tab-employee-manage');
                const configTab = document.querySelector('.tab-btn[data-target="qualifications-view"]');
                const registerTab = document.querySelector('.tab-btn[data-target="schedule-input-view"]');

                // 管理者関連のタブはヘッダーからは常に非表示（管理者設定モーダルからのみ遷移させるため）
                if (empTab) empTab.style.display = 'none';
                const vendorTab = document.getElementById('tab-vendor-hidden');
                if (vendorTab) vendorTab.style.display = 'none';
                if (configTab) configTab.style.display = 'none';
                if (registerTab) registerTab.style.display = 'none';

                if (currentCompany && currentCompany.role === 'admin') {
                    setTimeout(() => {
                        initEmployeeManagePanel();
                        initVendorManagePanel();
                    }, 200);
                } else {
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
                    
                    // パスワードを忘れて再設定リンクから変更してきた場合は、強制変更をスキップして自動でFirestoreのフラグを消去する
                    if (localStorage.getItem('password_reset_just_done') === 'true' || 
                        (currentUser && (currentUser.email.includes('oowada') || currentUser.email.includes('dai-wada') || currentUser.email.includes('daiwada') || currentUser.displayName === '大和田 三郎'))) {
                        
                        localStorage.removeItem('password_reset_just_done');
                        if (myEmpInfo && myEmpInfo.mustChangePassword === true) {
                            try {
                                const employees = currentCompany.employees || [];
                                const updatedEmployees = employees.map(emp => {
                                    if (emp.uid === currentUser.uid) {
                                        const newEmp = { ...emp };
                                        delete newEmp.mustChangePassword;
                                        return newEmp;
                                    }
                                    return emp;
                                });
                                const compDocRef = doc(db, "companies", currentCompany.companyId);
                                updateDoc(compDocRef, { employees: updatedEmployees }).then(() => {
                                    console.log('mustChangePassword flag cleared automatically for Oowada Saburo.');
                                });
                                myEmpInfo.mustChangePassword = false;
                            } catch (e) {
                                console.error('Failed to auto-clear mustChangePassword flag:', e);
                            }
                        }
                    }

                    // 【救済措置】一時的にパスワード変更モーダルの表示を完全に強制無効化
                    passModal.style.display = 'none';
                    // 表示不整合を防止するため、ログイン完了直後に日報入力タブを強制的に再選択（クリック）させる
                    const defaultTab = document.querySelector('.tab-btn[data-target="daily-report-input-view"]');
                    if (defaultTab) {
                        showDebugLog("Triggering initial tab click...");
                        defaultTab.click();
                    }
                    showDebugLog("7. Hiding loadingContainer (User log-in flow).");
                    if (loadingContainer) loadingContainer.classList.add('hidden');
                } else {
                    showDebugLog("7. passModal not found or currentCompany not set.");
                    if (loadingContainer) loadingContainer.classList.add('hidden');
                }
            } else {
                // ログアウト状態
                showDebugLog("5. User is logged out.");
                currentUser = null;
                currentCompany = null;
                showDebugLog("7. Hiding loadingContainer (User log-out flow).");
                if (loadingContainer) loadingContainer.classList.add('hidden');
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
        } catch (authError) {
            console.error("CRITICAL AUTH ERROR:", authError);
            showDebugLog("CRITICAL AUTH ERROR: " + authError.message);
            alert("認証状態監視でエラーが発生しました:\n" + authError.stack + "\n\nメッセージ: " + authError.message);
            const loadingContainer = document.getElementById('loading-container');
            if (loadingContainer) loadingContainer.classList.add('hidden');
        }
    });
}

// アプリケーションの初期化
const initApp = async () => {
    showDebugLog("3. Initializing App state...");
    const urlParams = new URLSearchParams(window.location.search);
    const isForceLogout = urlParams.get('logout') === 'true';
    
    if (isForceLogout) {
        showDebugLog("Detecting logout=true parameter, logging out current session before app initialization...");
        try {
            await signOut(auth);
            showDebugLog("Successfully logged out due to logout=true.");
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
    
    // URLのクレンジング (クエリパラメータを消去して履歴を書き換える)
    if (window.location.search) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
    
    showDebugLog("4. Setting up Auth listener...");
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
                // auth-action.html を再設定ページとして指定
                url: 'https://weekly-report-93e5f.web.app/',
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
                resetError.textContent = 'メールの送信に失敗しました。しばらくしてから再度お試しください。';
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
    // tab.style.display = '';

    const empAddForm = document.getElementById('employee-add-form');
    if (empAddForm) {
        empAddForm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
            }
        });
    }
    const empAddMsg = document.getElementById('emp-add-message');
    const empListTbody = document.getElementById('employee-list-tbody');
    const empCancelBtn = document.getElementById('btn-emp-cancel-edit');
    const empFormTitle = document.getElementById('employee-form-title');
    const empSubmitBtn = empAddForm ? empAddForm.querySelector('button[type="submit"]') : null;
    const empOriginalNameInput = document.getElementById('emp-edit-original-name');

    // 登録フォームをリセットして通常モードに戻す関数
    const resetEmployeeForm = () => {
        // form.reset() を使用すると、一部のブラウザや端末で日本語かな入力モードが英数字にリセットされてしまうため、
        // 各入力欄の値を個別にクリアして、日本語（かな）入力の状態を維持します。
        const nameInp = document.getElementById('emp-name');
        const joinInp = document.getElementById('emp-join-date');
        const ageInp = document.getElementById('emp-age');
        const natInp = document.getElementById('emp-nationality');
        const statusInp = document.getElementById('emp-status-class');
        const salaryInp = document.getElementById('emp-monthly-salary');

        if (nameInp) nameInp.value = '';
        if (joinInp) joinInp.value = '';
        if (ageInp) ageInp.value = '';
        if (natInp) natInp.value = '日本';
        if (statusInp) statusInp.value = '該当なし';
        if (salaryInp) salaryInp.value = '';

        if (empOriginalNameInput) empOriginalNameInput.value = '';
        if (empFormTitle) empFormTitle.textContent = '新しい社員を追加';
        if (empSubmitBtn) {
            empSubmitBtn.textContent = '社員を追加';
            empSubmitBtn.classList.remove('btn-secondary');
            empSubmitBtn.classList.add('btn-primary');
        }
        if (empCancelBtn) empCancelBtn.style.display = 'none';

        // 連続入力をスムーズにするため、登録完了後に自動で氏名入力欄にフォーカスを当てます
        if (nameInp) {
            nameInp.focus();
        }
    };

    // キャンセルボタンのクリックイベント
    if (empCancelBtn) {
        empCancelBtn.onclick = () => {
            resetEmployeeForm();
            if (empAddMsg) empAddMsg.classList.add('hidden');
        };
    }

    // 登録済み社員一覧を描画する関数
    const renderEmployeeList = () => {
        if (!empListTbody) return;
        const employees = currentCompany.employees || [];
        
        // 社員数
        const countBadge = document.getElementById('emp-count-badge');
        if (countBadge) {
            countBadge.textContent = `（現在: ${employees.length}名登録済み）`;
        }

        if (employees.length === 0) {
            empListTbody.innerHTML = `
                <tr>
                    <td colspan="7" style="padding: 20px; text-align: center; color: var(--text-muted, #64748b);">登録されている社員はいません。</td>
                </tr>
            `;
            return;
        }
        
        // 登録日順（降順）でソート
        const sorted = [...employees].sort((a, b) => (b.createdAt || '') > (a.createdAt || '') ? 1 : -1);
        empListTbody.innerHTML = sorted.map((emp, idx) => {
            const bg = idx % 2 ? 'var(--bg-muted, #f8fafc)' : '#fff';
            const joinDate = emp.joinDate || '-';
            const age = emp.age ? `${emp.age} 歳` : '-';
            const nationality = emp.nationality || '-';
            const statusClass = emp.statusClass || '-';
            const monthlySalary = emp.monthlySalary ? `¥${Number(emp.monthlySalary).toLocaleString()}` : '-';

            return `
                <tr style="background: ${bg}; border-bottom: 1px solid var(--border);">
                    <td style="padding: 10px 12px; font-weight: bold; color: var(--text-main, #1e293b);">${emp.name}</td>
                    <td style="padding: 10px 12px; color: var(--text-muted, #64748b);">${joinDate}</td>
                    <td style="padding: 10px 12px; text-align: center; color: var(--text-muted, #64748b);">${age}</td>
                    <td style="padding: 10px 12px; text-align: center; color: var(--text-muted, #64748b);">${nationality}</td>
                    <td style="padding: 10px 12px; color: var(--text-muted, #64748b);">${statusClass}</td>
                    <td style="padding: 10px 12px; text-align: right; color: var(--text-muted, #64748b); font-weight: 500;">${monthlySalary}</td>
                    <td style="padding: 10px 12px; text-align: center; display: flex; gap: 6px; justify-content: center;">
                        <button class="btn-edit-employee btn btn-secondary btn-small" data-name="${emp.name.replace(/"/g, '&quot;')}" style="padding: 4px 8px; font-size: 0.75rem; cursor: pointer;">編集</button>
                        <button class="btn-delete-employee btn btn-danger btn-small" data-name="${emp.name.replace(/"/g, '&quot;')}" style="background:#ef4444; color:white; border:none; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer;">削除</button>
                    </td>
                </tr>
            `;
        }).join('');

        // イベントリスナーの登録
        empListTbody.querySelectorAll('.btn-edit-employee').forEach(btn => {
            btn.onclick = () => {
                const name = btn.dataset.name;
                const emp = employees.find(e => e.name === name);
                if (!emp) return;

                // フォームに値をセット
                document.getElementById('emp-name').value = emp.name;
                document.getElementById('emp-join-date').value = emp.joinDate || '';
                document.getElementById('emp-age').value = emp.age || '';
                document.getElementById('emp-nationality').value = emp.nationality || '日本';
                document.getElementById('emp-status-class').value = emp.statusClass || '該当なし';
                if (document.getElementById('emp-monthly-salary')) {
                    document.getElementById('emp-monthly-salary').value = emp.monthlySalary || '';
                }

                // 編集モードUIに切り替え
                if (empOriginalNameInput) empOriginalNameInput.value = emp.name;
                if (empFormTitle) empFormTitle.textContent = `社員「${emp.name}」の情報を編集`;
                if (empSubmitBtn) {
                    empSubmitBtn.textContent = '情報を更新';
                    empSubmitBtn.classList.remove('btn-primary');
                    empSubmitBtn.classList.add('btn-secondary');
                }
                if (empCancelBtn) empCancelBtn.style.display = 'inline-block';
                if (empAddMsg) empAddMsg.classList.add('hidden');
                
                // フォームトップへスクロール
                if (empAddForm) {
                    empAddForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            };
        });

        empListTbody.querySelectorAll('.btn-delete-employee').forEach(btn => {
            btn.onclick = async () => {
                const nameToDelete = btn.dataset.name;
                if (confirm(`社員「${nameToDelete}」を削除しますか？\n（日報データ自体は削除されませんが、選択肢から消えます）`)) {
                    // ローカルから即座に削除して描画を更新（楽観的アップデート）
                    const originalEmployees = [...(currentCompany.employees || [])];
                    const updatedEmployees = originalEmployees.filter(emp => emp.name !== nameToDelete);
                    currentCompany.employees = updatedEmployees;
                    renderEmployeeList();
                    populateMemberDropdowns();

                    try {
                        // 最新の情報をロードしてマージの上、Firestoreを更新
                        await loadLatestCompanyInfo();
                        const latestEmployees = currentCompany.employees || [];
                        const finalEmployees = latestEmployees.filter(emp => emp.name !== nameToDelete);

                        const compDocRef = doc(db, "companies", currentCompany.companyId);
                        await updateDoc(compDocRef, { employees: finalEmployees });
                        currentCompany.employees = finalEmployees;

                        renderEmployeeList();
                        populateMemberDropdowns();

                        if (typeof showToast === 'function') {
                            showToast(`社員「${nameToDelete}」を削除しました。`, 'success');
                        }
                    } catch (err) {
                        console.error("Error deleting employee:", err);
                        // エラー時はロールバックして再描画
                        currentCompany.employees = originalEmployees;
                        renderEmployeeList();
                        populateMemberDropdowns();
                        alert(`削除に失敗しました: ${err.message}`);
                    }
                }
            };
        });
    };

    // タブクリック時の追加処理
    tab.addEventListener('click', () => {
        loadLatestCompanyInfo().then(() => {
            renderEmployeeList();
            populateMemberDropdowns();
        });
    });

    // 社員追加・更新フォーム送信処理
    if (empAddForm) {
        empAddForm.onsubmit = async (e) => {
            e.preventDefault();
            empAddMsg.className = 'message';
            empAddMsg.textContent = '登録中...';
            empAddMsg.classList.remove('hidden');

            const name = document.getElementById('emp-name').value.trim();
            const joinDate = document.getElementById('emp-join-date').value;
            const ageInput = document.getElementById('emp-age').value;
            const age = ageInput ? parseInt(ageInput, 10) : '';
            const nationality = document.getElementById('emp-nationality').value;
            const statusClass = document.getElementById('emp-status-class').value;
            const salaryInput = document.getElementById('emp-monthly-salary') ? document.getElementById('emp-monthly-salary').value : '';
            const monthlySalary = salaryInput ? parseInt(salaryInput, 10) : '';

            const editOrigName = empOriginalNameInput ? empOriginalNameInput.value : '';
            const isEditMode = !!editOrigName;

            try {
                await loadLatestCompanyInfo();
                const employees = currentCompany.employees || [];
                
                let updatedEmployees = [];

                if (isEditMode) {
                    // 編集モード：元の名前と重複をチェック（他者との重複）
                    if (employees.some(emp => emp.name === name && emp.name !== editOrigName)) {
                        throw new Error(`同名の社員「${name}」が既に他に登録されています。`);
                    }

                    updatedEmployees = employees.map(emp => {
                        if (emp.name === editOrigName) {
                            return {
                                ...emp,
                                name,
                                joinDate,
                                age,
                                nationality,
                                statusClass,
                                monthlySalary
                            };
                        }
                        return emp;
                    });
                } else {
                    // 新規登録モード：契約上限チェック
                    const maxUsers = currentCompany.maxUsers || 10;
                    if (employees.length >= maxUsers) {
                        throw new Error(`ご契約プランの上限数（最大 ${maxUsers} 名）に達しているため、新しい社員を追加できません。`);
                    }

                    // 重複チェック
                    if (employees.some(emp => emp.name === name)) {
                        throw new Error(`同名の社員「${name}」が既に登録されています。`);
                    }

                    const newEmpObj = {
                        name,
                        joinDate,
                        age,
                        nationality,
                        statusClass,
                        monthlySalary,
                        createdAt: new Date().toISOString()
                    };
                    updatedEmployees = [...employees, newEmpObj];
                }
                
                const compDocRef = doc(db, "companies", currentCompany.companyId);
                await updateDoc(compDocRef, { employees: updatedEmployees });
                currentCompany.employees = updatedEmployees;

                empAddMsg.className = 'message success';
                empAddMsg.textContent = isEditMode ? `社員「${name}」の情報を更新しました！` : `社員「${name}」を正常に登録しました！`;
                resetEmployeeForm();

                renderEmployeeList();
                populateMemberDropdowns();
            } catch (err) {
                console.error(err);
                empAddMsg.className = 'message error';
                empAddMsg.textContent = `処理に失敗しました: ${err.message}`;
            }
        };
    }

    renderEmployeeList();
}

// 🏢 仕入れ業者管理パネルの初期化
async function initVendorManagePanel() {
    if (!currentUser || !currentCompany || currentCompany.role !== 'admin') return;

    const tab = document.getElementById('tab-vendor-hidden');
    if (!tab) return;

    const vendorAddForm = document.getElementById('vendor-add-form');
    if (vendorAddForm) {
        vendorAddForm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
            }
        });
    }

    const vendorAddMsg = document.getElementById('vendor-add-message');
    const vendorListTbody = document.getElementById('vendor-list-tbody');
    const vendorCancelBtn = document.getElementById('btn-vendor-cancel-edit');
    const vendorFormTitle = document.getElementById('vendor-form-title');
    const vendorSubmitBtn = vendorAddForm ? vendorAddForm.querySelector('button[type="submit"]') : null;
    const vendorEditIdInput = document.getElementById('vendor-edit-id');

    // 登録フォームをリセットする関数
    const resetVendorForm = () => {
        const nameInp = document.getElementById('vendor-name');
        const typeInp = document.getElementById('vendor-type');
        const contactInp = document.getElementById('vendor-contact');
        const phoneInp = document.getElementById('vendor-phone');
        const emailInp = document.getElementById('vendor-email');
        const memoInp = document.getElementById('vendor-memo');

        if (nameInp) nameInp.value = '';
        if (typeInp) typeInp.value = 'material';
        if (contactInp) contactInp.value = '';
        if (phoneInp) phoneInp.value = '';
        if (emailInp) emailInp.value = '';
        if (memoInp) memoInp.value = '';

        if (vendorEditIdInput) vendorEditIdInput.value = '';
        if (vendorFormTitle) vendorFormTitle.textContent = '新しい仕入れ業者を追加';
        if (vendorSubmitBtn) {
            vendorSubmitBtn.textContent = '業者を追加';
            vendorSubmitBtn.classList.remove('btn-secondary');
            vendorSubmitBtn.classList.add('btn-primary');
        }
        if (vendorCancelBtn) vendorCancelBtn.style.display = 'none';

        if (nameInp) {
            nameInp.focus();
        }
    };

    // キャンセルボタンのクリックイベント
    if (vendorCancelBtn) {
        vendorCancelBtn.onclick = () => {
            resetVendorForm();
            if (vendorAddMsg) {
                vendorAddMsg.classList.add('hidden');
                vendorAddMsg.textContent = '';
            }
        };
    }

    // 登録済み仕入れ業者一覧をロードして描画する関数
    const loadAndRenderVendors = async () => {
        if (!vendorListTbody) return;
        
        try {
            const vendorsRef = collection(db, "companies", currentCompany.companyId, "vendors");
            const q = query(vendorsRef, orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                vendorListTbody.innerHTML = `
                    <tr>
                        <td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted, #64748b);">登録されている仕入れ業者はいません。</td>
                    </tr>
                `;
                return;
            }

            let html = '';
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const id = docSnap.id;
                const name = data.name || '-';
                
                let typeLabel = 'その他';
                if (data.type === 'material') typeLabel = '材料業者';
                else if (data.type === 'subcontract') typeLabel = '外注業者';
                else if (data.type === 'expense') typeLabel = '経費';

                const contact = data.contact || '-';
                const phone = data.phone || '-';
                const memo = data.memo || '-';

                html += `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 10px; font-weight: bold; color: var(--text-main);">${name}</td>
                        <td style="padding: 10px; color: var(--text-muted);">${typeLabel}</td>
                        <td style="padding: 10px; color: var(--text-muted);">${contact}</td>
                        <td style="padding: 10px; color: var(--text-muted);">${phone}</td>
                        <td style="padding: 10px; color: var(--text-muted);">${memo}</td>
                        <td style="padding: 10px; text-align: center; display: flex; gap: 8px; justify-content: center;">
                            <button class="btn btn-edit-vendor" data-id="${id}" style="padding:4px 8px; font-size:0.8rem; background:#3b82f6; color:white; border:none; border-radius:4px; cursor:pointer;">編集</button>
                            <button class="btn btn-delete-vendor" data-id="${id}" data-name="${name.replace(/"/g, '&quot;')}" style="padding:4px 8px; font-size:0.8rem; background:#ef4444; color:white; border:none; border-radius:4px; cursor:pointer;">削除</button>
                        </td>
                    </tr>
                `;
            });

            vendorListTbody.innerHTML = html;

            // 編集ボタンのイベント
            vendorListTbody.querySelectorAll('.btn-edit-vendor').forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    try {
                        const docRef = doc(db, "companies", currentCompany.companyId, "vendors", id);
                        const docSnap = await getDoc(docRef);
                        if (docSnap.exists()) {
                            const data = docSnap.data();
                            
                            const nameInp = document.getElementById('vendor-name');
                            const typeInp = document.getElementById('vendor-type');
                            const contactInp = document.getElementById('vendor-contact');
                            const phoneInp = document.getElementById('vendor-phone');
                            const emailInp = document.getElementById('vendor-email');
                            const memoInp = document.getElementById('vendor-memo');

                            if (nameInp) nameInp.value = data.name || '';
                            if (typeInp) typeInp.value = data.type || 'material';
                            if (contactInp) contactInp.value = data.contact || '';
                            if (phoneInp) phoneInp.value = data.phone || '';
                            if (emailInp) emailInp.value = data.email || '';
                            if (memoInp) memoInp.value = data.memo || '';

                            if (vendorEditIdInput) vendorEditIdInput.value = id;
                            if (vendorFormTitle) vendorFormTitle.textContent = `仕入れ業者「${data.name}」の情報を編集`;
                            if (vendorSubmitBtn) {
                                vendorSubmitBtn.textContent = '情報を更新';
                                vendorSubmitBtn.classList.remove('btn-primary');
                                vendorSubmitBtn.classList.add('btn-secondary');
                            }
                            if (vendorCancelBtn) vendorCancelBtn.style.display = 'inline-block';
                            if (vendorAddMsg) vendorAddMsg.classList.add('hidden');
                            
                            if (vendorAddForm) {
                                vendorAddForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }
                        }
                    } catch (err) {
                        console.error("Error loading vendor details:", err);
                        alert("詳細データの取得に失敗しました。");
                    }
                };
            });

            // 削除ボタンのイベント
            vendorListTbody.querySelectorAll('.btn-delete-vendor').forEach(btn => {
                btn.onclick = async () => {
                    const id = btn.dataset.id;
                    const name = btn.dataset.name;
                    if (confirm(`本当に仕入れ業者「${name}」を削除しますか？\n（この業者が設定された既存の原価明細データがある場合、プルダウン選択時に不整合が生じる可能性があります）`)) {
                        try {
                            await deleteDoc(doc(db, "companies", currentCompany.companyId, "vendors", id));
                            if (typeof showToast === 'function') {
                                showToast(`仕入れ業者「${name}」を削除しました。`, 'success');
                            }
                            loadAndRenderVendors();
                            
                            // 費用入力側のプルダウン依存関係も更新
                            if (typeof loadCostInputFormDependencies === 'function') {
                                loadCostInputFormDependencies();
                            }
                        } catch (err) {
                            console.error("Error deleting vendor:", err);
                            alert(`削除に失敗しました: ${err.message}`);
                        }
                    }
                };
            });

        } catch (err) {
            console.error("Error rendering vendor list:", err);
            vendorListTbody.innerHTML = `<tr><td colspan="6" style="padding:20px; text-align:center; color:red;">データの読込みに失敗しました。</td></tr>`;
        }
    };

    // タブ選択時のロード
    tab.addEventListener('click', () => {
        loadLatestCompanyInfo().then(() => {
            loadAndRenderVendors();
        });
    });

    // フォーム送信処理（追加・更新）
    if (vendorAddForm) {
        vendorAddForm.onsubmit = async (e) => {
            e.preventDefault();
            if (vendorAddMsg) {
                vendorAddMsg.className = 'message';
                vendorAddMsg.textContent = '登録中...';
                vendorAddMsg.classList.remove('hidden');
            }

            const name = document.getElementById('vendor-name').value.trim();
            const type = document.getElementById('vendor-type').value;
            const contact = document.getElementById('vendor-contact').value.trim();
            const phone = document.getElementById('vendor-phone').value.trim();
            const email = document.getElementById('vendor-email').value.trim();
            const memo = document.getElementById('vendor-memo').value.trim();
            const editId = vendorEditIdInput ? vendorEditIdInput.value : '';
            const isEditMode = !!editId;

            try {
                if (vendorSubmitBtn) vendorSubmitBtn.disabled = true;

                const vendorsRef = collection(db, "companies", currentCompany.companyId, "vendors");

                if (isEditMode) {
                    const docRef = doc(db, "companies", currentCompany.companyId, "vendors", editId);
                    await updateDoc(docRef, {
                        name,
                        type,
                        contact,
                        phone,
                        email,
                        memo,
                        updatedAt: new Date().toISOString()
                    });
                    if (typeof showToast === 'function') {
                        showToast(`仕入れ業者「${name}」の情報を更新しました。`, 'success');
                    }
                    if (vendorAddMsg) {
                        vendorAddMsg.className = 'message success';
                        vendorAddMsg.textContent = `仕入れ業者「${name}」の情報を更新しました！`;
                    }
                } else {
                    // 同名重複チェック
                    const qCheck = query(vendorsRef, where("name", "==", name));
                    const checkSnap = await getDocs(qCheck);
                    if (!checkSnap.empty) {
                        throw new Error(`同名の仕入れ業者「${name}」が既に登録されています。`);
                    }

                    await addDoc(vendorsRef, {
                        name,
                        type,
                        contact,
                        phone,
                        email,
                        memo,
                        createdAt: new Date().toISOString()
                    });
                    if (typeof showToast === 'function') {
                        showToast(`仕入れ業者「${name}」を登録しました。`, 'success');
                    }
                    if (vendorAddMsg) {
                        vendorAddMsg.className = 'message success';
                        vendorAddMsg.textContent = `仕入れ業者「${name}」を正常に登録しました！`;
                    }
                }

                resetVendorForm();
                loadAndRenderVendors();

                // 費用入力側のプルダウン依存関係も更新
                if (typeof loadCostInputFormDependencies === 'function') {
                    loadCostInputFormDependencies();
                }

            } catch (err) {
                console.error(err);
                if (vendorAddMsg) {
                    vendorAddMsg.className = 'message error';
                    vendorAddMsg.textContent = `処理に失敗しました: ${err.message}`;
                }
            } finally {
                if (vendorSubmitBtn) vendorSubmitBtn.disabled = false;
            }
        };
    }

    // 初回ロード
    loadAndRenderVendors();
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
// 工事担当者カラー・描画支援機能
// ============================================================

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

// ============================================================
// 社員ドロップダウン生成機能
// ============================================================

function populateMemberDropdowns() {
    const salesSelect = document.getElementById('sched-sales-rep');
    const constSelect = document.getElementById('sched-const-rep');
    const siteSelect = document.getElementById('sched-site-rep');
    const chiefSelect = document.getElementById('sched-chief-tech');
    const reportMemberSelect = document.getElementById('report-member-select');

    // 選択された値を退避
    const curSales = salesSelect ? salesSelect.value : '';
    const curConst = constSelect ? constSelect.value : '';
    const curSite = siteSelect ? siteSelect.value : '';
    const curChief = chiefSelect ? chiefSelect.value : '';
    const curReportMember = reportMemberSelect ? reportMemberSelect.value : '';

    // プルダウンのクリアと初期化
    const initSelect = (select, emptyText = '選択してください') => {
        if (select) select.innerHTML = `<option value="">${emptyText}</option>`;
    };
    initSelect(salesSelect);
    initSelect(constSelect);
    initSelect(siteSelect);
    initSelect(chiefSelect);
    initSelect(reportMemberSelect, '社員を選択してください');

    // 社員一覧からドロップダウンを追加 (役割分類せず、全社員を対象)
    const employees = currentCompany.employees || [];
    employees.forEach(emp => {
        const optHtml = `<option value="${emp.name}">${emp.name}</option>`;
        if (salesSelect) salesSelect.innerHTML += optHtml;
        if (constSelect) constSelect.innerHTML += optHtml;
        if (siteSelect) siteSelect.innerHTML += optHtml;
        if (chiefSelect) chiefSelect.innerHTML += optHtml;
        if (reportMemberSelect) reportMemberSelect.innerHTML += optHtml;
    });

    // 選択値を復元
    if (salesSelect) salesSelect.value = curSales;
    if (constSelect) constSelect.value = curConst;
    if (siteSelect) siteSelect.value = curSite;
    if (chiefSelect) chiefSelect.value = curChief;
    if (reportMemberSelect) {
        if (curReportMember) {
            reportMemberSelect.value = curReportMember;
        } else if (currentUser) {
            const userDisplayName = currentUser.displayName || currentUser.email.split('@')[0];
            const match = employees.find(e => e.name === userDisplayName);
            if (match) {
                reportMemberSelect.value = match.name;
            }
        }
    }
}



// ログアウト処理
btnLogout.addEventListener('click', () => {
    signOut(auth).catch(err => console.error(err));
});

// トースト通知を表示する関数
const showToast = (message, type = 'success', duration = 5000) => {
    console.log(`[Toast] ${type}: ${message}`);
};
window.showToast = showToast;

// 日別タスクデータを新旧形式問わず配列に正規化するヘルパー関数
const normalizeDailyTasks = (dayLog) => {
    if (!dayLog) return [];
    if (Array.isArray(dayLog)) {
        return dayLog;
    }
    if (typeof dayLog === 'object') {
        const ts = [];
        const labels = { morning: '午前', afternoon: '午後', night: '夜間' };
        ['morning', 'afternoon', 'night'].forEach(period => {
            const sec = dayLog[period];
            if (sec && (sec.project || sec.detail)) {
                // timelineから時間数を計算 (午前: 0-7, 午後: 10-17, 夜間: 18以降)
                let h = 0;
                const tl = dayLog.timeline || '';
                if (tl) {
                    if (period === 'morning') {
                        h = tl.substring(0, 8).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    } else if (period === 'afternoon') {
                        h = tl.substring(10, 18).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    } else if (period === 'night') {
                        h = tl.substring(18).split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    }
                }
                ts.push({
                    project: sec.project,
                    detail: sec.detail,
                    hours: h,
                    timeline: dayLog.timeline || '',
                    period: period,
                    periodLabel: labels[period]
                });
            }
        });
        
        // もし各periodの時間がすべて0で、全体にtimelineがある場合は従来のフォールバック
        let totalH = ts.reduce((sum, t) => sum + t.hours, 0);
        if (totalH === 0 && ts.length > 0) {
            const tl = dayLog.timeline || '';
            const totalWorkHours = tl ? tl.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5 : 0;
            ts[0].hours = totalWorkHours;
        }

        if (dayLog.leaveType) {
            ts.push({
                project: dayLog.leaveType,
                detail: '',
                hours: 0,
                timeline: '',
                period: 'leave',
                periodLabel: '休暇等'
            });
        }
        return ts;
    }
    return [];
};

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
            const h = (Math.floor(idx / 2) + 5) % 24; // 5:00起点
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
                const isCurrent = weekStr === currentWeekStr;
                options.push({
                    value: weekStr,
                    text: `${sy}年 ${m}/${d} 〜 ${sm}/${sd} の週${isCurrent ? ' (今週)' : ''}`
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
            el.style.color = '#ef4444';      // 現在週を赤字
            el.style.fontWeight = 'bold';    // 太字
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
    // 未保存変更の追跡変数と検知用ロジック
    let lastSavedDataString = '';
    let lastSelectedWeek = '';

    const getUnsavedData = () => {
        const dailyLogs = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.getCardData) {
                dailyLogs[day] = taskList.getCardData();
            } else {
                dailyLogs[day] = { morning: {project:'',detail:'',report:''}, afternoon: {project:'',detail:'',report:''}, night: {project:'',detail:'',report:''}, timeline: '', leaveType: '' };
            }
        });

        const dailyReports = {};
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`)?.closest('.day-card');
            if (dayCard) {
                const mrVal = dayCard.querySelector('.morning-report')?.value.trim() || '';
                const arVal = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
                const nrVal = dayCard.querySelector('.night-report')?.value.trim() || '';
                const reports = [];
                if (mrVal) reports.push(`【午前】${mrVal}`);
                if (arVal) reports.push(`【午後】${arVal}`);
                if (nrVal) reports.push(`【夜間】${nrVal}`);
                dailyReports[day] = reports.join('\n');
            } else {
                dailyReports[day] = '';
            }
        });
        return { dailyLogs, dailyReports };
    };

    const checkUnsavedChanges = () => {
        // 保存ボタンが画面上に存在しない場合は無条件で保存警告をスキップ
        const hasSaveButtons = document.getElementById('btn-save-plan') || document.getElementById('btn-save-actual');
        if (!hasSaveButtons) {
            return false;
        }

        // 予定も実績も編集不可（ロック状態）のときは、保存警告をスキップ
        if (!currentIsPlanEditable && !currentIsActualEditable) {
            return false;
        }
        // 現在のフォームロック状態（上長承認済みの場合は編集できないため、変更チェックしない）
        const badge = document.getElementById('report-status-badge');
        const isApproved = badge && (badge.classList.contains('status-approved') || badge.dataset.actualStatus === 'approved');
        if (isApproved) return false;

        const currentDataStr = JSON.stringify(getUnsavedData());
        return lastSavedDataString && currentDataStr !== lastSavedDataString;
    };

    // 保存忘れ防止のプレミアム確認モーダルの表示
    const showUnsavedChangesModal = ({ onSaveAndLeave, onLeaveWithoutSaving, onCancel }) => {
        const existing = document.getElementById('unsaved-changes-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'unsaved-changes-modal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            font-family: inherit;
        `;

        modal.innerHTML = `
            <div style="
                background: var(--bg-card, #ffffff);
                color: var(--text, #000000);
                padding: 24px;
                border-radius: 12px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.15);
                max-width: 440px;
                width: 90%;
                border: 1px solid var(--border, #e2e8f0);
                animation: unsavedModalScale 0.2s ease-out;
            ">
                <h3 style="margin-top: 0; font-size: 1.15rem; font-weight: bold; display: flex; align-items: center; gap: 8px;">
                    ⚠️ 編集中のデータがあります
                </h3>
                <p style="margin: 16px 0 24px; font-size: 0.9rem; line-height: 1.5; color: var(--text-muted, #475569);">
                    実績（予定）の変更内容が保存されていません。移動する前に現在の内容を保存しますか？
                </p>
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    <button id="unsaved-save-btn" style="
                        padding: 10px 16px;
                        background: var(--primary, #2563eb);
                        color: white;
                        border: none;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        font-weight: bold;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">はい、保存して移動する</button>
                    
                    <button id="unsaved-discard-btn" style="
                        padding: 10px 16px;
                        background: #f1f5f9;
                        color: #475569;
                        border: 1px solid #e2e8f0;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        font-weight: bold;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">保存せずに移動する</button>
                    
                    <button id="unsaved-cancel-btn" style="
                        padding: 10px 16px;
                        background: transparent;
                        color: #64748b;
                        border: none;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        cursor: pointer;
                    ">キャンセル（編集を続ける）</button>
                </div>
            </div>
            <style>
                @keyframes unsavedModalScale {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                #unsaved-save-btn:hover { background: #1d4ed8 !important; }
                #unsaved-discard-btn:hover { background: #e2e8f0 !important; }
                #unsaved-cancel-btn:hover { text-decoration: underline; }
            </style>
        `;

        document.body.appendChild(modal);

        const cleanup = () => modal.remove();

        document.getElementById('unsaved-save-btn').onclick = () => {
            cleanup();
            onSaveAndLeave();
        };
        document.getElementById('unsaved-discard-btn').onclick = () => {
            cleanup();
            onLeaveWithoutSaving();
        };
        document.getElementById('unsaved-cancel-btn').onclick = () => {
            cleanup();
            onCancel();
        };
    };

    const weekInput = document.getElementById('week');
    const weekDisplayHint = document.getElementById('week-display-hint');
    if (weekInput) {
        generateWeekOptions();
        if (!weekInput.value) {
            weekInput.value = getISOWeekString(new Date());
        }
        weekDisplayHint.textContent = weekInput.value ? formatWeekRange(weekInput.value) + ' の報告' : '';
        
        weekInput.addEventListener('change', async () => {
            const nextWeek = weekInput.value;
            if (nextWeek === lastSelectedWeek) return;

            if (checkUnsavedChanges()) {
                // 一旦セレクトボックスの表示を元の値に戻す
                weekInput.value = lastSelectedWeek;
                
                showUnsavedChangesModal({
                    onSaveAndLeave: async () => {
                        // 現在のステータスを判定して元の週で保存
                        const badge = document.getElementById('report-status-badge');
                        let status = 'plan';
                        if (badge) {
                            if (badge.dataset.status) status = badge.dataset.status;
                            else if (badge.classList.contains('status-approved')) status = 'approved';
                            else if (badge.classList.contains('status-confirmed')) status = 'confirmed';
                        }
                        
                        await saveReport(status);

                        // 保存完了後に移動先へ遷移
                        lastSelectedWeek = nextWeek;
                        weekInput.value = nextWeek;
                        weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                        updateDayLabels();
                        loadReportForSelectedWeek();
                    },
                    onLeaveWithoutSaving: () => {
                        // 保存せずに遷移
                        lastSelectedWeek = nextWeek;
                        weekInput.value = nextWeek;
                        weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                        updateDayLabels();
                        loadReportForSelectedWeek();
                    },
                    onCancel: () => {
                        // キャンセル（週の値はすでに戻されているので何もしない）
                    }
                });
            } else {
                lastSelectedWeek = nextWeek;
                weekDisplayHint.textContent = nextWeek ? formatWeekRange(nextWeek) + ' の報告' : '';
                updateDayLabels();
                loadReportForSelectedWeek();
            }
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



    // タブ切り替え
    const tabBtns = document.querySelectorAll('.tab-btn');
    const views = document.querySelectorAll('.view');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const currentActiveTab = document.querySelector('.tab-btn.active');
            const isLeavingInputView = currentActiveTab && currentActiveTab.dataset.target === 'schedule-input-view';
            const isClickingCurrent = currentActiveTab === btn;

            if (isClickingCurrent) return;

            const executeTabSwitch = () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                views.forEach(v => v.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.target).classList.add('active');
                
                // 出退勤画面の時計制御
                if (btn.dataset.target === 'attendance-view') {
                    startAttendanceClock();
                    populateAttendanceMemberDropdown();
                } else {
                    stopAttendanceClock();
                }

                // 出退勤管理（管理者用）画面のロード
                if (btn.dataset.target === 'attendance-admin-view') {
                    initAttendanceAdminFilters();
                    loadAttendanceAdminData();
                }

                if (btn.dataset.target === 'gantt-view' || btn.dataset.target === 'summary-view') {
                    document.body.classList.add('print-a3-landscape');
                    if (btn.dataset.target === 'gantt-view') loadSchedules();
                    if (btn.dataset.target === 'summary-view') loadReports(true);
                } else {
                    document.body.classList.remove('print-a3-landscape');
                    if (btn.dataset.target === 'list-view') loadReports(false);
                    if (btn.dataset.target === 'daily-report-total-view') {
                        if (typeof renderDailyReportTotal === 'function') {
                            renderDailyReportTotal();
                        }
                    }
                }
            };

            if (isLeavingInputView && checkUnsavedChanges()) {
                showUnsavedChangesModal({
                    onSaveAndLeave: async () => {
                        const badge = document.getElementById('report-status-badge');
                        let status = 'plan';
                        if (badge) {
                            if (badge.dataset.status) status = badge.dataset.status;
                            else if (badge.classList.contains('status-approved')) status = 'approved';
                            else if (badge.classList.contains('status-confirmed')) status = 'confirmed';
                        }
                        await saveReport(status);
                        executeTabSwitch();
                    },
                    onLeaveWithoutSaving: () => {
                        executeTabSwitch();
                    },
                    onCancel: () => {
                        // キャンセル
                    }
                });
            } else {
                executeTabSwitch();
            }
        });
    });

    // ブラウザのタブ閉じ・リロード時の警告
    window.addEventListener('beforeunload', (e) => {
        if (checkUnsavedChanges()) {
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // フォーム制御関数 (一括 disabled化/活性化)
    // フォーム制御関数 (予定・実績のステータスに応じたきめ細かい制御)
    const setFormLocked = (pStatus, aStatus) => {
        let planStatus = 'draft';
        let actualStatus = 'uncreated';

        if (typeof pStatus === 'boolean') {
            if (pStatus) {
                planStatus = 'approved';
                actualStatus = 'approved';
            } else {
                planStatus = 'draft';
                actualStatus = 'uncreated';
            }
        } else {
            planStatus = pStatus || 'draft';
            actualStatus = aStatus || 'uncreated';
        }

        const isPlanEditable = (planStatus === 'draft' || planStatus === 'rejected');
        const isActualEditable = (planStatus === 'approved' && (actualStatus === 'draft' || actualStatus === 'rejected' || actualStatus === 'uncreated'));
        currentIsPlanEditable = isPlanEditable;
        currentIsActualEditable = isActualEditable;

        const form = document.getElementById('report-form');
        if (!form) return;

        // 全てロックされているか（予定も実績も編集不可か）のトグル
        const isAllLocked = !isPlanEditable && !isActualEditable;
        form.classList.toggle('form-locked', isAllLocked);

        // 予定関連のインプット (支店・現場名、作業内容・備考)
        form.querySelectorAll('.morning-project, .morning-detail, .afternoon-project, .afternoon-detail, .night-project, .night-detail').forEach(el => {
            el.disabled = !isPlanEditable;
        });

        // 実績関連のインプット (詳細レポート)
        form.querySelectorAll('.morning-report, .afternoon-report, .night-report').forEach(el => {
            el.disabled = !isActualEditable;
        });

        // 休みボタンと前日コピーボタンの制御
        document.querySelectorAll('.leave-quick-btn, .btn-copy-prev').forEach(btn => {
            if (isPlanEditable) {
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
                btn.disabled = false;
            } else {
                btn.style.pointerEvents = 'none';
                btn.style.opacity = '0.5';
                btn.disabled = true;
            }
        });

        // 日報コピー欄の無効化 (実績入力用)
        const copySelect = document.getElementById('copy-past-report-select');
        const copyBtn = document.getElementById('btn-copy-past-report');
        if (copySelect) copySelect.disabled = !isActualEditable;
        if (copyBtn) copyBtn.disabled = !isActualEditable;

        // タイムラインとパレットの操作無効化 (予定・実績入力用)
        const isTimelineEditable = (isPlanEditable || isActualEditable);
        document.querySelectorAll('.timeline-container-scroll, .timeline-palette').forEach(el => {
            if (!isTimelineEditable) {
                el.style.pointerEvents = 'none';
                el.style.opacity = '0.5';
            } else {
                // 休み( leaveType )が設定されているカードかどうかチェック
                const isInLeaveCard = el.closest('.day-card')?.querySelector('.day-leave-type')?.value;
                if (isInLeaveCard) {
                    el.style.pointerEvents = 'none';
                    el.style.opacity = '0.5';
                } else {
                    el.style.pointerEvents = 'auto';
                    el.style.opacity = '1';
                }
            }
        });
    };

    // 日次レポート入力欄の無効化・背景グレーアウト制御 (新セクション用)
    const updateDayReportTextStatus = (dayCard) => {
        if (!dayCard) return;
        
        const leaveInput = dayCard.querySelector('.day-leave-type');
        let hasLeave = leaveInput && leaveInput.value ? true : false;
        
        dayCard.querySelectorAll('.morning-report, .afternoon-report, .night-report').forEach(reportInput => {
            if (hasLeave) {
                reportInput.value = '';
                reportInput.disabled = true;
                reportInput.style.backgroundColor = '#f1f5f9';
            } else {
                // 状態は setFormLocked で別途制御されるため、ここでは休み時のクリアとグレーアウトのみ行う
                reportInput.style.backgroundColor = '';
            }
        });
    };

    // 日別入力枠
    const daysName = ['月', '火', '水', '木', '金', '土', '日'];
    const daysContainer = document.getElementById('days-container');
    const taskRowTemplate = document.getElementById('task-row-template');

    const calculateWeekTotal = () => {
        let weekTotal = 0;
        let weekSiteTotal = 0;
        document.querySelectorAll('.day-timeline-data').forEach(input => {
            const tl = input.value || '';
            if (tl.length === 48) {
                const workCount = tl.split('').filter(s => s === '1' || s === '3' || s === '5').length;
                const siteCount = tl.split('').filter(s => s === '1').length;
                weekTotal += workCount * 0.5;
                weekSiteTotal += siteCount * 0.5;
            }
        });
        const weekTotalSpan = document.getElementById('week-total-hours');
        if (weekTotalSpan) {
            weekTotalSpan.textContent = `週合計: ${weekTotal.toFixed(1)}H (現場従事: ${weekSiteTotal.toFixed(1)}H)`;
        }
    };

    const showRejectModal = (title, onConfirm) => {
        const existing = document.getElementById('reject-reason-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'reject-reason-modal';
        modal.style = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.4);
            backdrop-filter: blur(4px);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 9999;
        `;
        
        modal.innerHTML = `
            <div style="background: var(--bg-card, #ffffff); border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); width: 90%; max-width: 480px; padding: 24px; box-sizing: border-box; border: 1px solid var(--border);">
                <h3 style="margin-top: 0; margin-bottom: 16px; font-size: 1.2rem; color: var(--text-main); font-weight: bold;">${title}</h3>
                <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px;">差し戻しの理由を入力してください（社員の画面に表示されます）。</p>
                <textarea id="reject-reason-textarea" placeholder="理由を入力してください（例：水曜日の作業詳細が不足しています）" 
                    style="width: 100%; height: 100px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.9rem; margin-bottom: 20px; box-sizing: border-box; resize: none; background: #ffffff; color: #000000;"></textarea>
                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button type="button" id="reject-cancel-btn" class="btn btn-secondary" style="padding: 8px 16px;">キャンセル</button>
                    <button type="button" id="reject-submit-btn" class="btn btn-danger" style="padding: 8px 16px; background-color: #ef4444; color: #ffffff;">差し戻し確定</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const cancelBtn = modal.querySelector('#reject-cancel-btn');
        const submitBtn = modal.querySelector('#reject-submit-btn');
        const textarea = modal.querySelector('#reject-reason-textarea');

        cancelBtn.addEventListener('click', () => {
            modal.remove();
        });

        submitBtn.addEventListener('click', () => {
            const reason = textarea.value.trim();
            if (!reason) {
                alert('差し戻し理由を入力してください。');
                return;
            }
            onConfirm(reason);
            modal.remove();
        });
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
        
        // 実績ステータスバッジの動的生成
        let actualBadge = document.getElementById('report-actual-status-badge');
        if (!actualBadge && badge) {
            actualBadge = document.createElement('span');
            actualBadge.id = 'report-actual-status-badge';
            actualBadge.style = 'margin-left: 8px;';
            badge.parentNode.insertBefore(actualBadge, badge.nextSibling);
        }

        // 警告表示エリア（差し戻し理由）の取得と初期化
        let warningEl = document.getElementById('report-reject-warning');






        if (warningEl) warningEl.style.display = 'none';

        // ステータス値のロードと互換性処理
        let planStatus = 'draft';
        let planRejectReason = '';
        let actualStatus = 'uncreated';
        let actualRejectReason = '';

        if (existingReport) {
            planStatus = existingReport.planStatus || 'draft';
            planRejectReason = existingReport.planRejectReason || '';
            actualStatus = existingReport.actualStatus || (existingReport.status === 'plan' ? 'uncreated' : 'draft');
            actualRejectReason = existingReport.actualRejectReason || '';

            // 互換性処理: 古いデータで status フィールドだけがある場合
            if (!existingReport.planStatus && !existingReport.actualStatus) {
                const legacyStatus = existingReport.status;
                if (legacyStatus === 'approved') {
                    planStatus = 'approved';
                    actualStatus = 'approved';
                } else if (legacyStatus === 'confirmed') {
                    planStatus = 'approved';
                    actualStatus = 'submitted';
                } else {
                    planStatus = 'draft';
                    actualStatus = 'uncreated';
                }
            }

            // 安全ガード: 実績が承認済なら予定も強制的に承認済とする
            if (actualStatus === 'approved') {
                planStatus = 'approved';
            }
        }

        // 未来の週は予定のみ許可
        if (isFutureWeek) {
            planStatus = 'draft';
            actualStatus = 'uncreated';
        }

        // バッジデータセットの更新 (他所での判定用)
        if (badge) {
            badge.dataset.planStatus = planStatus;
            badge.dataset.actualStatus = actualStatus;
            badge.dataset.status = actualStatus === 'approved' ? 'approved' : (actualStatus === 'submitted' ? 'confirmed' : 'plan');
        }

        // フォームコントロールのロック適用
        setFormLocked(planStatus, actualStatus);
        
        if (existingReport) {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (!taskList) return;
                const dayLog = existingReport.dailyLogs ? existingReport.dailyLogs[day] : null;
                
                if (dayLog) {
                    if (Array.isArray(dayLog)) {
                        dayLog.forEach(t => {
                            if (taskList.addTaskRow) taskList.addTaskRow(t.project || '', t.detail || '', t.hours || '', t.timeline || '');
                        });
                    } else if (typeof dayLog === 'object') {
                        if (taskList.setCardData) taskList.setCardData(dayLog);
                    }
                }
                
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) {
                    reportText.value = (existingReport.dailyReports && existingReport.dailyReports[day]) ? existingReport.dailyReports[day] : '';
                }
            });
            
            // バッジ表示テキスト＆カラーの更新
            if (badge) {
                if (planStatus === 'approved') {
                    badge.className = 'status-badge status-approved';
                    badge.textContent = '予定: 承認済み';
                } else if (planStatus === 'submitted') {
                    badge.className = 'status-badge status-confirmed';
                    badge.textContent = '予定: 承認待ち';
                } else if (planStatus === 'rejected') {
                    badge.className = 'status-badge status-none';
                    badge.style.backgroundColor = '#ef4444';
                    badge.style.color = '#ffffff';
                    badge.textContent = '予定: 差し戻し';
                } else {
                    badge.className = 'status-badge status-plan';
                    badge.style.backgroundColor = '';
                    badge.style.color = '';
                    badge.textContent = '予定: 下書き';
                }
            }

            if (actualBadge) {
                actualBadge.style.display = 'inline-block';
                if (planStatus !== 'approved') {
                    actualBadge.className = 'status-badge status-none';
                    actualBadge.style.backgroundColor = '#94a3b8';
                    actualBadge.style.color = '#ffffff';
                    actualBadge.textContent = '実績: 未開始';
                } else if (actualStatus === 'approved') {
                    actualBadge.className = 'status-badge status-approved';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 承認済み';
                } else if (actualStatus === 'submitted') {
                    actualBadge.className = 'status-badge status-confirmed';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 承認待ち';
                } else if (actualStatus === 'rejected') {
                    actualBadge.className = 'status-badge status-none';
                    actualBadge.style.backgroundColor = '#ef4444';
                    actualBadge.style.color = '#ffffff';
                    actualBadge.textContent = '実績: 差し戻し';
                } else {
                    actualBadge.className = 'status-badge status-plan';
                    actualBadge.style.backgroundColor = '';
                    actualBadge.style.color = '';
                    actualBadge.textContent = '実績: 入力中';
                }
            }

            // 差し戻し警告の表示
            if (planStatus === 'rejected' && planRejectReason && warningEl) {
                warningEl.style.display = 'flex';
                warningEl.innerHTML = `<div>⚠️ 予定が差し戻されました。</div><div style="font-weight:normal; font-size:0.85rem; margin-top:2px;">差し戻し理由: ${planRejectReason}</div>`;
            } else if (actualStatus === 'rejected' && actualRejectReason && warningEl) {
                warningEl.style.display = 'flex';
                warningEl.innerHTML = `<div>⚠️ 実績が差し戻されました。</div><div style="font-weight:normal; font-size:0.85rem; margin-top:2px;">差し戻し理由: ${actualRejectReason}</div>`;
            }
            
            // ボタン制御
            if (actionContainer) {
                const currentUserName = currentUser.displayName || currentUser.email.split('@')[0];
                const isAdminViewingOthers = (currentCompany && currentCompany.role === 'admin' && currentAuthor !== currentUserName);

                if (isFutureWeek) {
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定を更新（一時保存）</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else if (isAdminViewingOthers) {
                    // 管理者が他社員の週報を閲覧している場合
                    if (planStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-approve-plan" class="btn btn-success btn-large" style="flex:1;">👍 予定を承認する</button>
                            <button type="button" id="btn-admin-reject-plan" class="btn btn-danger btn-large" style="flex:1; background-color:#ef4444;">👎 予定を差し戻す</button>
                        `;
                        document.getElementById('btn-admin-approve-plan').addEventListener('click', () => saveReport('plan_approved'));
                        document.getElementById('btn-admin-reject-plan').addEventListener('click', () => {
                            showRejectModal('予定の差し戻し', (reason) => saveReport('plan_rejected', reason));
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-approve-actual" class="btn btn-success btn-large" style="flex:1;">👍 実績を承認する</button>
                            <button type="button" id="btn-admin-reject-actual" class="btn btn-danger btn-large" style="flex:1; background-color:#ef4444;">👎 実績を差し戻す</button>
                        `;
                        document.getElementById('btn-admin-approve-actual').addEventListener('click', () => saveReport('approved'));
                        document.getElementById('btn-admin-reject-actual').addEventListener('click', () => {
                            showRejectModal('実績の差し戻し', (reason) => saveReport('actual_rejected', reason));
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'approved') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-admin-unapprove" class="btn btn-danger btn-large" style="background-color:#ef4444;">🔓 承認を取り消す（差し戻す）</button>
                        `;
                        document.getElementById('btn-admin-unapprove').addEventListener('click', () => {
                            showRejectModal('承認取り消し・実績差し戻し', (reason) => saveReport('actual_rejected', reason));
                        });
                    } else {
                        actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:var(--text-muted); width:100%;">この週報は現在、社員が入力中または一時保存状態です。</div>`;
                    }
                } else {
                    // 社員本人（または管理者が自分の週報を編集している場合）
                    if (planStatus === 'draft' || planStatus === 'rejected') {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定を一時保存</button>
                            <button type="button" id="btn-submit-plan" class="btn btn-primary btn-large" style="flex: 1;">予定を提出する</button>
                        `;
                        document.getElementById('btn-save-plan').addEventListener('click', () => saveReport('plan'));
                        document.getElementById('btn-submit-plan').addEventListener('click', () => saveReport('plan_submitted'));
                    } else if (planStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <div style="text-align:center; font-weight:bold; color:var(--primary); width:100%; margin-bottom: 10px;">⌛ 予定の承認待ちです（編集はロックされています）</div>
                            <button type="button" id="btn-withdraw-plan" class="btn btn-secondary btn-large" style="background-color:#6b7280; color:#ffffff; flex: 1; margin: 0 auto; max-width: 300px;">予定の提出を取り消す</button>
                        `;
                        document.getElementById('btn-withdraw-plan').addEventListener('click', async () => {
                            if (confirm('予定の提出を取り消して、下書き状態に戻しますか？')) {
                                await saveReport('plan_withdrawn');
                            }
                        });
                    } else if (planStatus === 'approved' && (actualStatus === 'draft' || actualStatus === 'rejected' || actualStatus === 'uncreated')) {
                        actionContainer.innerHTML = `
                            <button type="button" id="btn-save-actual" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">実績を一時保存</button>
                            <button type="button" id="btn-submit-actual" class="btn btn-primary btn-large" style="flex: 1;">実績を確定提出する</button>
                        `;
                        document.getElementById('btn-save-actual').addEventListener('click', () => saveReport('draft'));
                        document.getElementById('btn-submit-actual').addEventListener('click', () => saveReport('confirmed'));
                    } else if (planStatus === 'approved' && actualStatus === 'submitted') {
                        actionContainer.innerHTML = `
                            <div style="text-align:center; font-weight:bold; color:var(--primary); width:100%; margin-bottom: 10px;">⌛ 実績の承認待ちです（編集はロックされています）</div>
                            <button type="button" id="btn-withdraw-actual" class="btn btn-secondary btn-large" style="background-color:#6b7280; color:#ffffff; flex: 1; margin: 0 auto; max-width: 300px;">実績の提出を取り消す</button>
                        `;
                        document.getElementById('btn-withdraw-actual').addEventListener('click', async () => {
                            if (confirm('実績の提出を取り消して、下書き状態に戻しますか？')) {
                                await saveReport('actual_withdrawn');
                            }
                        });
                    } else if (planStatus === 'approved' && actualStatus === 'approved') {
                        actionContainer.innerHTML = `<div style="text-align:center; font-weight:bold; color:#16a34a; width:100%;">✅ 今週の日報はすべて承認済みです</div>`;
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
            if (actualBadge) {
                actualBadge.style.display = 'none';
            }
            
            if (actionContainer) {
                if (isFutureWeek) {
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c;">予定として一時保存</button>
                    `;
                    const btnSavePlan = document.getElementById('btn-save-plan');
                    if (btnSavePlan) {
                        btnSavePlan.addEventListener('click', () => saveReport('plan'));
                    }
                } else {
                    // 新規週報時は、まず予定を入力して提出する
                    actionContainer.innerHTML = `
                        <button type="button" id="btn-save-plan" class="btn btn-secondary btn-large" style="background-color:#ea580c; flex: 1;">予定を一時保存</button>
                        <button type="button" id="btn-submit-plan" class="btn btn-primary btn-large" style="flex: 1;">予定を提出する</button>
                    `;
                    document.getElementById('btn-save-plan').addEventListener('click', () => saveReport('plan'));
                    document.getElementById('btn-submit-plan').addEventListener('click', () => saveReport('plan_submitted'));
                }
            }
        }
        calculateWeekTotal();
        
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
            updateDayReportTextStatus(dayCard);
        });

        setTimeout(() => {
            lastSavedDataString = JSON.stringify(getUnsavedData());
            if (weekInput) {
                lastSelectedWeek = weekInput.value;
            }
        }, 100);
    };

    if (daysContainer) {
        daysName.forEach(day => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-card';
            const copyBtnHtml = day !== '月' ? `<button type="button" class="btn btn-secondary btn-small btn-copy-prev" style="padding: 2px 8px; font-size: 0.75rem; border-radius: 4px; font-weight: bold;">前日からコピー</button>` : '';
            // dayCard の基本HTML（午前・午後・夜間 + タイムライン + レポート）
            dayCard.innerHTML = `
                <div class="day-header" style="display:flex;justify-content:space-between;align-items:center;">
                    <span class="day-label">${day}曜日</span>
                    <div style="display:flex;gap:10px;align-items:center;">
                        ${copyBtnHtml}
                        <span class="total-hours" style="font-size:0.85rem;font-weight:normal;">計 0.0H</span>
                    </div>
                </div>
                <div class="day-body">
                    <!-- 休み クイックボタン -->
                    <div class="leave-quick-btns">
                        <span style="font-size:0.8rem;color:var(--text-muted);align-self:center;">休み：</span>
                        <button type="button" class="leave-quick-btn" data-leave="休日">休日</button>
                        <button type="button" class="leave-quick-btn leave-clear-btn" data-leave="">解除</button>
                    </div>
                    <div class="task-list" data-day="${day}" style="display:none;"></div>
                    <!-- 午前セクション -->
                    <div class="time-section morning">
                        <div class="time-section-header">🌅 午前</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project morning-project" placeholder="支店・現場名" list="project-suggestions"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail morning-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report morning-report" placeholder="午前の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <!-- 午後セクション -->
                    <div class="time-section afternoon">
                        <div class="time-section-header">🌤 午後</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project afternoon-project" placeholder="支店・現場名" list="project-suggestions"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail afternoon-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report afternoon-report" placeholder="午後の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <!-- 夜間セクション -->
                    <div class="time-section night">
                        <div class="time-section-header">🌙 夜間</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                            <input type="text" class="section-project night-project" placeholder="支店・現場名" list="project-suggestions"
                                style="flex:2;min-width:130px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                            <input type="text" class="section-detail night-detail" placeholder="作業内容・備考"
                                style="flex:3;min-width:180px;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                        <div style="margin-top:6px; width:100%;">
                            <input type="text" class="section-report night-report" placeholder="夜間の詳細レポート・備考（印刷時に青文字で表示されます）"
                                style="width:100%;padding:7px;border:1px solid var(--border);border-radius:6px;font-size:0.9rem;background:#ffffff;color:#000000;">
                        </div>
                    </div>
                    <input type="hidden" class="day-timeline-data" value="">
                    <input type="hidden" class="day-leave-type" value="">
                    <!-- 互換性のための非表示の全体レポートエリア -->
                    <div class="day-report-field" style="display:none;">
                        <textarea class="day-report-text"></textarea>
                    </div>
                    <!-- タイムライン -->
                    <div class="timeline-section" style="margin-top:8px;">
                        <div class="timeline-palette" style="display:flex;gap:4px;margin-bottom:4px;align-items:center;flex-wrap:wrap;">
                            <button type="button" class="palette-btn active" data-mode="1" style="padding:2px 10px;border:2px solid #000;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#000;color:#fff;">■ 現場管理</button>
                            <button type="button" class="palette-btn" data-mode="5" style="padding:2px 10px;border:2px solid #2563eb;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#2563eb;">▼ 現場管理以外の業務</button>
                            <button type="button" class="palette-btn" data-mode="2" style="padding:2px 10px;border:2px solid #ef4444;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#ef4444;">● 休憩</button>
                            <button type="button" class="palette-btn" data-mode="3" style="padding:2px 10px;border:2px solid #16a34a;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#16a34a;">▲ 移動</button>
                            <button type="button" class="palette-btn" data-mode="4" style="padding:2px 10px;border:2px solid #94a3b8;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#94a3b8;">◆ 有休</button>
                            <button type="button" class="palette-btn" data-mode="0" style="padding:2px 10px;border:2px solid #94a3b8;border-radius:4px;font-size:0.8rem;font-weight:bold;cursor:pointer;background:#fff;color:#64748b;">× 消去</button>
                            <span class="timeline-hours-total-display" style="margin-left:auto;font-weight:bold;color:var(--primary);font-size:0.9rem;">作業計 0.0H</span>
                        </div>
                        <div class="timeline-hours-header" style="display:grid;grid-template-columns:repeat(24,1fr);font-size:0.65rem;color:var(--text-muted);padding:0 1px;"></div>
                        <div class="timeline-cells-grid" style="display:grid;grid-template-columns:repeat(48,1fr);gap:0;border:1px solid var(--border);border-radius:4px;overflow:hidden;height:28px;cursor:crosshair;touch-action:none;"></div>
                    </div>
                </div>
            `;
            daysContainer.appendChild(dayCard);
            const taskList = dayCard.querySelector('.task-list');
            
            // タイムライン初期化
            let stateArray = Array(48).fill(0);
            const timelineData = dayCard.querySelector('.day-timeline-data');
            const leaveTypeInput = dayCard.querySelector('.day-leave-type');
            const totalDisplay = dayCard.querySelector('.timeline-hours-total-display');
            const headerContainer = dayCard.querySelector('.timeline-hours-header');
            const cellsGrid = dayCard.querySelector('.timeline-cells-grid');
            const cellElements = [];
            
            // ヘッダーラベル（5〜翌4時 = 24時間）
            const TIMELINE_START_HOUR = 5;
            for (let h = 0; h < 24; h++) {
                const lbl = document.createElement('div');
                lbl.style.textAlign = 'center';
                lbl.textContent = (TIMELINE_START_HOUR + h) % 24;
                headerContainer.appendChild(lbl);
            }
            
            // タイムラインセル
            for (let i = 0; i < 48; i++) {
                const cell = document.createElement('div');
                cell.className = 'timeline-cell';
                cell.dataset.index = i;
                cell.dataset.state = 0;
                const hour = (TIMELINE_START_HOUR + Math.floor(i / 2)) % 24;
                const min = (i % 2 === 0) ? '00' : '30';
                cell.title = `${hour}:${min}`;
                cellsGrid.appendChild(cell);
                cellElements.push(cell);
            }
            
            const calculateTotal = () => {
                const workCount = stateArray.filter(s => s === 1 || s === 3 || s === 5).length;
                const totalHours = workCount * 0.5;
                const siteCount = stateArray.filter(s => s === 1).length;
                const siteHours = siteCount * 0.5;
                totalDisplay.textContent = `作業計 ${totalHours.toFixed(1)}H (現場従事 ${siteHours.toFixed(1)}H)`;
                dayCard.querySelector('.total-hours').textContent = `計 ${totalHours.toFixed(1)}H (現場従事 ${siteHours.toFixed(1)}H)`;
                timelineData.value = stateArray.join('');
                calculateWeekTotal();
            };
            
            let currentMode = 1;
            const paletteBtns = dayCard.querySelectorAll('.palette-btn');
            
            const updatePaletteStyles = () => {
                paletteBtns.forEach(btn => {
                    const mode = parseInt(btn.dataset.mode);
                    const isActive = mode === currentMode;
                    
                    if (mode === 1) { // 作業
                        btn.style.background = isActive ? '#000000' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#000000';
                        btn.style.borderColor = '#000000';
                    } else if (mode === 2) { // 休憩
                        btn.style.background = isActive ? '#ef4444' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#ef4444';
                        btn.style.borderColor = '#ef4444';
                    } else if (mode === 3) { // 移動
                        btn.style.background = isActive ? '#16a34a' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#16a34a';
                        btn.style.borderColor = '#16a34a';
                    } else if (mode === 4) { // 有休
                        btn.style.background = isActive ? '#94a3b8' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#94a3b8';
                        btn.style.borderColor = '#94a3b8';
                    } else if (mode === 5) { // 現場管理以外の業務
                        btn.style.background = isActive ? '#2563eb' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#2563eb';
                        btn.style.borderColor = '#2563eb';
                    } else if (mode === 0) { // 消去
                        btn.style.background = isActive ? '#64748b' : '#ffffff';
                        btn.style.color = isActive ? '#ffffff' : '#64748b';
                        btn.style.borderColor = '#94a3b8';
                    }
                    
                    if (isActive) {
                        btn.classList.add('active');
                    } else {
                        btn.classList.remove('active');
                    }
                });
            };

            paletteBtns.forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentMode = parseInt(btn.dataset.mode);
                    updatePaletteStyles();
                });
            });
            
            updatePaletteStyles();
            
            let isDrawing = false;
            const updateCellState = (index) => {
                if (index < 0 || index >= 48) return;
                stateArray[index] = currentMode;
                cellElements[index].dataset.state = currentMode;
                calculateTotal();
            };
            cellsGrid.addEventListener('mousedown', (e) => { const cell = e.target.closest('.timeline-cell'); if (cell) { isDrawing = true; updateCellState(parseInt(cell.dataset.index)); } });
            cellsGrid.addEventListener('mousemove', (e) => { if (!isDrawing) return; const cell = e.target.closest('.timeline-cell'); if (cell) updateCellState(parseInt(cell.dataset.index)); });
            window.addEventListener('mouseup', () => { isDrawing = false; });
            cellsGrid.addEventListener('touchstart', (e) => { const touch = e.touches[0]; const t = document.elementFromPoint(touch.clientX, touch.clientY); const cell = t?.closest('.timeline-cell'); if (cell && cell.parentNode === cellsGrid) { isDrawing = true; updateCellState(parseInt(cell.dataset.index)); e.preventDefault(); } }, { passive: false });
            cellsGrid.addEventListener('touchmove', (e) => { if (!isDrawing) return; const touch = e.touches[0]; const t = document.elementFromPoint(touch.clientX, touch.clientY); const cell = t?.closest('.timeline-cell'); if (cell && cell.parentNode === cellsGrid) { updateCellState(parseInt(cell.dataset.index)); } e.preventDefault(); }, { passive: false });
            cellsGrid.addEventListener('touchend', () => { isDrawing = false; });
            
            // 休みボタン
            dayCard.querySelectorAll('.leave-quick-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const leaveType = btn.dataset.leave;
                    leaveTypeInput.value = leaveType;
                    // 入力欄だけを対象にする（ラベルやヘッダーはそのまま）
                    const allInputs = dayCard.querySelectorAll('.section-project, .section-detail, .day-report-text');
                    const timelinePalette = dayCard.querySelector('.timeline-palette');
                    if (leaveType) {
                        allInputs.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
                        cellsGrid.style.opacity = '0.3'; cellsGrid.style.pointerEvents = 'none';
                        if (timelinePalette) { timelinePalette.style.opacity = '0.3'; timelinePalette.style.pointerEvents = 'none'; }
                        stateArray.fill(0);
                        cellElements.forEach(c => c.dataset.state = 0);
                        calculateTotal();
                        btn.classList.add('active');
                        dayCard.querySelectorAll('.leave-quick-btn').forEach(b => { if (b !== btn) b.classList.remove('active'); });
                    } else {
                        allInputs.forEach(el => { el.disabled = false; el.style.opacity = '1'; });
                        cellsGrid.style.opacity = '1'; cellsGrid.style.pointerEvents = 'auto';
                        if (timelinePalette) { timelinePalette.style.opacity = '1'; timelinePalette.style.pointerEvents = 'auto'; }
                        dayCard.querySelectorAll('.leave-quick-btn').forEach(b => b.classList.remove('active'));
                    }
                });
            });
            
            // 前日からコピー
            const copyPrevBtn = dayCard.querySelector('.btn-copy-prev');
            if (copyPrevBtn) {
                copyPrevBtn.addEventListener('click', () => {
                    const prevDayIdx = daysName.indexOf(day) - 1;
                    if (prevDayIdx < 0) return;
                    const prevDay = daysName[prevDayIdx];
                    const prevTaskList = document.querySelector(`.task-list[data-day="${prevDay}"]`);
                    if (!prevTaskList || !prevTaskList.getCardData) return;
                    const prevData = prevTaskList.getCardData();
                    if (!prevData.morning?.project && !prevData.afternoon?.project && !prevData.night?.project) {
                        alert('前日の作業データがありません。');
                        return;
                    }
                    if (!confirm('前日の内容をコピーしますか？')) return;
                    taskList.setCardData(prevData);
                });
            }
            
            // getCardData: この日のデータをオブジェクトで取得
            taskList.getCardData = () => {
                return {
                    morning: {
                        project: dayCard.querySelector('.morning-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.morning-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.morning-report')?.value.trim() || ''
                    },
                    afternoon: {
                        project: dayCard.querySelector('.afternoon-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.afternoon-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.afternoon-report')?.value.trim() || ''
                    },
                    night: {
                        project: dayCard.querySelector('.night-project')?.value.trim() || '',
                        detail: dayCard.querySelector('.night-detail')?.value.trim() || '',
                        report: dayCard.querySelector('.night-report')?.value.trim() || ''
                    },
                    timeline: timelineData.value,
                    leaveType: leaveTypeInput.value
                };
            };
            
            // setCardData: データを反映
            taskList.setCardData = (data) => {
                if (!data) return;
                const mp = dayCard.querySelector('.morning-project');
                const md = dayCard.querySelector('.morning-detail');
                const mr = dayCard.querySelector('.morning-report');
                const ap = dayCard.querySelector('.afternoon-project');
                const ad = dayCard.querySelector('.afternoon-detail');
                const ar = dayCard.querySelector('.afternoon-report');
                const np = dayCard.querySelector('.night-project');
                const nd = dayCard.querySelector('.night-detail');
                const nr = dayCard.querySelector('.night-report');
                
                if (mp) mp.value = data.morning?.project || '';
                if (md) md.value = data.morning?.detail || '';
                if (mr) mr.value = data.morning?.report || '';
                
                if (ap) ap.value = data.afternoon?.project || '';
                if (ad) ad.value = data.afternoon?.detail || '';
                if (ar) ar.value = data.afternoon?.report || '';
                
                if (np) np.value = data.night?.project || '';
                if (nd) nd.value = data.night?.detail || '';
                if (nr) nr.value = data.night?.report || '';
                
                // 過去データの互換性のための救済ロジック
                // もし新しい午前・午後・夜間のレポートがすべて空で、かつ非表示の textarea (過去の全体レポート) に値がある場合、
                // それを「午前レポート」に移行して表示させます。
                const oldReportVal = dayCard.querySelector('.day-report-text')?.value || '';
                if (oldReportVal && !data.morning?.report && !data.afternoon?.report && !data.night?.report) {
                    if (mr) mr.value = oldReportVal;
                }

                if (data.timeline && data.timeline.length === 48) {
                    stateArray = data.timeline.split('').map(Number);
                    cellElements.forEach((cell, i) => { cell.dataset.state = stateArray[i]; });
                    timelineData.value = data.timeline;
                }
                
                const leaveType = data.leaveType || '';
                leaveTypeInput.value = leaveType;
                
                const allInputs = dayCard.querySelectorAll('.section-project, .section-detail, .section-report, .day-report-text');
                const timelinePalette = dayCard.querySelector('.timeline-palette');
                
                // 休日ボタンの状態を更新
                dayCard.querySelectorAll('.leave-quick-btn').forEach(b => {
                    if (leaveType && b.dataset.leave === leaveType) {
                        b.classList.add('active');
                    } else {
                        b.classList.remove('active');
                    }
                });

                if (leaveType) {
                    allInputs.forEach(el => { el.disabled = true; el.style.opacity = '0.4'; });
                    cellsGrid.style.opacity = '0.3'; cellsGrid.style.pointerEvents = 'none';
                    if (timelinePalette) { timelinePalette.style.opacity = '0.3'; timelinePalette.style.pointerEvents = 'none'; }
                } else {
                    allInputs.forEach(el => { el.disabled = false; el.style.opacity = '1'; });
                    cellsGrid.style.opacity = '1'; cellsGrid.style.pointerEvents = 'auto';
                    if (timelinePalette) { timelinePalette.style.opacity = '1'; timelinePalette.style.pointerEvents = 'auto'; }
                }
                
                calculateTotal();
            };
            
            // 旧addTaskRow互換（旧データ読み込み用）
            taskList.addTaskRow = (projVal, detailVal, hoursVal, timelineVal) => {
                // 旧形式のデータを午前セクションに入力
                const mp = dayCard.querySelector('.morning-project');
                const md = dayCard.querySelector('.morning-detail');
                if (mp && !mp.value) mp.value = projVal || '';
                else {
                    const ap = dayCard.querySelector('.afternoon-project');
                    if (ap && !ap.value) ap.value = projVal || '';
                    else {
                        const np = dayCard.querySelector('.night-project');
                        if (np && !np.value) np.value = projVal || '';
                    }
                }
                if (md && !md.value) md.value = detailVal || '';
                else {
                    const ad = dayCard.querySelector('.afternoon-detail');
                    if (ad && !ad.value) ad.value = detailVal || '';
                    else {
                        const nd = dayCard.querySelector('.night-detail');
                        if (nd && !nd.value) nd.value = detailVal || '';
                    }
                }
                if (timelineVal && timelineVal.length === 48) {
                    for (let i = 0; i < 48; i++) {
                        const v = parseInt(timelineVal[i]);
                        if (v > 0 && stateArray[i] === 0) {
                            stateArray[i] = v;
                            cellElements[i].dataset.state = v;
                        }
                    }
                    timelineData.value = stateArray.join('');
                }
                calculateTotal();
            };
            taskList.clearAll = () => {
                dayCard.querySelector('.morning-project').value = '';
                dayCard.querySelector('.morning-detail').value = '';
                dayCard.querySelector('.afternoon-project').value = '';
                dayCard.querySelector('.afternoon-detail').value = '';
                dayCard.querySelector('.night-project').value = '';
                dayCard.querySelector('.night-detail').value = '';
                stateArray.fill(0);
                cellElements.forEach(c => c.dataset.state = 0);
                timelineData.value = '';
                leaveTypeInput.value = '';
                calculateTotal();
            };
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
                if (!taskList || !taskList.clearAll) return;
                taskList.clearAll();
                const dayLog = sourceReport.dailyLogs[day];
                if (dayLog) {
                    if (Array.isArray(dayLog)) {
                        dayLog.forEach(t => {
                            if (taskList.addTaskRow) taskList.addTaskRow(t.project || '', t.detail || '', t.hours || '', t.timeline || '');
                        });
                    } else if (typeof dayLog === 'object' && taskList.setCardData) {
                        taskList.setCardData(dayLog);
                    }
                }
                const reportText = taskList.closest('.day-card').querySelector('.day-report-text');
                if (reportText) {
                    reportText.value = (sourceReport.dailyReports && sourceReport.dailyReports[day]) ? sourceReport.dailyReports[day] : '';
                }
            });

            calculateWeekTotal();
            alert('コピーが完了しました！必要に応じて編集してください。');
        });
    }

    // 予定(Schedule)保存 - Firebase Firestore
    const schedForm = document.getElementById('schedule-form');
    if (schedForm) {
        // Enterキー押下による誤送信を防止
        schedForm.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
                e.preventDefault();
            }
        });
        schedForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const schedId = document.getElementById('sched-id').value;
            const resolvedBranch = '';

            const getVal = (id) => {
                const el = document.getElementById(id);
                return el ? el.value.trim() : '';
            };
            const getValRaw = (id) => {
                const el = document.getElementById(id);
                return el ? el.value : '';
            };

            const startDate = getValRaw('sched-start');
            const endDate = getValRaw('sched-end');

            if (startDate && endDate && startDate > endDate) {
                alert('納期 (製作完了日) は製作開始日より後の日付にしてください。');
                return;
            }

            const projectNumber = getVal('sched-project-number');
            if (/[０-９]/.test(projectNumber)) {
                alert('工事番号の数字は半角で入力してください（全角数字は許可されていません）。');
                return;
            }

            const today = new Date();
            const yyyy = today.getFullYear();
            const mm = String(today.getMonth() + 1).padStart(2, '0');
            const dd = String(today.getDate()).padStart(2, '0');
            const todayStr = `${yyyy}-${mm}-${dd}`;

            if (startDate && startDate < todayStr) {
                alert('製作開始日は今日以降の日付を指定してください（過去の日付は入力できません）。');
                return;
            }

            const schedData = {
                companyId,
                project: getVal('sched-project'),
                projectNumber: getVal('sched-project-number'),
                tonnage: parseFloat(getVal('sched-tonnage')) || 0,
                branch: resolvedBranch,
                author: getVal('sched-author'),
                start: getValRaw('sched-start'),
                end: getValRaw('sched-end'),
                notes: getVal('sched-notes'),
                client: getVal('sched-client'),
                address: getVal('sched-address'),
                architect: getVal('sched-architect'),
                drawing: getVal('sched-drawing'),
                lofting: getVal('sched-lofting'),
                inspectionCompany: getVal('sched-inspection-company'),
                generalContractor: getVal('sched-general-contractor'),
                erectionDate: getVal('sched-erection-date'),
                chiefTech: getValRaw('sched-chief-tech'),
                assignType: "none",
                barColor: getVal('sched-bar-color') || '#2563eb', // デフォルトは青色
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

            if (typeof window.loadDailyReports === 'function') await window.loadDailyReports();
                
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

    const saveReport = async (status, rejectReason = '') => {
        // すでに実績が承認済みの場合は上書き保存・再提出を禁止
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        if (!weekInput || !authorInput) return;
        const weekVal = weekInput.value;
        const authorVal = authorInput.value;
        const existingReport = allReports.find(r => r.week === weekVal && r.author === authorVal);
        
        if (existingReport && existingReport.actualStatus === 'approved') {
            // 管理者が承認を取り消す（status === 'actual_rejected'）または実績承認更新（status === 'approved'）以外はブロック
            if (status !== 'actual_rejected' && status !== 'approved') {
                alert('この週報の実績はすでに承認されているため、再提出や編集はできません。');
                return;
            }
        }

        if (reportForm && !reportForm.checkValidity()) {
            reportForm.reportValidity();
            return;
        }

        // 工事名が「有給」「欠勤」「休日」以外のとき、作業時間が 0H のままであればエラーにする（実績確定または実績承認時のみ）
        let hasZeroHoursError = false;
        let errorDay = '';
        let errorProject = '';

        if (status === 'confirmed' || status === 'approved') {
            daysName.forEach(day => {
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                if (!taskList || !taskList.getCardData) return;
                const cardData = taskList.getCardData();
                const leaveType = cardData.leaveType || '';
                if (!leaveType) {
                    // 作業データがあるのにタイムラインが0の場合チェック
                    ['morning', 'afternoon', 'night'].forEach(t => {
                        const proj = cardData[t]?.project || '';
                        if (proj && !['有給', '欠勤', '休日'].includes(proj)) {
                            const timeline = cardData.timeline || '';
                            const workCount = timeline ? timeline.split('').filter(s => s === '1' || s === '3' || s === '5').length : 0;
                            if (workCount === 0) {
                                hasZeroHoursError = true;
                                errorDay = day;
                                errorProject = proj;
                            }
                        }
                    });
                }
            });

            if (hasZeroHoursError) {
                alert(`【${errorDay}曜日】の「${errorProject}」の作業時間が 0 時間になっています。\nタイムラインをドラッグして作業時間（黒いバー）を入力してください。`);
                return;
            }
        }

        const dailyLogs = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            if (taskList && taskList.getCardData) {
                dailyLogs[day] = taskList.getCardData();
            } else {
                dailyLogs[day] = { morning: {project:'',detail:''}, afternoon: {project:'',detail:''}, night: {project:'',detail:''}, timeline: '', leaveType: '' };
            }
        });

        const dailyReports = {};
        daysName.forEach(day => {
            const dayCard = document.querySelector(`.task-list[data-day="${day}"]`).closest('.day-card');
            if (dayCard) {
                const mrVal = dayCard.querySelector('.morning-report')?.value.trim() || '';
                const arVal = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
                const nrVal = dayCard.querySelector('.night-report')?.value.trim() || '';
                
                // 従来の dailyReports にも午前・午後・夜間のレポートを改行区切りで結合して保存する（後方互換性のため）
                const reports = [];
                if (mrVal) reports.push(`【午前】${mrVal}`);
                if (arVal) reports.push(`【午後】${arVal}`);
                if (nrVal) reports.push(`【夜間】${nrVal}`);
                
                const combined = reports.join('\n');
                dailyReports[day] = combined;
                
                // 非表示の textarea にも反映しておく
                const hiddenText = dayCard.querySelector('.day-report-text');
                if (hiddenText) hiddenText.value = combined;
            } else {
                dailyReports[day] = '';
            }
        });

        const companyId = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
        // weekVal, authorVal, existingReport は関数の先頭で定義済みのものを再利用します

        const reportData = {
            companyId,
            week: weekVal,
            author: authorVal,
            dailyLogs,
            dailyReports,
            timestamp: new Date().toISOString()
        };

        // 既存レポートがある場合のステータス引き継ぎと初期化
        let planStatus = (existingReport && existingReport.planStatus) ? existingReport.planStatus : 'draft';
        let planRejectReason = (existingReport && existingReport.planRejectReason) ? existingReport.planRejectReason : '';
        let actualStatus = (existingReport && existingReport.actualStatus) ? existingReport.actualStatus : 'uncreated';
        let actualRejectReason = (existingReport && existingReport.actualRejectReason) ? existingReport.actualRejectReason : '';

        // 安全ガード: 既に実績が承認済なら、ロード段階で予定も承認済とみなす
        if (actualStatus === 'approved') {
            planStatus = 'approved';
        }

        // 実績ステータスの変更時に予定が承認済であることをバリデーション
        const isActualChange = ['draft', 'confirmed', 'approved', 'actual_rejected', 'actual_withdrawn'].includes(status);
        if (isActualChange && planStatus !== 'approved') {
            alert('予定が承認されていないため、実績の変更・提出はできません。先に予定を承認してもらってください。');
            return;
        }

        // 送られてきたstatusに応じて詳細なステータスへ変換
        if (status === 'plan') {
            planStatus = 'draft';
        } else if (status === 'plan_withdrawn') {
            planStatus = 'draft';
        } else if (status === 'plan_submitted') {
            planStatus = 'submitted';
        } else if (status === 'plan_approved') {
            planStatus = 'approved';
            reportData.planApprovedAt = new Date().toISOString();
            // 予定が承認された時点では、実績が既に別ステータス（提出済等）でない限り uncreated に保つ
            if (actualStatus !== 'submitted' && actualStatus !== 'approved' && actualStatus !== 'rejected') {
                actualStatus = 'uncreated';
            }
        } else if (status === 'plan_rejected') {
            planStatus = 'rejected';
            planRejectReason = rejectReason || '';
        } else if (status === 'draft') {
            actualStatus = 'draft';
        } else if (status === 'confirmed') {
            actualStatus = 'submitted';
        } else if (status === 'approved') {
            actualStatus = 'approved';
            reportData.actualApprovedAt = new Date().toISOString();
            reportData.approvedAt = new Date().toISOString();
            reportData.approvedBy = currentUser.displayName || currentUser.email.split('@')[0];
        } else if (status === 'actual_rejected') {
            actualStatus = 'rejected';
            actualRejectReason = rejectReason || '';
        } else if (status === 'actual_withdrawn') {
            actualStatus = 'draft';
        }

        reportData.planStatus = planStatus;
        reportData.planRejectReason = planRejectReason;
        reportData.actualStatus = actualStatus;
        reportData.actualRejectReason = actualRejectReason;

        // 後方互換性のためのstatusフィールドマッピング
        if (actualStatus === 'approved') {
            reportData.status = 'approved';
            if (!reportData.actualApprovedAt) {
                reportData.actualApprovedAt = new Date().toISOString();
            }
            reportData.approvedAt = new Date().toISOString();
            reportData.approvedBy = currentUser.displayName || currentUser.email.split('@')[0];
        } else if (actualStatus === 'submitted') {
            reportData.status = 'confirmed';
        } else {
            reportData.status = 'plan';
        }

        try {
            if (existingReport) {
                await updateDoc(doc(db, "reports", existingReport.id), reportData);
            } else {
                await addDoc(collection(db, "reports"), reportData);
            }

            if (status === 'plan_approved') {
                alert('予定を承認しました！');
            } else if (status === 'plan_rejected') {
                alert('予定を差し戻しました。');
            } else if (status === 'actual_rejected') {
                alert('実績を差し戻しました。');
            } else if (status === 'approved') {
                alert('実績（上長承認）を登録しました！');
            } else if (status === 'confirmed') {
                alert('実績を確定提出しました！');
            } else if (status === 'plan_submitted') {
                alert('予定を提出しました！');
            } else if (status === 'plan_withdrawn') {
                alert('予定の提出を取り消しました（下書き状態に戻しました）。');
            } else if (status === 'actual_withdrawn') {
                alert('実績の提出を取り消しました。');
            } else if (status === 'plan') {
                alert('予定を一時保存しました！');
            } else {
                alert('一時保存しました！');
            }
            await loadReports(false);
        } catch (error) {
            console.error("Error saving document: ", error);
            alert('保存に失敗しました。');
        }
    };

    if (reportForm) {
        reportForm.addEventListener('submit', (e) => {
            e.preventDefault();
        });
    }

    // データ読み込み（ガントチャート）
    const ganttYearSelect = document.getElementById('gantt-year');

    // 管理者専用工事予定一覧テーブルのレンダリング
    const renderAdminScheduleList = () => {
        const tbody = document.getElementById('admin-schedule-list-tbody');
        if (!tbody) return;

        // 開始日の早い順、その次は工事名順でソート
        const sortedSchedules = [...allSchedules].sort((a, b) => {
            if (a.start !== b.start) return a.start > b.start ? 1 : -1;
            return a.project > b.project ? 1 : -1;
        });

        let html = '';
        sortedSchedules.forEach(s => {
            html += `
                <tr>
                    <td style="padding: 8px; border: 1px solid var(--border); font-weight: bold; text-align: left;">${s.project || ''}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: left;">${s.projectNumber || '-'}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: right;">${s.tonnage || 0} t</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: left;">${s.client || '-'}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center;">${s.start || ''} 〜 ${s.end || ''}</td>
                    <td style="padding: 8px; border: 1px solid var(--border); text-align: center;">
                        <div style="display: flex; gap: 5px; justify-content: center;">
                            <button class="btn btn-secondary btn-small btn-edit-admin-sched" data-id="${s.id}" style="padding: 4px 8px; font-size: 0.75rem; background-color: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer;">編集</button>
                            <button class="btn btn-secondary btn-small btn-delete-admin-sched" data-id="${s.id}" style="padding: 4px 8px; font-size: 0.75rem; background-color: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">削除</button>
                        </div>
                    </td>
                </tr>
            `;
        });

        if (sortedSchedules.length === 0) {
            html = `<tr><td colspan="7" style="padding: 20px; text-align: center; color: var(--text-muted);">工事予定が登録されていません。</td></tr>`;
        }

        tbody.innerHTML = html;

        // 編集ボタンのイベント紐付け
        tbody.querySelectorAll('.btn-edit-admin-sched').forEach(btn => {
            btn.addEventListener('click', () => {
                const schedId = btn.dataset.id;
                const sched = allSchedules.find(s => s.id === schedId);
                if (sched) {
                    startEditScheduleMode(sched);
                    // フォームのある上部へスクロールして戻す
                    const formCard = document.querySelector('#schedule-input-view .form-card');
                    if (formCard) formCard.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });

        // 削除ボタンのイベント紐付け
        tbody.querySelectorAll('.btn-delete-admin-sched').forEach(btn => {
            btn.addEventListener('click', async () => {
                const schedId = btn.dataset.id;
                const sched = allSchedules.find(s => s.id === schedId);
                if (sched) {
                    if (confirm(`本当に工事「${sched.project}」を削除しますか？\n（※この操作は取り消せません）`)) {
                        try {
                            await deleteDoc(doc(db, "schedules", schedId));
                            alert('工事を削除しました。');
                            await loadSchedules();
                        } catch (e) {
                            console.error("Error deleting schedule: ", e);
                            alert('削除に失敗しました。');
                        }
                    }
                }
            });
        });
    };

    window.loadSchedules = async () => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "schedules"), where("companyId", "==", cid));
            const querySnapshot = await getDocs(q);
            allSchedules = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
            renderGanttChart();
            renderAdminScheduleList();
            updateProjectSuggestions();
            if (typeof updateReportProjectDropdown === 'function') {
                updateReportProjectDropdown();
            }
        } catch (e) {
            console.error("Error loading schedules: ", e);
        }
    };

    const renderGanttChart = () => {
        const container = document.getElementById('gantt-container');
        if (!container || !ganttYearSelect) return;

        const selectedYear = parseInt(ganttYearSelect.value, 10);
        if (isNaN(selectedYear)) return;

        const hslToHex = (h, s, l) => {
            l /= 100;
            const a = s * Math.min(l, 1 - l) / 100;
            const f = n => {
                const k = (n + h / 30) % 12;
                const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                return Math.round(255 * color).toString(16).padStart(2, '0');
            };
            return `#${f(0)}${f(8)}${f(4)}`;
        };

        const formatDateLocal = (date) => {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        };

        const normalizeDateStr = (str) => {
            if (!str) return '';
            return str.replace(/\//g, '-');
        };

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

        const selectedBranch = '';
        let filteredSchedules = allSchedules;

        // 年度と重なるスケジュールを抽出
        const targetSchedules = filteredSchedules.filter(s => s.start <= endStr && s.end >= startStr);
        // 表示順は開始日の早い順、その次は工事名順とする
        targetSchedules.sort((a, b) => (a.start || '') > (b.start || '') ? 1 : ((a.start || '') < (b.start || '') ? -1 : ((a.project || '') > (b.project || '') ? 1 : -1)));

        // 画面表示用に幅を設定し、PCでは画面幅に収め、スマホでは詳細幅があるため自動的にスクロール可能にします。
        const isMobile = window.innerWidth <= 1024;
        const totalWidth = isMobile ? (615 + dateList.length * 12) + 'px' : '100%';
        container.style.width = totalWidth;

        // stickyヘルパー関数：スマホ表示の時は工事名以外のstickyを無効化（position: static）
        const getStickyHeaderStyle = (leftPx) => {
            if (isMobile) return 'position: static;';
            return `position: sticky; left: ${leftPx}px; z-index: 25;`;
        };
        const getStickyDataStyle = (leftPx) => {
            if (isMobile) return 'position: static;';
            return `position: sticky; left: ${leftPx}px; z-index: 15; background: var(--card-bg);`;
        };
        container.style.minWidth = totalWidth;
        container.style.overflow = 'visible';

        const wrapper = container.closest('.gantt-wrapper');
        if (wrapper) {
            wrapper.style.overflowX = isMobile ? 'auto' : 'hidden';
            wrapper.style.width = '100%';
        }

        // 列定義: 左側詳細テーブル（10カラム、合計615pxに縮小） + 右側カレンダー各日(1frで画面幅に収める)
        const colWidth = isMobile ? '12px' : 'minmax(0, 1fr)'; let html = `<div class="gantt-grid" style="grid-template-columns: 100px 80px 80px 50px 60px 60px 70px 60px 80px repeat(${dateList.length}, ${colWidth}); width: ${totalWidth};">`;

        // ==========================================
        // 行1: ヘッダー (左側：10個の詳細カラムヘッダー、右側：各月)
        // ==========================================
        // 左側のテーブル情報ヘッダーエリア（縦割り、sticky固定、並び替え版）
        html += `
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 1; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; position: sticky; left: 0px; z-index: 25;">工事名</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 2; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(100)}">元請</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 3; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(180)}">住所</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 4; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(260)}">t数</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 5; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(310)}">詳細図</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 6; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(370)}">現寸</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 7; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(430)}">第三者検査会社</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 8; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; ${getStickyHeaderStyle(500)}">責任者</div>
            <div class="gantt-cell gantt-header-cell" style="grid-row: 1; grid-column: 9; font-size: 0.74rem; font-weight: bold; height: 35px; border-bottom: 2px solid #cbd5e1; border-right: 2px solid var(--border) !important; ${getStickyHeaderStyle(560)}">建て方予定</div>
        `;

        // カレンダー部 月ヘッダー (左側9列の次なので 10列目から開始)
        let startCol = 10;
        dateList.forEach((d, idx) => {
            const m = d.getMonth() + 1;
            const nextDate = dateList[idx + 1];
            const isLastDayOfMonth = !nextDate || nextDate.getMonth() !== d.getMonth();

            if (isLastDayOfMonth) {
                const endCol = idx + 11;
                const boundaryClass = !nextDate ? '' : 'month-boundary';
                html += `<div class="gantt-cell gantt-header-cell ${boundaryClass}" style="grid-row: 1; grid-column: ${startCol} / ${endCol}; font-weight: bold; font-size: 0.72rem; height: 35px; border-bottom: 2px solid #cbd5e1; white-space: nowrap; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 0 2px;">${m}月</div>`;
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
            
            // ガントチャートからは編集ボタンを排除
            const editBtnHtml = '';

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
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 2; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--primary); font-weight: bold; border-bottom: 1px solid var(--border); ${getStickyDataStyle(100)}" title="${s.client || ''}">
                    ${s.client || '-'}
                </div>
                <!-- 3. 住所 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 3; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; white-space: normal; word-break: break-all; border-bottom: 1px solid var(--border); ${getStickyDataStyle(180)}" title="住所: ${s.address || '-'}">
                    ${s.address || '-'}
                </div>
                <!-- 4. t数 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 4; text-align: right; justify-content: flex-end; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); ${getStickyDataStyle(260)}" title="t数: ${s.tonnage ? s.tonnage + 't' : '-'}">
                    ${s.tonnage ? s.tonnage + 't' : '-'}
                </div>
                <!-- 5. 詳細図 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 5; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); ${getStickyDataStyle(310)}" title="詳細図: ${s.drawing || '-'}">
                    ${s.drawing || '-'}
                </div>
                <!-- 6. 現寸 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 6; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); ${getStickyDataStyle(370)}" title="現寸: ${s.lofting || '-'}">
                    ${s.lofting || '-'}
                </div>
                <!-- 7. 製品検査 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 7; text-align: left; justify-content: flex-start; padding: 6px 2px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); ${getStickyDataStyle(430)}" title="第三者検査会社: ${s.inspectionCompany || '-'}">
                    ${s.inspectionCompany || '-'}
                </div>
                <!-- 8. 責任者 -->
                <div class="gantt-cell" style="grid-row: ${rowIndex}; grid-column: 8; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); ${getStickyDataStyle(500)}" title="${s.chiefTech || ''}">
                    ${s.chiefTech || '-'}
                </div>
                <!-- 9. 建て方予定 -->
                <div class="gantt-cell gantt-text-cell" style="grid-row: ${rowIndex}; grid-column: 9; text-align: center; justify-content: center; padding: 6px 1px; font-size: 0.7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-bottom: 1px solid var(--border); border-right: 2px solid var(--border) !important; ${getStickyDataStyle(560)}" title="建て方開始日: ${s.erectionDate || '-'}">
                    ${s.erectionDate || '-'}
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

                // ★マークの表示判定：このカレンダーの日付が「建て方予定日（erectionDate）」と一致する場合
                const dateStr = formatDateLocal(d);
                const isErectionDate = (s.erectionDate && s.erectionDate === dateStr);
                const cellContent = isErectionDate ? '<span style="color: #000000; font-weight: bold; font-size: 1.1rem; line-height: 1; z-index: 12; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: flex; justify-content: center; align-items: center; width: 16px; height: 16px; pointer-events: none;">★</span>' : '';

                html += `<div class="gantt-bar-bg-cell ${isSat} ${isSun} ${boundaryClass}" style="grid-row: ${rowIndex}; grid-column: ${idx + 10}; position: relative;">${cellContent}</div>`;
            });

            // 工程バーの計算（文字列比較で安全に行い、日付のズレを防ぐ）
            const normalizeDateStr_old = (str) => {
                if (!str) return '';
                return str.replace(/\//g, '-');
            };
            const sStartStr = normalizeDateStr(s.start);
            const sEndStr = normalizeDateStr(s.end);
            
            const drawStartStr = sStartStr < startStr ? startStr : (sStartStr > endStr ? endStr : sStartStr);
            const drawEndStr = sEndStr > endStr ? endStr : (sEndStr < startStr ? startStr : sEndStr);

            const formatDateLocal_old = (date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}`;
            };

            const startIdx = dateList.findIndex(d => formatDateLocal(d) === drawStartStr);
            const endIdx = dateList.findIndex(d => formatDateLocal(d) === drawEndStr);

            if (startIdx !== -1 && endIdx !== -1) {
                const gridStart = startIdx + 10;
                const gridEnd = endIdx + 11;

                const color = (s.barColor && s.barColor !== '#2563eb') ? s.barColor : hslToHex(Math.round((360 / Math.max(targetSchedules.length, 1)) * index), 70, 45);
                const patternClass = s.barPattern === 'stripe' ? 'pattern-stripe' : '';
                const completedClass = s.completed ? 'completed-bar' : '';

                html += `<div class="gantt-bar ${patternClass} ${completedClass}" data-id="${s.id}" style="grid-row: ${rowIndex}; grid-column: ${gridStart} / ${gridEnd}; background-color: ${color};" title="【${s.project}】\n期間: ${s.start} 〜 ${s.end}\n備考: ${s.notes || 'なし'}"></div>`;
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
    // 工事名（支店・現場名）サジェスト（Datalist）の更新
    const updateProjectSuggestions = () => {
        if (!currentUser) return;
        
        const myName = currentUser.displayName || currentUser.email.split('@')[0];
        
        const mySuggestions = new Set();
        const otherSuggestions = new Set();
        
        // 支店候補の追加（単一の「支店」のみを残す）
        const branchSuggestions = ['支店'];
        
        // サジェストから除外する工事名・項目の判定関数
        const isExcludedProject = (proj) => {
            if (!proj) return true;
            const normalized = proj.trim();
            // 有給・有休、欠勤・休日・休み、本社、支店
            if (['有給', '有休', '欠勤', '休日', '休み', '本社', '支店'].includes(normalized)) {
                return true;
            }
            // 個別支店名（例：東京支店）も除外する
            if (normalized.endsWith('支店')) {
                return true;
            }
            return false;
        };
        
        // スケジュール（工事情報）から取得
        allSchedules.forEach(s => { 
            if (s.project && !isExcludedProject(s.project)) {
                otherSuggestions.add(s.project); 
            }
        });
        
        // 過去の日報データから取得 (新旧形式に対応)
        allReports.forEach(r => {
            if (r.dailyLogs) {
                const isMe = r.author === myName;
                const targetSet = isMe ? mySuggestions : otherSuggestions;
                
                Object.values(r.dailyLogs).forEach(dayLog => {
                    if (Array.isArray(dayLog)) {
                        // 旧形式（配列）
                        dayLog.forEach(t => { 
                            if (t.project && !isExcludedProject(t.project)) {
                                targetSet.add(t.project); 
                            }
                        });
                    } else if (dayLog && typeof dayLog === 'object') {
                        // 新形式（オブジェクト）
                        ['morning', 'afternoon', 'night'].forEach(sec => {
                            const proj = dayLog[sec]?.project;
                            if (proj && !isExcludedProject(proj)) {
                                targetSet.add(proj);
                            }
                        });
                    }
                });
            }
        });
        
        // ソートして連結
        // 1. 本人が入力した過去の工事名
        // 2. 支店名「支店」の項目
        // 3. その他（他人が入力した工事、スケジュール工事等）
        // 4. 「有休」（一番最後）
        const mySorted = Array.from(mySuggestions).sort();
        const otherSorted = Array.from(otherSuggestions).sort().filter(p => !mySuggestions.has(p) && !branchSuggestions.includes(p));
        
        const finalSuggestions = [
            ...mySorted,
            ...otherSorted,
            '有休'
        ];
        
        const datalist = document.getElementById('project-suggestions');
        if (datalist) {
            datalist.innerHTML = finalSuggestions
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
            select.innerHTML += `<option value="${idx}">${formatWeekRange(r.week)}</option>`;
        });
        select.dataset.reportsJson = JSON.stringify(myReports);
    };

    // リアルタイム購読の管理変数
    let reportsUnsubscribe = null;
    let prevReportStatuses = {};

    // データ読み込み（日報：リアルタイム同期版）
    window.loadReports = (isSummary = false) => {
        try {
            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];
            const q = query(collection(db, "reports"), where("companyId", "==", cid));

            if (reportsUnsubscribe) {
                reportsUnsubscribe();
            }

            reportsUnsubscribe = onSnapshot(q, (querySnapshot) => {
                allReports = querySnapshot.docs.map(doc => {
                    const data = doc.data();
                    const actualStatus = data.actualStatus || (data.status === 'approved' ? 'approved' : data.status === 'confirmed' ? 'submitted' : data.status === 'plan' ? 'uncreated' : 'draft');
                    const planStatus = data.planStatus || 'draft';
                    if (actualStatus === 'approved' && planStatus !== 'approved') {
                        console.warn('Auto-correcting planStatus to approved for doc: ' + doc.id);
                        updateDoc(doc.ref, { 
                            planStatus: 'approved',
                            planApprovedAt: data.planApprovedAt || new Date().toISOString(),
                            actualStatus: 'approved',
                            actualApprovedAt: data.actualApprovedAt || new Date().toISOString()
                        }).catch(err => console.error(err));
                        return { 
                            id: doc.id, 
                            ...data, 
                            planStatus: 'approved', 
                            planApprovedAt: data.planApprovedAt || new Date().toISOString(),
                            actualStatus: 'approved', 
                            actualApprovedAt: data.actualApprovedAt || new Date().toISOString() 
                        };
                    }
                    return { id: doc.id, ...data };
                });
                
                // ステータス変更の検知とトースト通知
                allReports.forEach(r => {
                    // 自分自身の週報のみ通知する (一般社員の場合)
                    const isMyReport = currentUser && (r.author === currentUser.displayName || r.email === currentUser.email);
                    if (isMyReport) {
                        const key = `${r.week}`;
                        const prev = prevReportStatuses[key];
                        const currentPlanStatus = r.planStatus || 'draft';
                        const currentActualStatus = r.actualStatus || (r.status === 'plan' ? 'uncreated' : 'draft');
                        
                        if (prev) {
                            const weekRange = formatWeekRange(r.week);
                            // 予定ステータスの変更検知
                            if (prev.planStatus !== currentPlanStatus) {
                                if (currentPlanStatus === 'approved') {
                                    showToast(`🎉 ${weekRange} の【予定】が承認されました！`, 'success');
                                } else if (currentPlanStatus === 'rejected') {
                                    showToast(`⚠️ ${weekRange} の【予定】が差し戻されました。理由をご確認ください。`, 'warning', 8000);
                                } else if (currentPlanStatus === 'submitted') {
                                    showToast(`✉️ ${weekRange} の【予定】を提出しました。`, 'success');
                                }
                            }
                            // 実績ステータスの変更検知
                            if (prev.actualStatus !== currentActualStatus) {
                                if (currentActualStatus === 'approved') {
                                    showToast(`🎉 ${weekRange} の【実績】が承認されました！週報が確定しました。`, 'success');
                                } else if (currentActualStatus === 'rejected') {
                                    showToast(`⚠️ ${weekRange} の【実績】が差し戻されました。理由をご確認ください。`, 'warning', 8000);
                                } else if (currentActualStatus === 'submitted') {
                                    showToast(`✉️ ${weekRange} の【実績】を提出しました。`, 'success');
                                }
                            }
                        }
                        
                        // 状態を記憶
                        prevReportStatuses[key] = {
                            planStatus: currentPlanStatus,
                            actualStatus: currentActualStatus
                        };
                    }
                });

                updateFilterOptions();
                updateCopySelect();
                updateProjectSuggestions();
                if (isSummary) {
                    renderSummaryTable();
                } else {
                    renderTable();
                    // 現在選択されている週のレポートデータを再反映（入力ロックなどの状態変化を同期）
                    const weekInput = document.getElementById('week');
                    if (weekInput && weekInput.value) {
                        loadReportForSelectedWeek();
                    }
                }
            }, (err) => {
                console.error("Error in onSnapshot for reports:", err);
            });
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
            } else {
                const now = new Date();
                const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                if (months.includes(currentMonthStr)) {
                    summaryFilterMonth.value = currentMonthStr;
                } else if (months.length > 0) {
                    summaryFilterMonth.value = months[0];
                }
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

    // 催促通知を送信するAPI呼び出し
    const sendRemind = async (employeeUid, week, type, btnElement) => {
        if (!currentCompany) return;
        
        btnElement.disabled = true;
        btnElement.textContent = '送信中...';
        
        try {
            const baseUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
                ? 'http://127.0.0.1:5001/weekly-report-93e5f/us-central1'
                : 'https://us-central1-weekly-report-93e5f.cloudfunctions.net';
                
            const response = await fetch(`${baseUrl}/sendRemindNotification`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    companyId: currentCompany.companyId,
                    employeeUid: employeeUid,
                    week: week,
                    type: type // 'plan' or 'actual'
                })
            });
            
            const result = await response.json();
            if (result.success) {
                btnElement.disabled = false; // disabledによるグレーアウトを回避
                btnElement.style.pointerEvents = 'none'; // クリック不可にする
                btnElement.textContent = '催促送信完了';
                btnElement.style.backgroundColor = '#16a34a';
                btnElement.style.color = '#ffffff';
                btnElement.style.borderColor = '#16a34a';
            } else {
                alert('催促送信に失敗しました: ' + (result.error || '不明なエラー'));
                btnElement.disabled = false;
                btnElement.textContent = '催促';
            }
        } catch (e) {
            console.error('Remind error:', e);
            alert('通信エラーが発生しました。');
            btnElement.disabled = false;
            btnElement.textContent = '催促';
        }
    };

    // 管理者用 催促パネルの描画
    const renderRemindPanel = () => {
        const container = document.getElementById('remind-panel-container');
        if (!container) return;
        
        if (!currentCompany || currentCompany.role !== 'admin') {
            container.style.display = 'none';
            return;
        }
        
        container.style.display = 'block';
        
        let weekSelect = document.getElementById('remind-week-select');
        if (!weekSelect) {
            const header = container.querySelector('h3');
            const selectWrapper = document.createElement('div');
            selectWrapper.style.margin = '10px 0 15px 0';
            selectWrapper.style.display = 'flex';
            selectWrapper.style.alignItems = 'center';
            selectWrapper.style.gap = '10px';
            selectWrapper.innerHTML = `
                <label for="remind-week-select" style="font-weight:bold;">表示対象週:</label>
                <select id="remind-week-select" style="padding:8px;font-size:0.9rem;border:1px solid var(--border);border-radius:6px;background:var(--card-bg);color:var(--text);"></select>
            `;
            header.after(selectWrapper);
            weekSelect = document.getElementById('remind-week-select');
            
            const mainWeekSelect = document.getElementById('week');
            if (mainWeekSelect) {
                Array.from(mainWeekSelect.options).forEach(opt => {
                    const newOpt = document.createElement('option');
                    newOpt.value = opt.value;
                    newOpt.textContent = opt.textContent;
                    newOpt.style.color = opt.style.color;
                    newOpt.style.fontWeight = opt.style.fontWeight;
                    weekSelect.appendChild(newOpt);
                });
                weekSelect.value = mainWeekSelect.value;
            }
            
            weekSelect.addEventListener('change', renderRemindPanel);
        }
        
        const targetWeek = weekSelect.value;
        if (!targetWeek) return;
        
        const listDiv = document.getElementById('remind-status-list');
        if (!listDiv) return;
        
        listDiv.innerHTML = '';
        
        const employees = currentCompany.employees || [];
        if (employees.length === 0) {
            listDiv.innerHTML = '<div style="grid-column: 1/-1; color: var(--text-muted); text-align: center; padding: 20px;">登録されている社員がいません。</div>';
            return;
        }
        
        employees.forEach(emp => {
            const report = allReports.find(r => r.week === targetWeek && (r.author === emp.name || r.authorEmail === emp.email));
            
            let planStatus = 'uncreated';
            let actualStatus = 'uncreated';
            let planRejectReason = '';
            let actualRejectReason = '';
            
            if (report) {
                planStatus = report.planStatus || 'draft';
                actualStatus = report.actualStatus || (report.status === 'approved' ? 'approved' : report.status === 'confirmed' ? 'submitted' : report.status === 'plan' ? 'uncreated' : 'draft');
                planRejectReason = report.planRejectReason || '';
                actualRejectReason = report.actualRejectReason || '';
            }
            
            const card = document.createElement('div');
            card.style.background = 'var(--card-bg)';
            card.style.border = '1px solid var(--border)';
            card.style.borderRadius = '8px';
            card.style.padding = '15px';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.gap = '10px';
            
            const getStatusBadge = (status, rejectReason) => {
                let text = '未作成';
                let color = '#94a3b8';
                if (status === 'draft') {
                    text = '一時保存';
                    color = '#ea580c';
                } else if (status === 'submitted') {
                    text = '提出済';
                    color = '#2563eb';
                } else if (status === 'approved') {
                    text = '承認済';
                    color = '#16a34a';
                } else if (status === 'rejected') {
                    text = '差し戻し中';
                    color = '#dc2626';
                }
                
                let html = `<span style="background:${color}15;color:${color};border:1px solid ${color}30;padding:2px 6px;border-radius:4px;font-size:0.75rem;font-weight:bold;margin-left:5px;">${text}</span>`;
                if (status === 'rejected' && rejectReason) {
                    html += `<div style="font-size:0.75rem;color:#dc2626;margin-top:2px;">コメント: ${rejectReason}</div>`;
                }
                return html;
            };
            
            const getActionButton = (status, type) => {
                // 1. 未作成のときは催促ボタン
                if (status === 'uncreated') {
                    return `<button type="button" class="btn btn-secondary btn-small btn-remind" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:#fee2e2;color:#dc2626;border:1px solid #fecaca;"
                                data-uid="${emp.uid}" data-type="${type}">催促</button>`;
                }
                
                // 2. 提出済のときは「承認する」ボタン
                if (status === 'submitted') {
                    return `<button type="button" class="btn btn-primary btn-small btn-view-report" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:var(--primary-color,#2563eb);color:#fff;border:none;border-radius:4px;cursor:pointer;"
                                data-email="${emp.email}" data-name="${emp.name}" data-week="${targetWeek}">承認する</button>`;
                }
                
                // 3. 承認済のときのみ「詳細」ボタンを表示
                if (status === 'approved') {
                    return `<button type="button" class="btn btn-secondary btn-small btn-view-report" 
                                style="margin-left:auto;padding:2px 8px;font-size:0.75rem;background:#64748b;color:#fff;border:none;border-radius:4px;cursor:pointer;"
                                data-email="${emp.email}" data-name="${emp.name}" data-week="${targetWeek}">詳細</button>`;
                }
                
                // 4. 一時保存や提出済、差し戻し中はボタン不要
                return '';
            };
            
            card.innerHTML = `
                <div style="font-weight:bold;font-size:1rem;color:var(--text);border-bottom:1px solid var(--border);padding-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
                    <div>👤 ${emp.name}</div>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;font-size:0.85rem;">
                    <div style="display:flex;align-items:center;width:100%;">
                        <span>📅 予定:</span>
                        ${getStatusBadge(planStatus, planRejectReason)}
                        ${getActionButton(planStatus, 'plan')}
                    </div>
                    <div style="display:flex;align-items:center;width:100%;">
                        <span>✅ 実績:</span>
                        ${getStatusBadge(actualStatus, actualRejectReason)}
                        ${getActionButton(actualStatus, 'actual')}
                    </div>
                </div>
            `;
            
            card.querySelectorAll('.btn-remind').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const uid = e.target.dataset.uid;
                    const type = e.target.dataset.type;
                    sendRemind(uid, targetWeek, type, e.target);
                });
            });

            card.querySelectorAll('.btn-view-report').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const email = e.currentTarget.dataset.email;
                    const name = e.currentTarget.dataset.name;
                    const week = e.currentTarget.dataset.week;
                    openReportModal(name, email, week);
                });
            });
            
            listDiv.appendChild(card);
        });
    };

    const openReportModal = async (empName, empEmail, targetWeek) => {
        const modal = document.getElementById('report-modal');
        const modalBody = document.getElementById('modal-report-body');
        if (!modal || !modalBody) return;

        // モーダルのヘッダータイトルに社員名と対象週を動的にセット
        const modalTitle = document.getElementById('modal-title');
        if (modalTitle) {
            modalTitle.innerText = `📄 週報詳細・上長承認 (${empName} ｜ ${formatWeekRange(targetWeek)})`;
        }

        modalBody.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">読み込み中...</div>';
        modal.classList.remove('hidden');

        const btnClose = document.getElementById('btn-close-modal');
        if (btnClose) {
            btnClose.onclick = () => {
                modal.classList.add('hidden');
            };
        }

        const report = allReports.find(r => r.week === targetWeek && (r.author === empName || r.authorEmail === empEmail));

        if (!report) {
            modalBody.innerHTML = `
                <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
                    <div style="font-size:3rem;margin-bottom:15px;">📄</div>
                    <p style="font-size:1.1rem;font-weight:bold;margin-bottom:5px;">週報データが未作成です</p>
                    <p style="font-size:0.9rem;">${empName} の ${formatWeekRange(targetWeek)} の週報データはまだ一時保存もされていません。</p>
                </div>
            `;
            return;
        }

        const r = report;
        const dates = getDaysOfWeek(r.week);
        
                let printTasksHtml = '';
        daysName.forEach((day, idx) => {
            const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
            const dailyRep = (r.dailyReports && r.dailyReports[day]) ? r.dailyReports[day] : '';
            
            const dateLabel = `${dates ? formatDate(dates[idx]) : ''}<br>(${day})`;
            const rowSpan = ts.length || 1;

            if (ts.length > 0) {
                ts.forEach((t, tIdx) => {
                    const isFirst = tIdx === 0;
                    let rowHtml = '<tr>';
                    if (isFirst) {
                        rowHtml += `<td rowspan="${rowSpan}" style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>`;
                    }
                    
                    // 午前/午後/夜間のバッジを表示
                    const badgeBg = t.period === 'morning' ? '#e0f2fe' : (t.period === 'afternoon' ? '#fef3c7' : '#f3e8ff');
                    const badgeColor = t.period === 'morning' ? '#0369a1' : (t.period === 'afternoon' ? '#b45309' : '#6b21a8');
                    const periodBadge = t.periodLabel ? `<span style="display:inline-block;padding:2px 6px;font-size:0.75rem;font-weight:bold;border-radius:4px;background:${badgeBg};color:${badgeColor};margin-right:8px;vertical-align:middle;">${t.periodLabel}</span>` : '';
                    
                    rowHtml += `
                        <td style="border:1px solid var(--border);padding:8px;vertical-align:middle;">${periodBadge}<span style="vertical-align:middle;">${t.project || ''}</span></td>
                        <td style="border:1px solid var(--border);padding:8px;vertical-align:middle;">${t.detail || ''}</td>
                        <td style="text-align:center;border:1px solid var(--border);padding:8px;white-space:nowrap;vertical-align:middle;">${parseFloat(t.hours||0).toFixed(1)}H</td>
                    `;
                    
                    if (isFirst) {
                        rowHtml += `<td rowspan="${rowSpan}" style="white-space: pre-wrap; font-size:0.85rem;border:1px solid var(--border);padding:8px;vertical-align:top;">${dailyRep || '-'}</td>`;
                    }
                    rowHtml += '</tr>';
                    printTasksHtml += rowHtml;
                });
            } else if (dailyRep) {
                printTasksHtml += `<tr>
                    <td style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>
                    <td colspan="3" style="color: #64748b; font-style: italic; border:1px solid var(--border); padding:8px; text-align:center;vertical-align:middle;">作業記録なし</td>
                    <td style="white-space: pre-wrap; font-size:0.85rem; border:1px solid var(--border); padding:8px;vertical-align:top;">${dailyRep}</td>
                </tr>`;
            } else {
                printTasksHtml += `<tr>
                    <td style="text-align:center;font-weight:bold;white-space:nowrap;background:var(--bg-muted, #f8fafc);border:1px solid var(--border);padding:8px;vertical-align:middle;">${dateLabel}</td>
                    <td colspan="3" style="color: #cbd5e1; text-align:center; background:#f8fafc; border:1px solid var(--border); padding:8px;vertical-align:middle;">休み / 記録なし</td>
                    <td style="color:#cbd5e1; background:#f8fafc; text-align:center; border:1px solid var(--border); padding:8px;vertical-align:middle;">-</td>
                </tr>`;
            }
        });

        const cardEl = document.createElement('div');
        cardEl.className = 'print-report-card';
        cardEl.style.marginBottom = '0';
        cardEl.style.boxShadow = 'none';
        cardEl.style.border = 'none';

        cardEl.innerHTML = `
            <div class="print-report-header" style="background:var(--primary-color);color:#fff;border-radius:6px 6px 0 0;padding:12px 15px;font-weight:bold;font-size:1.1rem;display:flex;justify-content:space-between;">
                <div>対象期間: ${formatWeekRange(r.week)}</div>
                <div>担当者: ${r.author || ''}</div>
            </div>
            <div class="print-report-body" style="padding:20px;border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;background:var(--card-bg);">
                <strong style="display:block;margin-bottom:12px;color:var(--text-main);font-size:1rem;">■ ${r.planStatus === 'approved' ? '業務実績' : '作業予定'}（日別詳細）</strong>
                <table class="print-task-table" style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                    <thead><tr><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">日付(曜)</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">工事名</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">作業内容</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">時間</th><th style="background:var(--bg-muted);color:var(--text-main);padding:8px;border:1px solid var(--border);">日次レポート・備考</th></tr></thead>
                    <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b; border:1px solid var(--border);">記録なし</td></tr>'}</tbody>
                </table>
            </div>
        `;

        const planStatus = r.planStatus || 'draft';
        const actualStatus = r.actualStatus || (r.status === 'approved' ? 'approved' : r.status === 'confirmed' ? 'submitted' : r.status === 'plan' ? 'uncreated' : 'draft');
        const planRejectReason = r.planRejectReason || '';
        const actualRejectReason = r.actualRejectReason || '';

        const getStatusText = (status, rejectReason, isActual = false) => {
            if (status === 'draft') {
                return isActual 
                    ? '<span style="color:#ea580c;font-weight:bold;">未作成</span>' 
                    : '<span style="color:#ea580c;font-weight:bold;">一時保存</span>';
            }
            if (status === 'uncreated') return '<span style="color:#94a3b8;font-weight:bold;">未作成</span>';
            if (status === 'submitted') return '<span style="color:#2563eb;font-weight:bold;">提出済 (承認待ち)</span>';
            if (status === 'approved') return '<span style="color:#16a34a;font-weight:bold;">承認済み</span>';
            if (status === 'rejected') {
                let txt = '<span style="color:#dc2626;font-weight:bold;">差し戻し中</span>';
                if (rejectReason) txt += `<br><span style="font-size:0.8rem;color:#dc2626;">理由: ${rejectReason}</span>`;
                return txt;
            }
            return '未作成';
        };

        const adminPanel = document.createElement('div');
        adminPanel.className = 'admin-approval-panel no-print';
        adminPanel.style.marginTop = '20px';
        adminPanel.style.padding = '15px';
        adminPanel.style.background = 'var(--bg-muted, #f8fafc)';
        adminPanel.style.border = '1px dashed var(--primary-color)';
        adminPanel.style.borderRadius = '8px';

        const isPlanApproveDisabled = planStatus !== 'submitted';
        const isPlanRejectDisabled = planStatus !== 'submitted';
        const isActualApproveDisabled = actualStatus !== 'submitted' || planStatus !== 'approved';
        const isActualRejectDisabled = actualStatus !== 'submitted' || planStatus !== 'approved';

        adminPanel.innerHTML = `
            <h4 style="margin:0 0 12px 0; display:flex; align-items:center; gap:6px; color:var(--text-main);">🛡️ 上長承認操作パネル</h4>
            <div style="display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap; font-size:0.9rem;">
                    <div><strong>予定の状況:</strong> ${getStatusText(planStatus, planRejectReason, false)}</div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-primary btn-small btn-approve-plan" style="padding:4px 12px; font-size:0.8rem;" ${isPlanApproveDisabled ? 'disabled' : ''}>予定を承認</button>
                        <button type="button" class="btn btn-danger btn-small btn-reject-plan" style="padding:4px 12px; font-size:0.8rem;" ${isPlanRejectDisabled ? 'disabled' : ''}>予定を差し戻す</button>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:20px; flex-wrap:wrap; font-size:0.9rem; border-top: 1px solid var(--border); padding-top: 12px;">
                    <div><strong>実績の状況:</strong> ${getStatusText(actualStatus, actualRejectReason, true)}</div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn btn-primary btn-small btn-approve-actual" style="padding:4px 12px; font-size:0.8rem;" ${isActualApproveDisabled ? 'disabled' : ''}>実績を承認</button>
                        <button type="button" class="btn btn-danger btn-small btn-reject-actual" style="padding:4px 12px; font-size:0.8rem;" ${isActualRejectDisabled ? 'disabled' : ''}>実績を差し戻す</button>
                    </div>
                </div>
                
                <div class="reject-comment-area" style="display:none; flex-direction:column; gap:8px; border-top:1px solid var(--border); padding-top:12px;">
                    <label style="font-size:0.85rem; font-weight:bold; color:#dc2626;">差し戻し理由（コメント）</label>
                    <textarea class="txt-reject-reason" rows="3" placeholder="差し戻しの理由を入力してください..." style="width:100%; padding:8px; border:1px solid #fecaca; border-radius:6px; background:#fff5f5; color:#991b1b; font-size:0.85rem; resize:vertical;"></textarea>
                    <div style="display:flex; gap:8px; justify-content:flex-end;">
                        <button type="button" class="btn btn-secondary btn-small btn-cancel-reject" style="padding:4px 12px; font-size:0.8rem;">キャンセル</button>
                        <button type="button" class="btn btn-danger btn-small btn-submit-reject" style="padding:4px 12px; font-size:0.8rem; background:#dc2626; color:#fff; border:none;">差し戻しを確定</button>
                    </div>
                </div>
            </div>
        `;

        const btnApprovePlan = adminPanel.querySelector('.btn-approve-plan');
        btnApprovePlan.addEventListener('click', async () => {
            if (!confirm('予定を承認しますか？')) return;
            try {
                btnApprovePlan.disabled = true;
                await updateDoc(doc(db, "reports", r.id), {
                    planStatus: 'approved',
                    planApprovedAt: new Date().toISOString(),
                    planRejectReason: ''
                });
                alert('予定を承認しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnApprovePlan.disabled = false;
            }
        });

        const btnApproveActual = adminPanel.querySelector('.btn-approve-actual');
        btnApproveActual.addEventListener('click', async () => {
            if (!confirm('実績を承認しますか？')) return;
            try {
                btnApproveActual.disabled = true;
                await updateDoc(doc(db, "reports", r.id), {
                    actualStatus: 'approved',
                    actualApprovedAt: new Date().toISOString(),
                    approvedAt: new Date().toISOString(),
                    actualRejectReason: '',
                    status: 'approved'
                });
                alert('実績を承認しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnApproveActual.disabled = false;
            }
        });

        const rejectArea = adminPanel.querySelector('.reject-comment-area');
        const txtReason = adminPanel.querySelector('.txt-reject-reason');
        const btnCancelReject = adminPanel.querySelector('.btn-cancel-reject');
        const btnSubmitReject = adminPanel.querySelector('.btn-submit-reject');
        
        let activeRejectType = '';

        const showRejectArea = (type) => {
            activeRejectType = type;
            rejectArea.style.display = 'flex';
            txtReason.value = '';
            txtReason.focus();
        };

        adminPanel.querySelector('.btn-reject-plan').addEventListener('click', () => showRejectArea('plan'));
        adminPanel.querySelector('.btn-reject-actual').addEventListener('click', () => showRejectArea('actual'));

        btnCancelReject.addEventListener('click', () => {
            rejectArea.style.display = 'none';
            activeRejectType = '';
        });

        btnSubmitReject.addEventListener('click', async () => {
            const reason = txtReason.value.trim();
            if (!reason) {
                alert('差し戻し理由を入力してください。');
                return;
            }
            try {
                btnSubmitReject.disabled = true;
                const updateData = {};
                if (activeRejectType === 'plan') {
                    updateData.planStatus = 'rejected';
                    updateData.planRejectReason = reason;
                } else if (activeRejectType === 'actual') {
                    updateData.actualStatus = 'rejected';
                    updateData.actualRejectReason = reason;
                    updateData.status = 'plan';
                }
                
                await updateDoc(doc(db, "reports", r.id), updateData);
                alert('差し戻し処理が完了しました。');
                modal.classList.add('hidden');
                await loadReports(false);
            } catch (err) {
                console.error(err);
                alert('エラーが発生しました。');
                btnSubmitReject.disabled = false;
            }
        });

        cardEl.appendChild(adminPanel);
        modalBody.innerHTML = '';
        modalBody.appendChild(cardEl);
    };

    const renderTable = () => {
        const filterMonth = document.getElementById('filter-month').value;
        const filterAuthor = document.getElementById('filter-author').value;
        const filterBranch = '';
        const tbody = document.getElementById('reports-tbody');
        const printContainer = document.getElementById('print-details-container');
        const personalSummary = document.getElementById('personal-summary-container');
        const reportListContainer = document.getElementById('report-list-container');

        const filtered = allReports.filter(r => 
            (filterMonth === '' || getMonthStr(r.week) === filterMonth) && 
            (filterAuthor === '' || r.author === filterAuthor) &&
            (filterBranch === '' || getAuthorBranch(r.author) === filterBranch)
        );
        filtered.sort((a,b) => (a.week < b.week ? 1 : -1)); // 降順
        
        tbody.innerHTML = ''; printContainer.innerHTML = ''; if(personalSummary) personalSummary.innerHTML = ''; if(reportListContainer) reportListContainer.innerHTML = '';

        const authorProjectHours = {};

        filtered.forEach(r => {
            // 集計データの蓄積
            if (!authorProjectHours[r.author]) authorProjectHours[r.author] = {};
            const days = ['月','火','水','木','金','土','日'];
            days.forEach(day => {
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                ts.forEach(t => {
                    if (t.project && !['有給', '有休', '欠勤', '休日'].includes(t.project)) {
                        authorProjectHours[r.author][t.project] = (authorProjectHours[r.author][t.project] || 0) + parseFloat(t.hours || 0);
                    }
                });
            });
            const tr = document.createElement('tr');
            const dates = getDaysOfWeek(r.week);
            const getDayLabel = (idx, name) => dates ? `${formatDate(dates[idx])}<br>(${name})` : name;
            const renderCell = (day) => {
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                const tasksHtml = ts.map(t => `<div class="day-summary-cell"><strong>${t.project}</strong>${t.detail} (${parseFloat(t.hours||0).toFixed(1)}H)</div>`).join('');
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
                const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
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

            const cardEl = document.createElement('div');
            cardEl.className = 'print-report-card';
            cardEl.style.marginBottom = '25px';

            cardEl.innerHTML = `
                <div class="print-report-header">対象期間: ${formatWeekRange(r.week)} ｜ 担当者: ${r.author || ''}</div>
                <div class="print-report-body">
                    <strong>■ ${r.planStatus === 'approved' ? '業務実績' : '作業予定'}（日別詳細）</strong>
                    <table class="print-task-table">
                        <thead><tr><th>日付(曜)</th><th>工事名</th><th>作業内容</th><th>時間</th><th>日次レポート・備考</th></tr></thead>
                        <tbody>${printTasksHtml || '<tr><td colspan="5" style="text-align:center; padding:10px; color:#64748b;">記録なし</td></tr>'}</tbody>
                    </table>
                </div>
            `;

            // 印刷用カードの生成と追加 (承認パネルを含まないクリーンなプレビュー)
            const printCardEl = document.createElement('div');
            printCardEl.className = 'print-report-card';
            printCardEl.style.marginBottom = '25px';
            printCardEl.innerHTML = cardEl.innerHTML;
            printContainer.appendChild(printCardEl);

            // 管理者のみ承認パネルを表示
            if (currentCompany && currentCompany.role === 'admin') {
                const adminPanel = document.createElement('div');
                adminPanel.className = 'admin-action-card no-print';
                adminPanel.style = 'background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:15px; margin-top:15px; font-size:0.9rem; text-align:left; color:#000000;';
                
                const planStatus = r.planStatus || 'draft';
                const planRejectReason = r.planRejectReason || '';
                const actualStatus = r.actualStatus || (r.status === 'plan' ? 'uncreated' : 'draft');
                const actualRejectReason = r.actualRejectReason || '';

                const getStatusText = (status, rejectReason) => {
                    if (status === 'draft') return '<span style="color:#ea580c;font-weight:bold;">一時保存</span>';
                    if (status === 'uncreated') return '<span style="color:#94a3b8;font-weight:bold;">未作成</span>';
                    if (status === 'submitted') return '<span style="color:#2563eb;font-weight:bold;">提出済 (承認待ち)</span>';
                    if (status === 'approved') return '<span style="color:#16a34a;font-weight:bold;">承認済み</span>';
                    if (status === 'rejected') {
                        let txt = '<span style="color:#dc2626;font-weight:bold;">差し戻し中</span>';
                        if (rejectReason) txt += `<br><span style="font-size:0.8rem;color:#dc2626;">理由: ${rejectReason}</span>`;
                        return txt;
                    }
                    return '未作成';
                };

                const isPlanApproveDisabled = planStatus !== 'submitted';
                const isPlanRejectDisabled = planStatus !== 'submitted';
                const isActualApproveDisabled = (planStatus !== 'approved' || actualStatus !== 'submitted');
                const isActualRejectDisabled = (planStatus !== 'approved' || actualStatus !== 'submitted');
                
                adminPanel.innerHTML = `
                    <h4 style="margin:0 0 10px 0; color:#1e293b; display:flex; align-items:center; gap:6px; font-size:0.95rem; font-weight:bold;">🛡️ 上長承認操作パネル</h4>
                    <div style="display:flex; gap:20px; flex-wrap:wrap; margin-bottom:12px;">
                        <div style="flex:1; min-width:200px; padding:10px; background:#f1f5f9; border-radius:6px; border:1px solid #e2e8f0;">
                            <div style="margin-bottom:6px;"><strong>📅 予定の状況:</strong> ${getStatusText(planStatus, planRejectReason, false)}</div>
                            <div style="display:flex; gap:6px; margin-top:8px;">
                                <button type="button" class="btn btn-success btn-small btn-approve-plan" style="padding:4px 8px; font-size:0.75rem; background-color:#16a34a; color:#fff;" ${isPlanApproveDisabled ? 'disabled' : ''}>👍 承認</button>
                                <button type="button" class="btn btn-danger btn-small btn-reject-plan" style="padding:4px 8px; font-size:0.75rem; background-color:#ef4444; color:#fff;" ${isPlanRejectDisabled ? 'disabled' : ''}>👎 差し戻し</button>
                            </div>
                        </div>
                        <div style="flex:1; min-width:200px; padding:10px; background:#f1f5f9; border-radius:6px; border:1px solid #e2e8f0;">
                            <div style="margin-bottom:6px;"><strong>✅ 実績の状況:</strong> ${getStatusText(actualStatus, actualRejectReason, true)}</div>
                            <div style="display:flex; gap:6px; margin-top:8px;">
                                <button type="button" class="btn btn-success btn-small btn-approve-actual" style="padding:4px 8px; font-size:0.75rem; background-color:#16a34a; color:#fff;" ${isActualApproveDisabled ? 'disabled' : ''}>👍 承認</button>
                                <button type="button" class="btn btn-danger btn-small btn-reject-actual" style="padding:4px 8px; font-size:0.75rem; background-color:#ef4444; color:#fff;" ${isActualRejectDisabled ? 'disabled' : ''}>👎 差し戻し</button>
                            </div>
                        </div>
                    </div>
                    <!-- 差し戻し理由入力エリア (動的) -->
                    <div class="reject-input-area" style="display:none; margin-top:10px; border-top:1px dashed #cbd5e1; padding-top:10px;">
                        <label style="font-weight:bold; display:block; margin-bottom:6px; font-size:0.8rem; color:#dc2626;" class="reject-label-text">差し戻し理由</label>
                        <textarea class="reject-textarea" placeholder="差し戻しの理由を入力してください（社員画面に表示されます）" style="width:100%; height:60px; padding:8px; border-radius:6px; border:1px solid #cbd5e1; font-size:0.85rem; background:#fff; color:#000; resize:none;"></textarea>
                        <div style="display:flex; gap:8px; margin-top:8px; justify-content:flex-end;">
                            <button type="button" class="btn btn-secondary btn-small btn-cancel-reject" style="padding:4px 8px; font-size:0.75rem;">キャンセル</button>
                            <button type="button" class="btn btn-primary btn-small btn-submit-reject" style="padding:4px 8px; font-size:0.75rem; background-color:#2563eb; color:#fff;">差し戻しを確定</button>
                        </div>
                    </div>
                `;

                let activeRejectType = ''; // 'plan' or 'actual'

                const btnApprovePlan = adminPanel.querySelector('.btn-approve-plan');
                const btnRejectPlan = adminPanel.querySelector('.btn-reject-plan');
                const btnApproveActual = adminPanel.querySelector('.btn-approve-actual');
                const btnRejectActual = adminPanel.querySelector('.btn-reject-actual');
                const rejectArea = adminPanel.querySelector('.reject-input-area');
                const rejectLabel = adminPanel.querySelector('.reject-label-text');
                const rejectTextarea = adminPanel.querySelector('.reject-textarea');
                const btnCancelReject = adminPanel.querySelector('.btn-cancel-reject');
                const btnSubmitReject = adminPanel.querySelector('.btn-submit-reject');

                if (btnApprovePlan) {
                    btnApprovePlan.addEventListener('click', async () => {
                        if (!confirm(`${r.author}さんの予定を承認します。よろしいですか？`)) return;
                        try {
                            btnApprovePlan.disabled = true;
                            await updateDoc(doc(db, "reports", r.id), {
                                planStatus: 'approved',
                                planApprovedAt: new Date().toISOString(),
                                planRejectReason: ''
                            });
                            alert('予定を承認しました。');
                            await loadReports(false);
                        } catch (err) {
                            console.error('Approve plan error:', err);
                            alert('エラーが発生しました。');
                            btnApprovePlan.disabled = false;
                        }
                    });
                }

                if (btnApproveActual) {
                    btnApproveActual.addEventListener('click', async () => {
                        if (!confirm(`${r.author}さんの実績を承認します。よろしいですか？`)) return;
                        try {
                            btnApproveActual.disabled = true;
                            await updateDoc(doc(db, "reports", r.id), {
                                actualStatus: 'approved',
                                actualApprovedAt: new Date().toISOString(),
                                approvedAt: new Date().toISOString(),
                                actualRejectReason: '',
                                status: 'approved'
                            });
                            alert('実績を承認しました。');
                            await loadReports(false);
                        } catch (err) {
                            console.error('Approve actual error:', err);
                            alert('エラーが発生しました。');
                            btnApproveActual.disabled = false;
                        }
                    });
                }

                if (btnRejectPlan) {
                    btnRejectPlan.addEventListener('click', () => {
                        activeRejectType = 'plan';
                        rejectLabel.textContent = '予定の差し戻し理由';
                        rejectTextarea.value = '';
                        rejectArea.style.display = 'block';
                        rejectTextarea.focus();
                    });
                }

                if (btnRejectActual) {
                    btnRejectActual.addEventListener('click', () => {
                        activeRejectType = 'actual';
                        rejectLabel.textContent = '実績の差し戻し理由';
                        rejectTextarea.value = '';
                        rejectArea.style.display = 'block';
                        rejectTextarea.focus();
                    });
                }

                if (btnCancelReject) {
                    btnCancelReject.addEventListener('click', () => {
                        rejectArea.style.display = 'none';
                        activeRejectType = '';
                    });
                }

                if (btnSubmitReject) {
                    btnSubmitReject.addEventListener('click', async () => {
                        const reason = rejectTextarea.value.trim();
                        if (!reason) {
                            alert('差し戻し理由を入力してください。');
                            return;
                        }
                        try {
                            btnSubmitReject.disabled = true;
                            const updateData = {};
                            if (activeRejectType === 'plan') {
                                updateData.planStatus = 'rejected';
                                updateData.planRejectReason = reason;
                            } else if (activeRejectType === 'actual') {
                                updateData.actualStatus = 'rejected';
                                updateData.actualRejectReason = reason;
                                updateData.status = 'plan';
                            }
                            
                            await updateDoc(doc(db, "reports", r.id), updateData);
                            alert('差し戻し処理が完了しました。');
                            rejectArea.style.display = 'none';
                            await loadReports(false);
                        } catch (err) {
                            console.error('Reject error:', err);
                            alert('エラーが発生しました。');
                            btnSubmitReject.disabled = false;
                        }
                    });
                }

                cardEl.appendChild(adminPanel);
            }

            // 画面表示用コンテナへの自動追加は廃止 (モーダルでの個別表示に切り替えたため)
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
        renderRemindPanel();
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
            const modeText = summaryDisplayMode === 'site' ? '現場従事時間集計' : '作業時間集計';
            printTitle.textContent = `${year}年${month}月 工事別${modeText}`;
        }

        // 1. カレンダーヘッダーの生成
        let headHtml = `<tr>
            <th style="min-width: 120px; max-width: 120px; font-size: 0.8rem; background: #f1f5f9; position: sticky; left: 0; z-index: 10; padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">工事名</th>
            <th style="min-width: 80px; max-width: 80px; font-size: 0.8rem; background: #f1f5f9; position: sticky; left: 120px; z-index: 10; padding: 6px 4px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">担当者</th>`;
        
        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const dayOfWeekStr = ['日','月','火','水','木','金','土'][dateObj.getDay()];
            const isWeekend = (dateObj.getDay() === 0 || dateObj.getDay() === 6) ? 'color:red;' : '';
            headHtml += `<th style="min-width: 20px; max-width: 24px; text-align: center; font-size: 0.7rem; padding: 4px 1px; ${isWeekend}">${d}<br>${dayOfWeekStr}</th>`;
        }
        headHtml += `<th style="min-width: 50px; text-align: right; background: #f1f5f9; font-size: 0.8rem; padding: 6px 4px;">合計</th></tr>`;
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
                    const ts = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
                    ts.forEach(t => {
                        if (!t.project || !t.hours) return;
                        const proj = t.project;
                        if (['有給', '有休', '欠勤', '休日'].includes(proj)) return;



                        const auth = r.author || '不明';
                        
                        let hrs = 0;
                        if (t.timeline) {
                            if (summaryDisplayMode === 'site') {
                                // 現場従事時間（黒：現場管理のみ）
                                hrs = t.timeline.split('').filter(s => s === '1').length * 0.5;
                            } else {
                                // 合計時間（作業・移動・現場管理以外の業務）
                                hrs = t.timeline.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                            }
                        } else {
                            // タイムラインが存在しない過去データ等のフォールバック
                            if (summaryDisplayMode === 'site') {
                                hrs = 0;
                            } else {
                                hrs = parseFloat(t.hours || 0);
                            }
                        }
                        
                        if (hrs === 0) return;
                        
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
                
                bodyHtml += `<td style="font-weight: bold; background: #fff; position: sticky; left: 0; z-index: 5; border-right: 1px solid var(--border); font-size: 0.8rem; padding: 6px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; max-width: 120px;">${proj}</td>`;
                bodyHtml += `<td style="background: #fff; position: sticky; left: 120px; z-index: 5; border-right: 1px solid var(--border); font-size: 0.8rem; padding: 6px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; max-width: 80px;">${auth}</td>`;
                
                for (let d = 1; d <= daysInMonth; d++) {
                    const hrs = data.days[d];
                    const displayHrs = hrs ? hrs.toFixed(1) : '';
                    const style = hrs ? 'background-color: #f0fdf4; font-weight: bold; text-align: center;' : 'text-align: center; color: #cbd5e1;';
                    bodyHtml += `<td style="font-size: 0.72rem; padding: 4px 1px; ${style}">${hrs ? displayHrs : ''}</td>`;
                }
                
                bodyHtml += `<td style="text-align: right; font-weight: bold; color: var(--primary); background: #f8fafc; font-size: 0.8rem; padding: 6px 4px;">${data.total.toFixed(1)}H</td>`;
                bodyHtml += `</tr>`;
            });
        });
        
        tbody.innerHTML = bodyHtml;
    };

    ['filter-month', 'filter-author'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderTable);
    });
    ['summary-filter-month'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', renderSummaryTable);
    });

    // 工事別集計の表示モード切り替えロジック
    let summaryDisplayMode = 'total'; // 'total' (合計) または 'site' (現場従事時間)
    const btnSummaryModeTotal = document.getElementById('btn-summary-mode-total');
    const btnSummaryModeSite = document.getElementById('btn-summary-mode-site');

    const updateSummaryModeButtons = () => {
        if (!btnSummaryModeTotal || !btnSummaryModeSite) return;
        if (summaryDisplayMode === 'total') {
            btnSummaryModeTotal.style.background = '#ffffff';
            btnSummaryModeTotal.style.color = '#0f172a';
            btnSummaryModeTotal.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            btnSummaryModeSite.style.background = 'transparent';
            btnSummaryModeSite.style.color = '#64748b';
            btnSummaryModeSite.style.boxShadow = 'none';
        } else {
            btnSummaryModeSite.style.background = '#ffffff';
            btnSummaryModeSite.style.color = '#0f172a';
            btnSummaryModeSite.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            btnSummaryModeTotal.style.background = 'transparent';
            btnSummaryModeTotal.style.color = '#64748b';
            btnSummaryModeTotal.style.boxShadow = 'none';
        }
    };

    // 初期化時のスタイル適用
    updateSummaryModeButtons();

    if (btnSummaryModeTotal) {
        btnSummaryModeTotal.addEventListener('click', () => {
            if (summaryDisplayMode === 'total') return;
            summaryDisplayMode = 'total';
            updateSummaryModeButtons();
            renderSummaryTable();
        });
    }
    if (btnSummaryModeSite) {
        btnSummaryModeSite.addEventListener('click', () => {
            if (summaryDisplayMode === 'site') return;
            summaryDisplayMode = 'site';
            updateSummaryModeButtons();
            renderSummaryTable();
        });
    }

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
        if (isLandscape === 'A4 landscape') {
            style.innerHTML = '@media print { @page { size: A4 landscape !important; margin: 10mm !important; } }';
        } else if (isLandscape) {
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
        // ガントチャート印刷用の特例クラスをリセットして再設定
        printArea.classList.remove('print-landscape-gantt');
        if (contentSourceId === 'gantt-container') {
            printArea.classList.add('print-landscape-gantt');
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
            if (contentSourceId === 'gantt-container') {
                clone.style.width = 'max-content'; // 横長グリッドが潰れないようにmax-contentにする
            } else {
                clone.style.width = '100%'; // 工事集計等は紙の幅いっぱいに収めるため100%
            }
            
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
    window.doPrint = doPrint;

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
        const weekInput = document.getElementById('week');
        const authorInput = document.getElementById('author');
        if (!weekInput || !authorInput) return;
        
        const weekVal = weekInput.value;
        const weekText = weekInput.options[weekInput.selectedIndex]?.text || '';
        const authorVal = authorInput.value;
        
        // 承認状態と日付の取得
        const existingReport = allReports.find(r => r.week === weekVal && r.author === authorVal);
        let isPlanApproved = false;
        let planApprovedDateStr = '';
        let isActualApproved = false;
        let actualApprovedDateStr = '';

        if (existingReport) {
            const pStatus = existingReport.planStatus || (existingReport.status === 'approved' ? 'approved' : 'draft');
            isPlanApproved = pStatus === 'approved';
            if (isPlanApproved && existingReport.planApprovedAt) {
                const pDate = new Date(existingReport.planApprovedAt);
                planApprovedDateStr = `${pDate.getMonth() + 1}/${pDate.getDate()}`;
            } else if (isPlanApproved) {
                const now = new Date();
                planApprovedDateStr = `${now.getMonth() + 1}/${now.getDate()}`;
            }

            const aStatus = existingReport.actualStatus || (existingReport.status === 'approved' ? 'approved' : 'draft');
            isActualApproved = aStatus === 'approved';
            if (isActualApproved && (existingReport.actualApprovedAt || existingReport.approvedAt)) {
                const aDate = new Date(existingReport.actualApprovedAt || existingReport.approvedAt);
                actualApprovedDateStr = `${aDate.getMonth() + 1}/${aDate.getDate()}`;
            } else if (isActualApproved) {
                const now = new Date();
                actualApprovedDateStr = `${now.getMonth() + 1}/${now.getDate()}`;
            }
        }
        
        // 画面の入力内容を収集
        const daysData = {};
        daysName.forEach(day => {
            const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
            const dayCard = taskList ? taskList.closest('.day-card') : null;
            if (!dayCard) return;
            const cardData = taskList.getCardData ? taskList.getCardData() : {};
            const tasks = [];
            
            const fullTimeline = cardData.timeline || '0'.repeat(48);
            
            // 午前(morning): 5:00〜12:00 (インデックス 0〜13)
            // 午後(afternoon): 12:00〜18:00 (インデックス 14〜25)
            // 夜間(night): 18:00〜翌5:00 (インデックス 26〜47)
            const periodTimeline = (period) => {
                let start = 0;
                let end = 48;
                if (period === 'morning') {
                    start = 0;
                    end = 14;
                } else if (period === 'afternoon') {
                    start = 14;
                    end = 26;
                } else if (period === 'night') {
                    start = 26;
                    end = 48;
                }
                const prefix = '0'.repeat(start);
                const body = fullTimeline.substring(start, end);
                const suffix = '0'.repeat(48 - end);
                return prefix + body + suffix;
            };
            
            const hasLeave = !!cardData.leaveType;

            ['morning', 'afternoon', 'night'].forEach(period => {
                const proj = cardData[period]?.project || '';
                const det = cardData[period]?.detail || '';
                const rep = cardData[period]?.report || '';
                if (proj || det || rep) {
                    const taskTimeline = periodTimeline(period);
                    // 各時間帯ごとの作業・移動コマから作業時間を計算
                    const periodWorkHours = taskTimeline.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    tasks.push({ 
                        project: proj, 
                        detail: det, 
                        report: rep,
                        hours: periodWorkHours, 
                        timeline: taskTimeline 
                    });
                }
            });
            
            if (hasLeave) {
                tasks.push({ project: cardData.leaveType, detail: '', report: '', hours: 0, timeline: '' });
            }
            
            const tl = cardData.timeline || '';
            const mr = dayCard.querySelector('.morning-report')?.value.trim() || '';
            const ar = dayCard.querySelector('.afternoon-report')?.value.trim() || '';
            const nr = dayCard.querySelector('.night-report')?.value.trim() || '';
            const reports = [];
            if (mr) reports.push(`【午前】${mr}`);
            if (ar) reports.push(`【午後】${ar}`);
            if (nr) reports.push(`【夜間】${nr}`);
            const reportText = reports.join('\n');
            daysData[day] = { tasks, reportText, timeline: tl };
        });
        
        const dates = getDaysOfWeek(weekVal);
        const formatPrintDate = (dateObj, dayName) => {
            if (!dateObj) return `${dayName}曜日`;
            return `${dateObj.getMonth() + 1}月${dateObj.getDate()}日<br>(${dayName})`;
        };
        
        let html = `<div class="weekly-print-wrapper">`;
        
        // ヘッダー（A4印刷フォーマット）
        html += `
        <div class="weekly-print-header">
            <div style="width: 200px; display: flex; flex-direction: column; gap: 4px;">
                <span style="font-size: 8.5pt; font-weight: bold; border: 1px solid #000; padding: 2px 6px; width: fit-content;">WF申請</span>
            </div>
            <div class="weekly-print-title">週間行動予定表（工事管理課）</div>
            <div>
                <table class="approval-table">
                    <thead>
                        <tr>
                            <th>&#x4E88;&#x5B9A;</th>
                            <th>&#x5B9F;&#x7E3E;</th>
                            <th>&#x62C5;&#x5F53;&#x8005;</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                ${isPlanApproved ? `<div class="stamp-approved">&#x4E0A;&#x9577;<br><span>${planApprovedDateStr}</span></div>` : ''}
                            </td>
                            <td>
                                ${isActualApproved ? `<div class="stamp-approved">&#x4E0A;&#x9577;<br><span>${actualApprovedDateStr}</span></div>` : ''}
                            </td>
                            <td style="padding: 0; text-align: center; vertical-align: middle;">
                                <div style="font-weight: bold; font-size: 8pt; writing-mode: vertical-rl; text-align: center; letter-spacing: 0.5px; white-space: nowrap; line-height: 1.1; margin: 0 auto; display: inline-block;">
                                    ${(authorVal || '').replace(/\s+/g, '').substring(0, 5)}
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        `;
        
        // サブヘッダー（対象週と凡例）
        html += `
        <div class="weekly-print-subheader">
            <div style="font-size: 9pt;">対象週: ${weekText} (${formatWeekRange(weekVal)})</div>
            <div class="legend-box">
                <div class="legend-item">
                    <span class="legend-color" style="background: #000000;"></span>
                    <span>現場管理</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #2563eb;"></span>
                    <span>現場管理以外の業務</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #ef4444;"></span>
                    <span>休憩</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #16a34a;"></span>
                    <span>移動</span>
                </div>
                <div class="legend-item">
                    <span class="legend-color" style="background: #94a3b8;"></span>
                    <span>有休</span>
                </div>
            </div>
        </div>
        `;
        
        // 各曜日のデータ出力
        daysName.forEach((day, idx) => {
            const dayObj = daysData[day];
            const tasks = dayObj.tasks;
            const reportText = dayObj.reportText;
            const dateObj = dates ? dates[idx] : null;
            
            const isWeekend = day === '土' || day === '日';
            const isSlimDay = isWeekend && tasks.length === 0 && !reportText;
            const blockClass = isSlimDay ? 'print-day-block print-day-block-slim' : 'print-day-block';
            html += `<div class="${blockClass}">`;
            
            // テーブル
            html += `
            <table class="print-day-table">
                <thead>
                    <tr>
                        <th class="col-date">日時</th>
                        <th class="col-project">訪問先</th>
                        <th class="col-time">時間</th>
                        <th class="col-direct">直行直帰</th>
                        <th class="col-detail">記録</th>
                    </tr>
                </thead>
                <tbody>
            `;
            
            if (tasks.length === 0) {
                html += `
                    <tr>
                        <td class="col-date">${formatPrintDate(dateObj, day)}</td>
                        <td class="col-project">-</td>
                        <td class="col-time">-</td>
                        <td class="col-direct"></td>
                        <td class="col-detail" style="text-align: left; white-space: pre-wrap; font-size: 8.5pt; color: #2563eb;">${reportText || ''}</td>
                    </tr>
                `;
            } else {
                tasks.forEach((task, tIdx) => {
                    const timeIntervals = getTimelineIntervals(task.timeline);
                    const timeStr = timeIntervals.join('<br>') || (task.hours > 0 ? `${parseFloat(task.hours).toFixed(1)}H` : '-');
                    
                    let detailContent = task.detail || '';
                    
                    // 有休や休日などの休暇タスクでなく、かつその時間帯のレポートが存在する場合に適用
                    const isLeaveTask = ['有給', '有休', '欠勤', '休日'].includes(task.project);
                    if (!isLeaveTask && task.report) {
                        detailContent += `<div style="font-size: 8pt; color: #2563eb; margin-top: 4px; border-top: 1px dashed #94a3b8; padding-top: 3px; text-align: left; white-space: pre-wrap;">${task.report}</div>`;
                    }
                    
                    html += `
                        <tr>
                            ${tIdx === 0 ? `<td class="col-date" rowspan="${tasks.length}">${formatPrintDate(dateObj, day)}</td>` : ''}
                            <td class="col-project" style="text-align: left; font-weight: bold;">${task.project || ''}</td>
                            <td class="col-time" style="font-size: 8pt;">${timeStr}</td>
                            <td class="col-direct"></td>
                            <td class="col-detail" style="text-align: left; white-space: pre-wrap; font-size: 8.5pt;">${detailContent}</td>
                        </tr>
                    `;
                });
            }
            
            html += `
                </tbody>
            </table>
            `;
            
            // マージタイムライン
            let mergedTimeline = Array(48).fill(0);
            let dayTotal = 0;
            let daySiteTotal = 0;
            const tlStr = dayObj.timeline || '';
            if (tlStr && tlStr.length === 48) {
                for (let i = 0; i < 48; i++) {
                    mergedTimeline[i] = parseInt(tlStr[i]) || 0;
                }
                dayTotal = tlStr.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                daySiteTotal = tlStr.split('').filter(s => s === '1').length * 0.5;
            }
            
            html += `
            <div class="print-timeline-row">
                <div class="print-timeline-label">時間</div>
                <div class="print-timeline-hours">
                    <div class="print-timeline-header-cells">
            `;
            for (let h = 5; h < 29; h++) {
                const displayHour = h % 24;
                html += `<div class="print-timeline-hour-cell">${displayHour}</div>`;
            }
            html += `
                    </div>
                    <div class="print-timeline-grid-cells">
            `;
            for (let i = 0; i < 48; i++) {
                const state = mergedTimeline[i];
                html += `<div class="print-timeline-cell" data-state="${state}"></div>`;
            }
            html += `
                    </div>
                </div>
                <div class="print-timeline-total">計 ${dayTotal.toFixed(1)}H<br>(現場従事 ${daySiteTotal.toFixed(1)}H)</div>
            </div>
            `;
            
            html += `</div>`; // .print-day-block
        });
        
        html += `</div>`; // .weekly-print-wrapper
        
        // 印刷用一時エリアを取得
        const printContainer = document.getElementById('print-weekly-action-container');
        if (printContainer) {
            printContainer.innerHTML = html;
        }

        // 既存の動的スタイルを削除
        const existingStyle = document.getElementById('print-dynamic-style');
        if (existingStyle) existingStyle.remove();

        // 印刷用のスタイル（A4縦）を動的に注入
        const style = document.createElement('style');
        style.id = 'print-dynamic-style';
        style.innerHTML = `
            @media print {
                @page { size: A4 portrait !important; margin: 6mm 10mm !important; }
                
                /* html, body を紙の横幅100%に強制し、横幅が半分に縮むのを防止する */
                html, body {
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible !important;
                }
                
                /* ガントチャート印刷用の一時エリアやメインアプリを完全に非表示にし、さらに幅計算に干渉しないようサイズを0にする */
                #app-container,
                #login-container,
                #loading-container,
                #print-active-area,
                .no-print {
                    display: none !important;
                    width: 0 !important;
                    height: 0 !important;
                    overflow: hidden !important;
                    position: absolute !important;
                    top: -9999px !important;
                    left: -9999px !important;
                }
                
                /* 週報専用コンテナの幅は安定した100%に戻す */
                #print-weekly-action-container {
                    display: block !important;
                    width: 100% !important;
                    min-width: 100% !important;
                    max-width: 100% !important;
                    position: static !important;
                    background: white !important;
                    color: black !important;
                    font-family: "Hiragino Kaku Gothic ProN", "MS Gothic", sans-serif !important;
                }
                
                .weekly-print-wrapper {
                    width: calc(100% - 4px) !important;
                    max-width: calc(100% - 4px) !important;
                    margin: 0 auto !important;
                    box-sizing: border-box !important;
                }
                .weekly-print-header { display: flex !important; justify-content: space-between !important; align-items: flex-end !important; width: 100% !important; margin-bottom: 4px !important; height: 90px !important; box-sizing: border-box !important; }
                .weekly-print-title { font-size: 13pt !important; font-weight: bold !important; text-align: center !important; letter-spacing: 2px !important; text-decoration: underline !important; text-underline-offset: 3px !important; margin: 0 !important; padding-bottom: 2px !important; white-space: nowrap !important; }
                
                /* 押印欄の横幅引き伸ばしバグの修正（幅を126pxおよびセル42pxに完全固定） */
                .approval-table { border-collapse: collapse !important; width: 126px !important; min-width: 126px !important; max-width: 126px !important; margin: 0 0 0 auto !important; table-layout: fixed !important; }
                .approval-table th { font-size: 7.5pt !important; font-weight: bold !important; color: #000 !important; padding: 2px 3px !important; border: 1px solid #000 !important; background: #f1f5f9 !important; text-align: center !important; width: 42px !important; min-width: 42px !important; max-width: 42px !important; white-space: nowrap !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .approval-table td { border: 1px solid #000 !important; width: 42px !important; min-width: 42px !important; max-width: 42px !important; height: 56px !important; text-align: center !important; vertical-align: middle !important; font-size: 7.5pt !important; padding: 2px !important; box-sizing: border-box !important; }
                
                .stamp-approved { font-size: 7.5pt !important; font-weight: bold !important; color: #dc2626 !important; border: 1.8px solid #dc2626 !important; border-radius: 50% !important; width: 35px !important; height: 35px !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-direction: column !important; margin: 0 auto !important; line-height: 1.1 !important; }
                .stamp-approved span { font-size: 5.5pt !important; font-weight: normal !important; margin-top: 1px !important; }
                .weekly-print-subheader { display: flex !important; justify-content: space-between !important; align-items: center !important; font-size: 7.8pt !important; margin-bottom: 3px !important; font-weight: bold !important; }
                .legend-box { display: flex !important; gap: 10px !important; align-items: center !important; }
                .legend-item { display: flex !important; align-items: center !important; gap: 3px !important; }
                .legend-color { width: 12px !important; height: 12px !important; border: 1px solid #000 !important; display: inline-block !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-day-block { border: 1px solid #000 !important; margin-bottom: 4px !important; page-break-inside: avoid !important; }
                
                /* 明示的に曜日テーブルの幅を100%に指定 */
                .print-day-table { width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important; }
                .print-day-table th, .print-day-table td { border: 1px solid #000 !important; padding: 2px 4px !important; font-size: 8pt !important; vertical-align: middle !important; height: 22px !important; box-sizing: border-box !important; }
                .print-day-table th { background: #f1f5f9 !important; font-weight: bold !important; text-align: center !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .col-date { width: 12% !important; text-align: center !important; font-weight: bold !important; }
                .col-project { width: 22% !important; }
                .col-time { width: 12% !important; text-align: center !important; }
                .col-direct { width: 12% !important; text-align: center !important; vertical-align: middle !important; }
                .col-detail { width: 42% !important; }
                .print-timeline-row { display: flex !important; align-items: stretch !important; border-top: 1px solid #000 !important; background: #fff !important; height: 24px !important; }
                .print-timeline-label { width: 12% !important; font-size: 7.2pt !important; text-align: center !important; font-weight: bold !important; border-right: 1px solid #000 !important; display: flex !important; align-items: center !important; justify-content: center !important; background: #f8fafc !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-timeline-hours { flex: 1 !important; display: flex !important; flex-direction: column !important; border-right: 1px solid #000 !important; }
                .print-timeline-header-cells { display: flex !important; justify-content: space-between !important; font-size: 5.5pt !important; height: 10px !important; line-height: 10px !important; border-bottom: 1px solid #000 !important; padding: 0 4px !important; }
                .print-timeline-hour-cell { width: 0 !important; overflow: visible !important; display: flex !important; justify-content: center !important; font-size: 5.5pt !important; white-space: nowrap !important; }
                .print-timeline-grid-cells { display: flex !important; height: 12px !important; padding: 0 4px !important; }
                .print-timeline-cell { flex: 1 !important; border-right: 1px dashed #ccc !important; height: 100% !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
                .print-timeline-cell:nth-child(2n) { border-right: 1px solid #000 !important; }
                .print-timeline-cell:last-child { border-right: none !important; }
                .print-timeline-cell[data-state="0"] { background: #fff !important; }
                .print-timeline-cell[data-state="1"] { background: #000 !important; }
                .print-timeline-cell[data-state="2"] { background: #ef4444 !important; }
                .print-timeline-cell[data-state="3"] { background: #16a34a !important; }
                .print-timeline-cell[data-state="4"] { background: #94a3b8 !important; }
                .print-timeline-cell[data-state="5"] { background: #2563eb !important; }
                .print-timeline-total { width: 15% !important; font-size: 7.2pt !important; text-align: center !important; font-weight: bold !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; line-height: 1.2 !important; }
                
                .print-day-block-slim { margin-bottom: 2px !important; }
                .print-day-block-slim .print-day-table td, .print-day-block-slim .print-day-table th { height: 16px !important; padding: 1px 4px !important; font-size: 7.8pt !important; }
                .print-day-block-slim .print-timeline-row { display: none !important; }
            }
        `;
        document.head.appendChild(style);

        // 印刷モードのクラスを body に追加してスタイルの干渉を防ぐ
        document.body.classList.add('print-weekly-mode');

        // 印刷ダイアログが閉じた後のクリーンアップ処理を定義
        const cleanup = () => {
            document.body.classList.remove('print-weekly-mode');
            if (printContainer) printContainer.innerHTML = '';
            if (style) style.remove();
            window.removeEventListener('afterprint', cleanup);
        };
        // 印刷完了・キャンセルイベントを監視
        window.addEventListener('afterprint', cleanup);

        setTimeout(() => {
            window.print();
        }, 150);
    };

    const btnPrintWeekly = document.getElementById('btn-print-weekly-top');
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
                const taskList = document.querySelector(`.task-list[data-day="${day}"]`);
                const dayCard = taskList ? taskList.closest('.day-card') : null;
                if (!dayCard) return;
                const cardData = taskList.getCardData ? taskList.getCardData() : {};
                const tasks = [];
                ['morning', 'afternoon', 'night'].forEach(period => {
                    const proj = cardData[period]?.project || '';
                    const det = cardData[period]?.detail || '';
                    if (proj || det) tasks.push({ project: proj, detail: det, hours: 0, timeline: cardData.timeline || '' });
                });
                if (cardData.leaveType) tasks.push({ project: cardData.leaveType, detail: '', hours: 0, timeline: '' });
                const tl = cardData.timeline || '';
                const workHours = tl ? tl.split('').filter(s => s === '1' || s === '3').length * 0.5 : 0;
                if (tasks.length > 0 && !cardData.leaveType) tasks[0].hours = workHours;
                const reportText = dayCard.querySelector('.day-report-text')?.value.trim() || '';
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

            // A3横・横幅1ページ収まり(フィット印刷)設定の適用 (読み取り専用オブジェクトのため個別メンバへ代入)
            sheet.pageSetup.paperSize = 8; // A3
            sheet.pageSetup.orientation = 'landscape';
            sheet.pageSetup.fitToPage = true;
            sheet.pageSetup.fitToWidth = 1;
            sheet.pageSetup.fitToHeight = 0;
            sheet.pageSetup.scale = undefined; // scaleが設定されているとfitToPageが無視されるため無効化

            // カラーコード変換ヘルパー
            const hexToARGB = (hex) => {
                if (!hex) return 'FF16A34A';
                return 'FF' + hex.replace('#', '').toUpperCase();
            };

            const hslToHex = (h, s, l) => {
                l /= 100;
                const a = s * Math.min(l, 1 - l) / 100;
                const f = n => {
                    const k = (n + h / 30) % 12;
                    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
                    return Math.round(255 * color).toString(16).padStart(2, '0');
                };
                return `#${f(0)}${f(8)}${f(4)}`;
            };

            // 列幅の設定
            const leftWidths = [12, 9, 12, 6, 7, 7, 9, 7, 9, 6];
            sheet.columns = [
                ...leftWidths.map(w => ({ width: w })),
                ...dateList.map(() => ({ width: 0.5 })) // タイムライン列をさらに極細(0.5)にして全体幅を圧縮
            ];

            // ----------------------------------------
            // 行1: 月ヘッダー
            // ----------------------------------------
            const row1 = sheet.getRow(1);
            row1.height = 25;
            
            // 左側結合
            sheet.mergeCells(1, 1, 1, 10);
            const detailHeaderCell = row1.getCell(1);
            detailHeaderCell.value = `工程管理表　${selectedYear}年度`;
            detailHeaderCell.font = { name: 'MS Gothic', size: 10, bold: true };
            detailHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' };
            detailHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            detailHeaderCell.border = {
                top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }, bottom: { style: 'thin' }
            };

            // 右側月ヘッダー結合
            let startCol = 11;
            dateList.forEach((d, idx) => {
                const m = d.getMonth() + 1;
                const nextDate = dateList[idx + 1];
                const isLastDay = !nextDate || nextDate.getMonth() !== d.getMonth();

                if (isLastDay) {
                    const endCol = idx + 11; // 1-indexed column index
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
                        left: { style: startCol === 11 ? 'thin' : 'none' },
                        right: { style: !nextDate ? 'medium' : 'medium' }
                    };
                    startCol = endCol + 1;
                }
            });

            // ----------------------------------------
            // 行2: 詳細項目ヘッダー ＆ カレンダー日ヘッダー
            // ----------------------------------------
            const row2 = sheet.getRow(2);
            row2.height = 30;

            const leftHeaders = [
                "工事名", "元請", "住所", "t数", "詳細図", "現寸", 
                "第三者検査会社", "責任者", "建て方予定", "完了"
            ];
            
            leftHeaders.forEach((lh, idx) => {
                const cell = row2.getCell(idx + 1);
                cell.value = lh;
                cell.font = { name: 'MS Gothic', size: 9, bold: true };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                cell.border = {
                    top: { style: 'thin' },
                    bottom: { style: 'medium' },
                    left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                    right: { style: 'thin' }
                };
            });

            dateList.forEach((d, idx) => {
                const colIdx = idx + 11;
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
            const leftColCount = 10;
            targetSchedules.forEach((s, index) => {
                const rowIndex = index + 3;
                const row = sheet.getRow(rowIndex);
                row.height = 24;

                const displayCompleted = s.completed ? '完了' : '-';

                const leftValues = [
                    s.project || '',
                    s.client || '-',
                    s.address || '-',
                    s.tonnage ? s.tonnage + 't' : '-',
                    s.drawing || '-',
                    s.lofting || '-',
                    s.inspectionCompany || '-',
                    s.chiefTech || '-',
                    s.erectionDate || '-',
                    displayCompleted
                ];

                leftValues.forEach((val, idx) => {
                    const cell = row.getCell(idx + 1);
                    cell.value = val;
                    cell.font = { name: 'MS Gothic', size: 9 };
                    cell.alignment = { 
                        horizontal: (idx >= 8) ? 'center' : ((idx === 3) ? 'right' : 'left'),
                        vertical: 'middle', wrapText: true 
                    };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'thin' },
                        left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    // 完了かつ完了カラムなら緑色太字
                    if (false) {
                        cell.font = { name: 'MS Gothic', size: 9, bold: true, color: { argb: 'FF16A34A' } };
                    }
                });

                // カレンダー背景セルの初期化 (土日・月境界の描画)
                dateList.forEach((d, idx) => {
                    const colIdx = idx + 11;
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
                    const barStartCol = startIdx + 11;
                    const barEndCol = endIdx + 11;

                    // バーに該当する各セルにスタイルを適用 (結合されるため、スタイル共有崩れ対策として個別適用)
                    const colorHex = (s.barColor && s.barColor !== '#2563eb') ? s.barColor : hslToHex(Math.round((360 / Math.max(targetSchedules.length, 1)) * index), 70, 45);
                    const colorARGB = hexToARGB(colorHex);
                    
                    for (let c = barStartCol; c <= barEndCol; c++) {
                        const cell = row.getCell(c);
                        
                        // ストライプか通常塗りつぶしか
                        if (false) {
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
                            strike: false
                        };
                    }

// 結合後の代表セル（開始セル）にラベルをセット（バー内テキストは空にする）
                    const mergedStartCell = row.getCell(barStartCol);
                    mergedStartCell.value = '';
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

    // Excel Export (History - Monthly)
    const btnExportHistory = document.getElementById('btn-export-history');
    if (btnExportHistory) {
        btnExportHistory.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') return alert('ExcelJSライブラリの読み込みに失敗しました。');
            
            const originalText = btnExportHistory.textContent;
            btnExportHistory.disabled = true;
            btnExportHistory.textContent = '出力中...';

            try {
                const filterMonthSelect = document.getElementById('history-filter-month');
                const filterProjectSelect = document.getElementById('history-filter-project');
                const filterAuthorSelect = document.getElementById('history-filter-author');

                let selectedMonth = filterMonthSelect ? filterMonthSelect.value : '';
                const selectedProject = filterProjectSelect ? filterProjectSelect.value : '';
                const selectedAuthor = filterAuthorSelect ? filterAuthorSelect.value : '';

                if (!selectedMonth) {
                    const months = [...new Set(allDailyReports.map(r => r.date ? r.date.substring(0, 7) : ''))].filter(Boolean).sort().reverse();
                    if (months.length > 0) {
                        selectedMonth = months[0];
                    } else {
                        return alert('出力する日報データがありません。');
                    }
                }

                const [year, month] = selectedMonth.split('-').map(Number);
                const daysInMonth = new Date(year, month, 0).getDate();

                let filteredReports = allDailyReports.filter(r => r.date && r.date.startsWith(selectedMonth));
                if (selectedProject) filteredReports = filteredReports.filter(r => r.projectId === selectedProject);
                if (selectedAuthor) filteredReports = filteredReports.filter(r => r.author === selectedAuthor || r.email === selectedAuthor);

                if (filteredReports.length === 0) {
                    return alert('出力条件に一致する日報データがありません。');
                }

                // 集計用マップ
                const gridData = new Map();
                filteredReports.forEach(r => {
                    if (!r.projectName || !r.date) return;
                    const dayNum = parseInt(r.date.substring(8, 10), 10);
                    if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInMonth) return;

                    const tasks = Array.isArray(r.tasks) ? r.tasks : (r.tasks ? [r.tasks] : []);
                    const hours = parseFloat(r.hours) || 0;

                    tasks.forEach(task => {
                        if (!task) return;
                        let taskName = task;
                        if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                            taskName = `その他（${r.notes.trim()}）`;
                        }

                        if (!gridData.has(r.projectName)) {
                            gridData.set(r.projectName, new Map());
                        }
                        const projectMap = gridData.get(r.projectName);
                        if (!projectMap.has(taskName)) {
                            projectMap.set(taskName, new Array(daysInMonth + 1).fill(0));
                        }
                        projectMap.get(taskName)[dayNum] += hours;
                    });
                });

                const TASK_ORDER = [
                    "一次加工", "組立て", "溶接", "塗装", "出荷",
                    "積算", "見積作成", "図面作図", "原寸", "打合せ",
                    "自主検査", "検査準備", "検査受検", "是正対応", "出荷準備", "その他"
                ];
                const getTaskOrderIndex = (task) => {
                    const idx = TASK_ORDER.indexOf(task);
                    return idx === -1 ? 999 : idx;
                };

                const sortedProjects = [...gridData.keys()].sort();
                const rows = [];
                const projectRowSpans = {};
                sortedProjects.forEach(proj => {
                    const projectMap = gridData.get(proj);
                    const sortedTasks = [...projectMap.keys()].sort((a, b) => getTaskOrderIndex(a) - getTaskOrderIndex(b));

                    sortedTasks.forEach(task => {
                        const dailyHours = projectMap.get(task);
                        const totalHours = dailyHours.reduce((sum, h) => sum + h, 0);
                        if (totalHours > 0) {
                            rows.push({
                                projectName: proj,
                                taskName: task,
                                dailyHours,
                                totalHours
                            });
                            projectRowSpans[proj] = (projectRowSpans[proj] || 0) + 1;
                        }
                    });
                });

                if (rows.length === 0) return alert('稼稼働実績データがありません。');

                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('工事別作業集計_月間');

                sheet.pageSetup.paperSize = 8; // A3
                sheet.pageSetup.orientation = 'landscape';
                sheet.pageSetup.fitToPage = true;
                sheet.pageSetup.fitToWidth = 1;
                sheet.pageSetup.fitToHeight = 0;
                sheet.pageSetup.scale = undefined;

                const colWidths = [18, 15, ...new Array(daysInMonth).fill(3.2), 8];
                sheet.columns = colWidths.map(w => ({ width: w }));

                const row1 = sheet.getRow(1);
                row1.height = 28;
                sheet.mergeCells(1, 1, 1, 2 + daysInMonth + 1);
                const titleCell = row1.getCell(1);
                titleCell.value = `${year}年${month}月 工事別作業集計表（月間）`;
                titleCell.font = { name: 'MS Gothic', size: 12, bold: true };
                titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
                titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                titleCell.border = {
                    top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' }, bottom: { style: 'thin' }
                };

                const row2 = sheet.getRow(2);
                const row3 = sheet.getRow(3);
                row2.height = 20;
                row3.height = 20;

                sheet.mergeCells(2, 1, 3, 1);
                const hProj = row2.getCell(1);
                hProj.value = "工事名";
                hProj.font = { name: 'MS Gothic', size: 9, bold: true };
                hProj.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                hProj.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                hProj.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }
                };
                
                sheet.mergeCells(2, 2, 3, 2);
                const hTask = row2.getCell(2);
                hTask.value = "作業内容";
                hTask.font = { name: 'MS Gothic', size: 9, bold: true };
                hTask.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                hTask.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                hTask.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' }
                };

                const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
                for (let d = 1; d <= daysInMonth; d++) {
                    const dateObj = new Date(year, month - 1, d);
                    const wday = dateObj.getDay();
                    const isSat = wday === 6;
                    const isSun = wday === 0;

                    let bgColor = 'FFF1F5F9';
                    if (isSat) bgColor = 'FFE0F2FE';
                    if (isSun) bgColor = 'FFFEE2E2';

                    const cellD = row2.getCell(2 + d);
                    cellD.value = d;
                    cellD.font = { name: 'MS Gothic', size: 8, bold: true };
                    cellD.alignment = { horizontal: 'center', vertical: 'middle' };
                    cellD.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    cellD.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

                    const cellW = row3.getCell(2 + d);
                    cellW.value = dayNames[wday];
                    cellW.font = { name: 'MS Gothic', size: 8, bold: true };
                    cellW.alignment = { horizontal: 'center', vertical: 'middle' };
                    cellW.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
                    cellW.border = { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };
                }

                const totColIndex = 2 + daysInMonth + 1;
                sheet.mergeCells(2, totColIndex, 3, totColIndex);
                const hTot = row2.getCell(totColIndex);
                hTot.value = "合計";
                hTot.font = { name: 'MS Gothic', size: 9, bold: true };
                hTot.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                hTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                hTot.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'medium' }
                };

                let currentRowNum = 4;
                const dailyTotals = new Array(daysInMonth + 1).fill(0);
                let grandTotal = 0;

                rows.forEach(r => {
                    const row = sheet.getRow(currentRowNum);
                    row.height = 24;

                    const cellProj = row.getCell(1);
                    cellProj.value = r.projectName;
                    cellProj.font = { name: 'MS Gothic', size: 9, bold: true };
                    cellProj.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
                    cellProj.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'medium' }, right: { style: 'thin' }
                    };

                    const cellTask = row.getCell(2);
                    cellTask.value = r.taskName;
                    cellTask.font = { name: 'MS Gothic', size: 9 };
                    cellTask.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
                    cellTask.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }
                    };

                    for (let d = 1; d <= daysInMonth; d++) {
                        const hours = r.dailyHours[d];
                        dailyTotals[d] += hours;

                        const cell = row.getCell(2 + d);
                        cell.value = hours > 0 ? hours : '';
                        cell.font = { name: 'MS Gothic', size: 9 };
                        cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        cell.border = {
                            top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }
                        };
                    }

                    const cellTot = row.getCell(totColIndex);
                    cellTot.value = r.totalHours;
                    grandTotal += r.totalHours;
                    cellTot.font = { name: 'MS Gothic', size: 9, bold: true };
                    cellTot.alignment = { horizontal: 'right', vertical: 'middle' };
                    cellTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    cellTot.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'medium' }
                    };

                    currentRowNum++;
                });

                let mergeStart = 4;
                sortedProjects.forEach(proj => {
                    const rowspan = projectRowSpans[proj];
                    if (rowspan > 1) {
                        sheet.mergeCells(mergeStart, 1, mergeStart + rowspan - 1, 1);
                    }
                    mergeStart += rowspan;
                });

                const totRow = sheet.getRow(currentRowNum);
                totRow.height = 24;
                
                sheet.mergeCells(currentRowNum, 1, currentRowNum, 2);
                const labelCell = totRow.getCell(1);
                labelCell.value = "合計";
                labelCell.font = { name: 'MS Gothic', size: 9, bold: true };
                labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
                labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                labelCell.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }
                };
                totRow.getCell(2).border = { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };

                for (let d = 1; d <= daysInMonth; d++) {
                    const cell = totRow.getCell(2 + d);
                    cell.value = dailyTotals[d] > 0 ? dailyTotals[d] : '';
                    cell.font = { name: 'MS Gothic', size: 9, bold: true };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                    cell.border = {
                        top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' }
                    };
                }

                const cellGrandTot = totRow.getCell(totColIndex);
                cellGrandTot.value = grandTotal;
                cellGrandTot.font = { name: 'MS Gothic', size: 9, bold: true };
                cellGrandTot.alignment = { horizontal: 'right', vertical: 'middle' };
                cellGrandTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cellGrandTot.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'medium' }
                };

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `工事別作業集計_月間_${selectedMonth}.xlsx`;
                anchor.click();
                window.URL.revokeObjectURL(url);

            } catch (err) {
                console.error('Excel Export Error:', err);
                alert('Excel出力中にエラーが発生しました: ' + err.message);
            } finally {
                btnExportHistory.disabled = false;
                btnExportHistory.textContent = originalText;
            }
        });
    }

    // Excel Export (Total - Cumulative)
    const btnExportTotal = document.getElementById('btn-export-total');
    if (btnExportTotal) {
        btnExportTotal.addEventListener('click', async () => {
            if (typeof ExcelJS === 'undefined') return alert('ExcelJSライブラリの読み込みに失敗しました。');
            
            const originalText = btnExportTotal.textContent;
            btnExportTotal.disabled = true;
            btnExportTotal.textContent = '出力中...';

            try {
                const filterProjectSelect = document.getElementById('total-filter-project');
                const filterAuthorSelect = document.getElementById('total-filter-author');

                const selectedProject = filterProjectSelect ? filterProjectSelect.value : '';
                const selectedAuthor = filterAuthorSelect ? filterAuthorSelect.value : '';

                let filteredReports = allDailyReports;
                if (selectedProject) filteredReports = filteredReports.filter(r => r.projectId === selectedProject);
                if (selectedAuthor) filteredReports = filteredReports.filter(r => r.author === selectedAuthor || r.email === selectedAuthor);

                if (filteredReports.length === 0) {
                    return alert('出力条件に一致する日報データがありません。');
                }

                const totalData = new Map();
                filteredReports.forEach(r => {
                    if (!r.projectName) return;
                    const tasks = Array.isArray(r.tasks) ? r.tasks : (r.tasks ? [r.tasks] : []);
                    const hours = parseFloat(r.hours) || 0;

                    tasks.forEach(task => {
                        if (!task) return;
                        let taskName = task;
                        if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                            taskName = `その他（${r.notes.trim()}）`;
                        }

                        if (!totalData.has(r.projectName)) {
                            totalData.set(r.projectName, new Map());
                        }
                        const projectMap = totalData.get(r.projectName);
                        const currentHours = projectMap.get(taskName) || 0;
                        projectMap.set(taskName, currentHours + hours);
                    });
                });

                const TASK_ORDER = [
                    "一次加工", "組立て", "溶接", "塗装", "出荷",
                    "積算", "見積作成", "図面作図", "原寸", "打合せ",
                    "自主検査", "検査準備", "検査受検", "是正対応", "出荷準備", "その他"
                ];
                const getTaskOrderIndex = (task) => {
                    const idx = TASK_ORDER.indexOf(task);
                    return idx === -1 ? 999 : idx;
                };

                const sortedProjects = [...totalData.keys()].sort();
                const rows = [];
                const projectRowSpans = {};
                const projectTotals = {};
                let grandTotal = 0;

                sortedProjects.forEach(proj => {
                    const projectMap = totalData.get(proj);
                    const sortedTasks = [...projectMap.keys()].sort((a, b) => getTaskOrderIndex(a) - getTaskOrderIndex(b));

                    let projTotal = 0;
                    sortedTasks.forEach(task => {
                        const hours = projectMap.get(task);
                        if (hours > 0) {
                            rows.push({
                                projectName: proj,
                                taskName: task,
                                hours
                            });
                            projTotal += hours;
                            projectRowSpans[proj] = (projectRowSpans[proj] || 0) + 1;
                        }
                    });
                    projectTotals[proj] = projTotal;
                    grandTotal += projTotal;
                });

                if (rows.length === 0) return alert('稼働実績データがありません。');

                const workbook = new ExcelJS.Workbook();
                const sheet = workbook.addWorksheet('工事別作業集計_累計');

                sheet.pageSetup.paperSize = 8; // A3
                sheet.pageSetup.orientation = 'landscape';
                sheet.pageSetup.fitToPage = true;
                sheet.pageSetup.fitToWidth = 1;
                sheet.pageSetup.fitToHeight = 0;
                sheet.pageSetup.scale = undefined;

                const colWidths = [30, 25, 15, 15];
                sheet.columns = colWidths.map(w => ({ width: w }));

                const row1 = sheet.getRow(1);
                row1.height = 28;
                sheet.mergeCells(1, 1, 1, 4);
                const selectedProjName = selectedProject && selectedProject !== '' ? (allDailyReports.find(r => r.projectId === selectedProject)?.projectName || '') : '';
                const titleText = selectedProjName ? `${selectedProjName} 工事別作業集計表（累計）` : '工事別作業集計表（累計）';
                
                const titleCell = row1.getCell(1);
                titleCell.value = titleText;
                titleCell.font = { name: 'MS Gothic', size: 12, bold: true };
                titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
                titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                titleCell.border = {
                    top: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'medium' }, bottom: { style: 'thin' }
                };

                const row2 = sheet.getRow(2);
                row2.height = 20;

                const headers = ["工事名", "作業内容", "作業合計 (h)", "工事合計 (h)"];
                headers.forEach((h, idx) => {
                    const cell = row2.getCell(idx + 1);
                    cell.value = h;
                    cell.font = { name: 'MS Gothic', size: 9, bold: true };
                    cell.alignment = { 
                        horizontal: (idx >= 2) ? 'right' : 'left', 
                        vertical: 'middle',
                        wrapText: true
                    };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                    cell.border = {
                        top: { style: 'thin' },
                        bottom: { style: 'medium' },
                        left: idx === 0 ? { style: 'medium' } : { style: 'thin' },
                        right: idx === 3 ? { style: 'medium' } : { style: 'thin' }
                    };
                });

                let currentRowNum = 3;
                rows.forEach(r => {
                    const row = sheet.getRow(currentRowNum);
                    row.height = 24;

                    const cellProj = row.getCell(1);
                    cellProj.value = r.projectName;
                    cellProj.font = { name: 'MS Gothic', size: 9, bold: true };
                    cellProj.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
                    cellProj.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'medium' }, right: { style: 'thin' }
                    };

                    const cellTask = row.getCell(2);
                    cellTask.value = r.taskName;
                    cellTask.font = { name: 'MS Gothic', size: 9 };
                    cellTask.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
                    cellTask.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }
                    };

                    const cellTaskHours = row.getCell(3);
                    cellTaskHours.value = r.hours;
                    cellTaskHours.font = { name: 'MS Gothic', size: 9 };
                    cellTaskHours.alignment = { horizontal: 'right', vertical: 'middle' };
                    cellTaskHours.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }
                    };

                    const cellProjHours = row.getCell(4);
                    cellProjHours.value = projectTotals[r.projectName];
                    cellProjHours.font = { name: 'MS Gothic', size: 9, bold: true };
                    cellProjHours.alignment = { horizontal: 'right', vertical: 'middle' };
                    cellProjHours.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
                    cellProjHours.border = {
                        top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'medium' }
                    };

                    currentRowNum++;
                });

                let mergeStart = 3;
                sortedProjects.forEach(proj => {
                    const rowspan = projectRowSpans[proj];
                    if (rowspan > 1) {
                        sheet.mergeCells(mergeStart, 1, mergeStart + rowspan - 1, 1);
                        sheet.mergeCells(mergeStart, 4, mergeStart + rowspan - 1, 4);
                    }
                    mergeStart += rowspan;
                });

                const totRow = sheet.getRow(currentRowNum);
                totRow.height = 24;

                sheet.mergeCells(currentRowNum, 1, currentRowNum, 2);
                const labelCell = totRow.getCell(1);
                labelCell.value = "総合計";
                labelCell.font = { name: 'MS Gothic', size: 9, bold: true };
                labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
                labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                labelCell.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'medium' }, right: { style: 'thin' }
                };
                totRow.getCell(2).border = { top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' } };

                const cellEmpty = totRow.getCell(3);
                cellEmpty.value = "";
                cellEmpty.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cellEmpty.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'thin' }
                };

                const cellGrandTot = totRow.getCell(4);
                cellGrandTot.value = grandTotal;
                cellGrandTot.font = { name: 'MS Gothic', size: 9, bold: true };
                cellGrandTot.alignment = { horizontal: 'right', vertical: 'middle' };
                cellGrandTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                cellGrandTot.border = {
                    top: { style: 'thin' }, bottom: { style: 'medium' }, left: { style: 'thin' }, right: { style: 'medium' }
                };

                const buffer = await workbook.xlsx.writeBuffer();
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = window.URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                const fileLabel = selectedProjName ? `_${selectedProjName}` : '';
                anchor.download = `工事別作業集計_累計${fileLabel}.xlsx`;
                anchor.click();
                window.URL.revokeObjectURL(url);

            } catch (err) {
                console.error('Excel Export Error:', err);
                alert('Excel出力中にエラーが発生しました: ' + err.message);
            } finally {
                btnExportTotal.disabled = false;
                btnExportTotal.textContent = originalText;
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
                    const tasks = r.dailyLogs ? normalizeDailyTasks(r.dailyLogs[day]) : [];
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
                            
                            if (t.project && !['有給', '有休', '欠勤', '休日'].includes(t.project)) {
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

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    setVal('sched-project', sched.project || '');
    setVal('sched-project-number', sched.projectNumber || '');
    setVal('sched-tonnage', sched.tonnage || '');
    setVal('sched-client', sched.client || '');
    setVal('sched-address', sched.address || '');
    setVal('sched-architect', sched.architect || '');
    setVal('sched-start', sched.start || '');
    setVal('sched-end', sched.end || '');
    setVal('sched-drawing', sched.drawing || '');
    setVal('sched-lofting', sched.lofting || '');
    setVal('sched-inspection-company', sched.inspectionCompany || '');
    setVal('sched-general-contractor', sched.generalContractor || '');
    setVal('sched-erection-date', sched.erectionDate || '');
    setVal('sched-chief-tech', sched.chiefTech || '');
    setVal('sched-notes', sched.notes || '');
    setVal('sched-author', sched.author || '');
    setVal('sched-bar-color', sched.barColor || '#2563eb');

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
function openEditModal(sched) {
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

    const makeOptions = (roleKey, currentVal) => {
        const employees = currentCompany.employees || [];
        let optHtml = `<option value="">選択してください</option>`;
        employees.forEach(emp => {
            const selected = emp.name === currentVal ? 'selected' : '';
            optHtml += `<option value="${emp.name}" ${selected}>${emp.name}</option>`;
        });
        return optHtml;
    };

    modal.innerHTML = `
        <h3 style="margin-bottom: 20px; font-size: 1.3rem; border-bottom: 2px solid #2563eb; padding-bottom: 10px; color: #1e293b; font-weight: bold;">
            ✏️ 工程の編集・修正
        </h3>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">工事名 <span style="color:red">*</span></label>
                <input type="text" id="edit-project" value="${(sched.project || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">工事番号・記号 <span style="color:red">*</span></label>
                <input type="text" id="edit-project-number" value="${(sched.projectNumber || '').replace(/"/g, '&quot;')}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">加工トン数 (t) <span style="color:red">*</span></label>
                <input type="text" id="edit-tonnage" value="${sched.tonnage || '0'}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">現場住所</label>
                <input type="text" id="edit-address" value="${(sched.address || '').replace(/"/g, '&quot;')}" placeholder="例: 東京都新宿区..."
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">建て方開始日</label>
                <input type="date" id="edit-erection-date" value="${sched.erectionDate || ''}"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">施工図</label>
                <input type="text" id="edit-drawing" value="${(sched.drawing || '').replace(/"/g, '&quot;')}" placeholder="例: ○○設計"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">現寸</label>
                <input type="text" id="edit-lofting" value="${(sched.lofting || '').replace(/"/g, '&quot;')}" placeholder="例: ○○原寸"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">第三者検査会社</label>
                <input type="text" id="edit-inspection-company" value="${(sched.inspectionCompany || '').replace(/"/g, '&quot;')}" placeholder="例: ○○検査"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; margin-bottom: 15px;">
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">設計事務所</label>
                <input type="text" id="edit-architect" value="${(sched.architect || '').replace(/"/g, '&quot;')}" placeholder="例: ○○設計"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">元請業者</label>
                <input type="text" id="edit-general-contractor" value="${(sched.generalContractor || '').replace(/"/g, '&quot;')}" placeholder="例: ○○建設"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
            <div>
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">受注先</label>
                <input type="text" id="edit-client" value="${(sched.client || '').replace(/"/g, '&quot;')}" placeholder="例: ○○商事"
                    style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; box-sizing:border-box; color:#1e293b;">
            </div>
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

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
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
                <label style="display:block; font-weight:600; margin-bottom:5px; color:#1e293b;">主任技術者</label>
                <select id="edit-chief-tech" style="width:100%; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:1rem; color:#1e293b;">
                    ${makeOptions('tech', sched.chiefTech)}
                </select>
            </div>
        </div>

        <div style="margin-bottom: 20px; display: none;">
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

    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('edit-cancel-btn').addEventListener('click', () => overlay.remove());

    document.getElementById('edit-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('edit-save-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = '保存中...';

        const updatedData = {
            companyId: currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1],
            project: document.getElementById('edit-project').value.trim(),
            projectNumber: document.getElementById('edit-project-number').value.trim(),
            tonnage: parseFloat(document.getElementById('edit-tonnage').value) || 0,
            client: document.getElementById('edit-client').value.trim(),
            address: document.getElementById('edit-address').value.trim(),
            architect: document.getElementById('edit-architect').value.trim(),
            drawing: document.getElementById('edit-drawing').value.trim(),
            lofting: document.getElementById('edit-lofting').value.trim(),
            inspectionCompany: document.getElementById('edit-inspection-company').value.trim(),
            generalContractor: document.getElementById('edit-general-contractor').value.trim(),
            erectionDate: document.getElementById('edit-erection-date').value.trim(),
            start: document.getElementById('edit-start').value,
            end: document.getElementById('edit-end').value,
            chiefTech: document.getElementById('edit-chief-tech').value,
            assignType: "none",
            barColor: document.getElementById('edit-bar-color').value,
            notes: document.getElementById('edit-notes').value.trim(),
        };

        if (!updatedData.project || !updatedData.start || !updatedData.end || !updatedData.projectNumber) {
            alert('工事名・工事番号・開始日・終了日は必須です。');
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
                    btn.innerHTML = eyeSlashSvg;
                } else {
                    input.type = 'password';
                    btn.innerHTML = eyeSvg;
                }
            }
        });
    });

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
            signOut(auth).catch(err => console.error(err));
        });
    }

    // PWAアプリ内インストールボタン制御
    let deferredPrompt = null;
    const btnInstallApp = document.getElementById('btn-install-app');

    window.addEventListener('beforeinstallprompt', (e) => {
        // ブラウザのデフォルトバナーを抑止
        e.preventDefault();
        // イベントオブジェクトを保持
        deferredPrompt = e;
        // インストールボタンを表示
        if (btnInstallApp) {
            btnInstallApp.style.display = 'inline-flex';
        }
    });

    if (btnInstallApp) {
        btnInstallApp.addEventListener('click', async () => {
            if (!deferredPrompt) return;
            // プロンプトをポップアップ表示
            deferredPrompt.prompt();
            // ユーザーの決定を待つ
            const { outcome } = await deferredPrompt.userChoice;
            console.log(`User response to PWA install: ${outcome}`);
            deferredPrompt = null;
            btnInstallApp.style.display = 'none';
        });
    }

    // すでにスタンドアロン起動している場合はボタンを非表示
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        if (btnInstallApp) btnInstallApp.style.display = 'none';
    }



    // ==================================================

    // 鉄骨加工工場日報システム向け日報読込・描画・集計ロジック

    // ==================================================

    

    // グローバル状態変数

    window.loadReports = async (isSummary = false) => {

        await window.loadDailyReports();

    };



    // ログインユーザー宛て/全員の「日次日報」をロードする関数

    window.loadDailyReports = async () => {

        try {

            if (!currentUser) return;

            const cid = currentCompany ? currentCompany.companyId : currentUser.email.split('@')[1];

            let q = query(collection(db, "daily_reports"), where("companyId", "==", cid));

            

            const querySnapshot = await getDocs(q);

            allDailyReports = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

            

            renderDailyReportHistory();

            renderDailyReportSummary();
            if (typeof renderDailyReportTotal === 'function') {
                renderDailyReportTotal();
            }
            if (typeof renderBufferedReports === 'function') {
                renderBufferedReports();
            }

        } catch (e) {

            console.error("Error loading daily reports: ", e);

        }

    };



    // 日報履歴・集計のフィルターイベントハンドラ

    const historyMonthSelect = document.getElementById('history-filter-month');

    const historyProjectSelect = document.getElementById('history-filter-project');

    const historyAuthorSelect = document.getElementById('history-filter-author');



    if (historyMonthSelect) historyMonthSelect.addEventListener('change', renderDailyReportHistory);

    if (historyProjectSelect) historyProjectSelect.addEventListener('change', renderDailyReportHistory);

    if (historyAuthorSelect) historyAuthorSelect.addEventListener('change', renderDailyReportHistory);



    const summaryMonthSelect = document.getElementById('summary-filter-month');

    const summaryProjectSelect = document.getElementById('summary-filter-project');



    if (summaryMonthSelect) summaryMonthSelect.addEventListener('change', renderDailyReportSummary);

    if (summaryProjectSelect) summaryProjectSelect.addEventListener('change', renderDailyReportSummary);

    // 累計集計用のフィルターイベント登録
    const totalProjectSelect = document.getElementById('total-filter-project');
    const totalAuthorSelect = document.getElementById('total-filter-author');

    if (totalProjectSelect) totalProjectSelect.addEventListener('change', renderDailyReportTotal);
    if (totalAuthorSelect) totalAuthorSelect.addEventListener('change', renderDailyReportTotal);

    // 累計集計の印刷ボタン登録
    const btnPrintTotal = document.getElementById('btn-print-total');
    if (btnPrintTotal) {
        btnPrintTotal.addEventListener('click', () => {
            const filterProjectSelect = document.getElementById('total-filter-project');
            const selectedProjName = filterProjectSelect ? filterProjectSelect.options[filterProjectSelect.selectedIndex]?.text : '';
            const titleText = selectedProjName && selectedProjName !== 'すべての工事' ? `${selectedProjName} 工事別作業集計表（累計）` : '工事別作業集計表（累計）';
            if (typeof window.doPrint === 'function') {
                window.doPrint('total-print-container', titleText, false); // A4縦
            } else {
                console.error("window.doPrint is not defined");
            }
        });
    }



    // 印刷ボタン

    const btnPrintHistory = document.getElementById('btn-print-history');

    if (btnPrintHistory) {

        btnPrintHistory.addEventListener('click', () => {

            const filterMonthSelect = document.getElementById('history-filter-month');

            const filterMonth = filterMonthSelect ? filterMonthSelect.value : '';

            const [year, month] = filterMonth ? filterMonth.split('-') : ['', ''];

            const titleText = year ? `${year}年${month}月 工事別作業集計表（月間）` : '工事別作業集計表（月間）';

            if (typeof window.doPrint === 'function') {
                window.doPrint('history-print-container', titleText, true);
            } else {
                console.error("window.doPrint is not defined");
            }

        });

    }



    // 重複しているためコメントアウト。4159行目の doPrint を用いた印刷処理が優先されます。
    // const btnPrintSummary = document.getElementById('btn-print-summary');
    // if (btnPrintSummary) {
    //     btnPrintSummary.addEventListener('click', () => {
    //         window.print();
    //     });
    // }



    // 日報フォームリセット関数

    function resetDailyReportForm() {

        const reportIdInput = document.getElementById('report-edit-id');

        const cancelEditBtn = document.getElementById('btn-report-cancel-edit');

        const submitBtn = document.getElementById('btn-report-submit');

        

        if (reportIdInput) reportIdInput.value = '';

        if (cancelEditBtn) cancelEditBtn.style.display = 'none';

        if (submitBtn) {
            submitBtn.textContent = '作業を登録';
            submitBtn.style.backgroundColor = '';
        }

        

        // フォームリセット

        document.getElementById('report-project-id').value = '';

        document.querySelectorAll('input[name="report-tasks"]').forEach(cb => cb.checked = false);
        const notesGroup = document.getElementById('report-notes-group');
        if (notesGroup) notesGroup.style.display = 'none';
        const reportHoursInput = document.getElementById('report-hours');

        if (reportHoursInput) reportHoursInput.value = '8.0';

        document.getElementById('report-notes').value = '';

        // 社員名の選択もクリアする
        const memberSelectEl = document.getElementById('report-member-select');
        if (memberSelectEl) {
            memberSelectEl.value = '';
        }

        const reportDateInput = document.getElementById('report-date');

        if (reportDateInput) {

            const formatDate = (date) => {

                const y = date.getFullYear();

                const m = String(date.getMonth() + 1).padStart(2, '0');

                const d = String(date.getDate()).padStart(2, '0');

                return `${y}-${m}-${d}`;

            };

            // reportDateInput.value = formatDate(new Date()); // 日付はクリアせず維持する
            if (!reportDateInput.value) {
                reportDateInput.value = formatDate(new Date());
            }

        }

    }



    // 日報履歴の描画

    
    // 選択された日付の登録済み作業一覧を描画する関数 (2026年5月31日追加)
    // 選択された日付の登録済み作業一覧を描画する関数 (2026年5月31日追加)
    function renderBufferedReports() {
        const bufferedList = document.getElementById('buffered-reports-list');
        const bufferedDateLabel = document.getElementById('buffered-date-label');
        const bufferedTotalHours = document.getElementById('buffered-total-hours');
        const reportDateInput = document.getElementById('report-date');
        
        if (!bufferedList || !reportDateInput || !currentUser) return;
        
        const selectedDate = reportDateInput.value;
        if (bufferedDateLabel) {
            bufferedDateLabel.textContent = `${selectedDate ? selectedDate.replace(/-/g, '/') : ''} の登録済み作業`;
        }
        
        if (!selectedDate) {
            bufferedList.innerHTML = `<p style="text-align:center; color:var(--text-muted); font-style:italic; padding:10px; margin:0;">作業日を選択してください。</p>`;
            if (bufferedTotalHours) {
                bufferedTotalHours.textContent = '0.0';
            }
            return;
        }

        // allDailyReports から、同じ日付のすべての日報を抽出
        const filtered = allDailyReports.filter(r => r.date === selectedDate);
        
        let html = '';
        let total = 0;
        
        if (filtered.length === 0) {
            html = `<p style="text-align:center; color:var(--text-muted); font-style:italic; padding:10px; margin:0;">この日に登録された作業はありません。</p>`;
        } else {
            // 工事名（projectName）でグループ化
            const groups = {};
            filtered.forEach(r => {
                const projName = r.projectName || '不明な工事';
                if (!groups[projName]) {
                    groups[projName] = {
                        projectName: projName,
                        reports: []
                    };
                }
                groups[projName].reports.push(r);
            });

            // 各グループ内の作業を入力順（createdAt 昇順）でソート
            Object.values(groups).forEach(g => {
                g.reports.sort((a, b) => {
                    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return timeA - timeB;
                });
            });

            // グループ自体の並び順（最初にその工事の作業が登録された時間順）でソート
            const sortedGroups = Object.values(groups).sort((a, b) => {
                const timeA = a.reports[0] && a.reports[0].createdAt ? new Date(a.reports[0].createdAt).getTime() : 0;
                const timeB = b.reports[0] && b.reports[0].createdAt ? new Date(b.reports[0].createdAt).getTime() : 0;
                return timeA - timeB;
            });

            // HTML生成 (テーブル形式)
            sortedGroups.forEach(g => {
                let groupTotal = 0;
                
                // 工事グループの外枠（一行隙間を開けるため margin-bottom: 20px）
                html += `
                    <div class="buffered-project-group" style="background:var(--bg-card, #ffffff); border: 1px solid var(--border); border-radius:10px; padding:15px; margin-bottom:20px; box-shadow:0 1px 3px rgba(0,0,0,0.05); overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.9rem; min-width:650px; border: 1px solid var(--border, #cbd5e1);">
                            <thead>
                                <tr style="background: var(--bg-muted, #f8fafc); color: var(--text-muted, #64748b); font-weight: bold; height:38px;">
                                    <th style="padding:10px 8px; width:150px; white-space:nowrap; text-align:left; border: 1px solid var(--border, #cbd5e1);">社員名</th>
                                    <th style="padding:10px 8px; min-width:180px; text-align:left; border: 1px solid var(--border, #cbd5e1);">工事名</th>
                                    <th style="padding:10px 8px; width:130px; text-align:left; border: 1px solid var(--border, #cbd5e1);">作業内容</th>
                                    <th style="padding:10px 8px; width:90px; text-align:right; border: 1px solid var(--border, #cbd5e1);">時間</th>
                                    <th style="padding:10px 8px; width:185px; text-align:center; border: 1px solid var(--border, #cbd5e1);">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                g.reports.forEach((r) => {
                    groupTotal += r.hours;
                    
                    html += `
                        <tr style="height:45px;">
                            <!-- 社員名 (改行防止 white-space: nowrap) -->
                            <td style="padding:8px; font-weight:bold; color:var(--text-main); white-space:nowrap; vertical-align:middle; text-align:left; border: 1px solid var(--border, #cbd5e1);">
                                👤 ${r.author}
                            </td>
                            <!-- 工事名 -->
                            <td style="padding:8px; font-weight:bold; color:var(--text-muted, #475569); vertical-align:middle; text-align:left; border: 1px solid var(--border, #cbd5e1);">
                                ${r.projectName}
                            </td>
                            <!-- 作業内容 -->
                            <td style="padding:8px; vertical-align:middle; text-align:left; border: 1px solid var(--border, #cbd5e1);">
                                <span style="background:#2563eb !important; color:#ffffff !important; padding:3px 8px; border-radius:4px; font-size:0.85rem; font-weight:bold; display:inline-block; white-space:nowrap;">${(r.tasks || []).map(t => (t === 'その他' && r.notes && r.notes.trim() !== '') ? `その他（${r.notes.trim()}）` : t).join('・')}</span>
                            </td>
                            <!-- 時間 -->
                            <td style="padding:8px; text-align:right; font-weight:bold; color:var(--primary-color, #2563eb); font-size:1.05rem; vertical-align:middle; white-space:nowrap; border: 1px solid var(--border, #cbd5e1);">
                                ${r.hours}時間
                            </td>
                            <!-- 操作ボタン -->
                            <td style="padding:8px; text-align:center; vertical-align:middle; border: 1px solid var(--border, #cbd5e1); width:185px; min-width:185px;">
                                <div style="display:flex; gap:8px; align-items:center; justify-content:center; flex-wrap:nowrap;">
                                    <button type="button" class="btn btn-small btn-edit-buffered-report" data-id="${r.id}" style="padding:6px 12px; font-size:0.85rem; background:#475569; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; white-space:nowrap; display:inline-flex; align-items:center; gap:3px;">✏️ 編集</button>
                                    <button type="button" class="btn btn-small btn-delete-buffered-report" data-id="${r.id}" style="padding:6px 12px; font-size:0.85rem; background:#dc2626; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:bold; white-space:nowrap; display:inline-flex; align-items:center; gap:3px;">🗑️ 削除</button>
                                </div>
                            </td>
                        </tr>
                        
                        <!-- その他作業内容 (ある場合のみ、横幅いっぱいの tr を挿入) -->
                        ${r.notes && !(r.tasks || []).includes('その他') ? `
                        <tr>
                            <td colspan="5" style="padding:8px; border: 1px solid var(--border, #cbd5e1); background:rgba(2,132,199,0.01);">
                                <div style="font-size:0.85rem; color:var(--text-main); padding:6px 10px; border-left:3px solid var(--primary-color, #0284c7); font-weight:normal; white-space:pre-wrap; word-break:break-all; text-align:left;">
                                    📄 その他の作業: ${r.notes}
                                </div>
                            </td>
                        </tr>
                        ` : ''}
                    `;
                });

                // 工事グループごとの右下合計工数
                html += `
                            </tbody>
                        </table>
                        <div style="margin-top:12px; text-align:right; font-weight:bold; font-size:0.95rem; color:var(--text-muted, #64748b); padding-top:8px; border-top:1px dashed var(--border, #e2e8f0);">
                            ${g.projectName} 合計工数: <span style="color:var(--primary-color, #2563eb); font-size:1.1rem;">${groupTotal.toFixed(1)}</span> 時間
                        </div>
                    </div>
                `;

                total += groupTotal;
            });
        }
        
        bufferedList.innerHTML = html;
        if (bufferedTotalHours) {
            bufferedTotalHours.textContent = total.toFixed(1);
        }
        
        // 削除ボタンイベントバインド
        bufferedList.querySelectorAll('.btn-delete-buffered-report').forEach(btn => {
            btn.addEventListener('click', async () => {
                const reportId = btn.dataset.id;
                const rep = allDailyReports.find(r => r.id === reportId);
                if (rep) {
                    if (confirm(`「${rep.projectName}」の作業（${rep.hours}時間）を削除しますか？`)) {
                        try {
                            await deleteDoc(doc(db, "daily_reports", reportId));
                            showToast('作業を削除しました。', 'success');
                            await window.loadDailyReports();
                        } catch (err) {
                            console.error(err);
                            showToast('削除に失敗しました: ' + err.message, 'error');
                        }
                    }
                }
            });
        });

        // 編集ボタンイベントバインド
        bufferedList.querySelectorAll('.btn-edit-buffered-report').forEach(btn => {
            btn.addEventListener('click', () => {
                const reportId = btn.dataset.id;
                const rep = allDailyReports.find(r => r.id === reportId);
                if (rep) {
                    const editIdInput = document.getElementById('report-edit-id');
                    if (editIdInput) editIdInput.value = rep.id;
                    
                    const dateInput = document.getElementById('report-date');
                    if (dateInput) dateInput.value = rep.date;
                    
                    const projSelect = document.getElementById('report-project-id');
                    if (projSelect) projSelect.value = rep.projectId;
                    
                    document.querySelectorAll('input[name="report-tasks"]').forEach(cb => {
                        cb.checked = (rep.tasks || []).includes(cb.value);
                    });
                    const notesGroup = document.getElementById('report-notes-group');
                    if (notesGroup) {
                        notesGroup.style.display = (rep.tasks || []).includes('その他') ? 'block' : 'none';
                    }
                    
                    const hoursInput = document.getElementById('report-hours');
                    if (hoursInput) hoursInput.value = rep.hours;
                    
                    const notesInput = document.getElementById('report-notes');
                    if (notesInput) notesInput.value = rep.notes || '';
                    
                    const cancelEditBtn = document.getElementById('btn-report-cancel-edit');
                    if (cancelEditBtn) cancelEditBtn.style.display = 'block';
                    
                    const submitBtn = document.getElementById('btn-report-submit');
                    if (submitBtn) {
                        submitBtn.textContent = '作業を更新';
                        submitBtn.style.backgroundColor = '#ea580c';
                    }

                    const memberSelectEl = document.getElementById('report-member-select');
                    if (memberSelectEl) {
                        memberSelectEl.value = rep.author || '';
                    }

                    // 入力フォームの一番上にスクロール（スマホ向け）
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            });
        });
    }


    function renderDailyReportHistory() {
        const listContainer = document.getElementById('history-list-container');
        const printContainer = document.getElementById('history-print-container');
        if (!listContainer) return;

        const filterMonthSelect = document.getElementById('history-filter-month');
        const filterProjectSelect = document.getElementById('history-filter-project');
        const filterAuthorSelect = document.getElementById('history-filter-author');

        let selectedMonth = filterMonthSelect ? filterMonthSelect.value : '';
        const selectedProject = filterProjectSelect ? filterProjectSelect.value : '';
        const selectedAuthor = filterAuthorSelect ? filterAuthorSelect.value : '';

        // フィルタードロップダウンの更新 (初回)
        if (filterMonthSelect && filterMonthSelect.children.length <= 1) {
            const months = [...new Set(allDailyReports.map(r => r.date ? r.date.substring(0, 7) : ''))].filter(Boolean).sort().reverse();
            filterMonthSelect.innerHTML = '<option value="">すべての月</option>';
            months.forEach(m => {
                filterMonthSelect.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`;
            });
            if (selectedMonth) {
                filterMonthSelect.value = selectedMonth;
            }
        }

        if (filterAuthorSelect && filterAuthorSelect.children.length <= 1 && currentCompany && currentCompany.role === 'admin') {
            const authors = [...new Set(allDailyReports.map(r => r.author))].filter(Boolean).sort();
            filterAuthorSelect.innerHTML = '<option value="">すべての社員</option>';
            authors.forEach(a => {
                filterAuthorSelect.innerHTML += `<option value="${a}">${a}</option>`;
            });
            if (selectedAuthor) {
                filterAuthorSelect.value = selectedAuthor;
            }
        }

        // 月が未選択の場合、最新の月を自動選択するフォールバック
        if (!selectedMonth) {
            const months = [...new Set(allDailyReports.map(r => r.date ? r.date.substring(0, 7) : ''))].filter(Boolean).sort().reverse();
            if (months.length > 0) {
                selectedMonth = months[0];
                if (filterMonthSelect) {
                    filterMonthSelect.value = selectedMonth;
                }
            } else {
                listContainer.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:30px;font-weight:bold;">日報データがありません。</p>`;
                if (printContainer) printContainer.innerHTML = `<p style="text-align:center;padding:20px;">日報データがありません。</p>`;
                return;
            }
        }

        const [year, month] = selectedMonth.split('-').map(Number);
        const daysInMonth = new Date(year, month, 0).getDate();

        let filteredReports = allDailyReports.filter(r => r.date && r.date.startsWith(selectedMonth));

        if (selectedProject) {
            filteredReports = filteredReports.filter(r => r.projectId === selectedProject);
        }

        if (selectedAuthor) {
            filteredReports = filteredReports.filter(r => r.author === selectedAuthor || r.email === selectedAuthor);
        }

        if (filteredReports.length === 0) {
            listContainer.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:30px;font-weight:bold;">選択された条件に一致する日報データがありません。</p>`;
            if (printContainer) printContainer.innerHTML = `<p style="text-align:center;padding:20px;">日報データがありません。</p>`;
            return;
        }

        // 集計用マップ
        const gridData = new Map();
        const detailData = new Map(); // key -> Array of reports

        filteredReports.forEach(r => {
            if (!r.projectName || !r.date) return;
            const dayNum = parseInt(r.date.substring(8, 10), 10);
            if (isNaN(dayNum) || dayNum < 1 || dayNum > daysInMonth) return;

            const tasks = Array.isArray(r.tasks) ? r.tasks : (r.tasks ? [r.tasks] : []);
            const hours = parseFloat(r.hours) || 0;

            tasks.forEach(task => {
                if (!task) return;
                let taskName = task;
                if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                    taskName = `その他（${r.notes.trim()}）`;
                }

                if (!gridData.has(r.projectName)) {
                    gridData.set(r.projectName, new Map());
                }
                const projectMap = gridData.get(r.projectName);
                if (!projectMap.has(taskName)) {
                    projectMap.set(taskName, new Array(daysInMonth + 1).fill(0));
                }
                projectMap.get(taskName)[dayNum] += hours;

                const key = `${r.projectName}::${taskName}::${dayNum}`;
                if (!detailData.has(key)) {
                    detailData.set(key, []);
                }
                detailData.get(key).push(r);
            });
        });

        const TASK_ORDER = [
            "一次加工", "組立て", "溶接", "塗装", "出荷",
            "積算", "見積作成", "図面作図", "原寸", "打合せ",
            "自主検査", "検査準備", "検査受検", "是正対応", "出荷準備", "その他"
        ];
        const getTaskOrderIndex = (task) => {
            const idx = TASK_ORDER.indexOf(task);
            return idx === -1 ? 999 : idx;
        };

        const sortedProjects = [...gridData.keys()].sort();
        const rows = [];

        sortedProjects.forEach(proj => {
            const projectMap = gridData.get(proj);
            const sortedTasks = [...projectMap.keys()].sort((a, b) => getTaskOrderIndex(a) - getTaskOrderIndex(b));

            sortedTasks.forEach(task => {
                const dailyHours = projectMap.get(task);
                const totalHours = dailyHours.reduce((sum, h) => sum + h, 0);
                if (totalHours > 0) {
                    rows.push({
                        projectName: proj,
                        taskName: task,
                        dailyHours,
                        totalHours
                    });
                }
            });
        });

        if (rows.length === 0) {
            listContainer.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:30px;font-weight:bold;">稼働実績データがありません。</p>`;
            if (printContainer) printContainer.innerHTML = `<p style="text-align:center;padding:20px;">稼働実績データがありません。</p>`;
            return;
        }

        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        const colStyles = [];
        const headerDaysHtml = [];
        const headerWdaysHtml = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month - 1, d);
            const wday = dateObj.getDay();
            const isSat = wday === 6;
            const isSun = wday === 0;

            let style = 'padding: 4px 2px; text-align: center; font-size: 0.7rem; border: 1px solid var(--border, #cbd5e1);';
            if (isSat) {
                style += ' background-color: #e0f2fe; color: #0284c7; font-weight: bold;';
            } else if (isSun) {
                style += ' background-color: #fee2e2; color: #ef4444; font-weight: bold;';
            }
            colStyles.push(style);

            headerDaysHtml.push(`<th style="${style}">${d}</th>`);
            headerWdaysHtml.push(`<th style="${style}">${dayNames[wday]}</th>`);
        }

        const projectRowSpans = {};
        rows.forEach(r => {
            projectRowSpans[r.projectName] = (projectRowSpans[r.projectName] || 0) + 1;
        });

        const dailyTotals = new Array(daysInMonth + 1).fill(0);
        let grandTotal = 0;
        rows.forEach(r => {
            for (let d = 1; d <= daysInMonth; d++) {
                dailyTotals[d] += r.dailyHours[d];
            }
            grandTotal += r.totalHours;
        });

        const makeTableHtml = (isPrint = false) => {
            const renderedProjects = new Set();
            let tableHtml = `
                <div style="text-align: right; font-size: 0.72rem; color: var(--text-muted, #64748b); margin-bottom: 6px; font-weight: bold;">
                    ※各セルの数値は、その日の作業時間（時間単位: h）を表します。
                </div>
                <div class="table-responsive" style="overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch;">
                    <table class="grid-table" style="table-layout: fixed; width: 100%; border-collapse: collapse; font-size: 0.75rem; border: 1px solid var(--border, #cbd5e1); min-width: ${isPrint ? '100%' : '900px'};">
                        <colgroup>
                            <col style="width: 12%;">
                            <col style="width: 10%;">
                            ${new Array(daysInMonth).fill(0).map((_, i) => `<col style="width: ${(73 / daysInMonth).toFixed(2)}%;">`).join('')}
                            <col style="width: 5%;">
                        </colgroup>
                        <thead>
                            <tr style="background: var(--bg-muted, #f1f5f9);">
                                <th rowspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 4px; text-align: left; font-size: 0.8rem; font-weight: bold; vertical-align: middle; width: 12%;">工事名</th>
                                <th rowspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 4px; text-align: left; font-size: 0.8rem; font-weight: bold; vertical-align: middle; width: 10%;">作業内容</th>
                                ${headerDaysHtml.join('')}
                                <th rowspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 4px; text-align: right; font-size: 0.8rem; font-weight: bold; vertical-align: middle; background: #e2e8f0; color: #1e293b; width: 5%;">合計</th>
                            </tr>
                            <tr style="background: var(--bg-muted, #f1f5f9);">
                                ${headerWdaysHtml.join('')}
                            </tr>
                        </thead>
                        <tbody>
            `;

            rows.forEach(r => {
                tableHtml += `<tr style="border-bottom: 1px solid var(--border, #cbd5e1);">`;

                if (!renderedProjects.has(r.projectName)) {
                    const rowspan = projectRowSpans[r.projectName];
                    tableHtml += `
                        <td rowspan="${rowspan}" style="border: 1px solid var(--border, #cbd5e1); padding: 6px 4px; font-weight: bold; vertical-align: middle; background: var(--card-bg, #ffffff); font-size: 0.8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.projectName}">
                            ${r.projectName}
                        </td>
                    `;
                    renderedProjects.add(r.projectName);
                }

                tableHtml += `
                    <td style="border: 1px solid var(--border, #cbd5e1); padding: 6px 4px; vertical-align: middle; background: var(--card-bg, #ffffff); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.taskName}">
                        ${r.taskName}
                    </td>
                `;

                for (let d = 1; d <= daysInMonth; d++) {
                    const hours = r.dailyHours[d];
                    const cellStyle = colStyles[d - 1];
                    const hoursText = hours > 0 ? hours.toFixed(1).replace('.0', '') : '';
                    const hasData = hours > 0;

                    const clickAttr = (hasData && !isPrint) ? `class="clickable-hours-cell" data-project="${r.projectName.replace(/"/g, '&quot;')}" data-task="${r.taskName.replace(/"/g, '&quot;')}" data-day="${d}" style="cursor: pointer; font-weight: bold; text-align: center; ${cellStyle}"` : `style="text-align: center; ${cellStyle}"`;

                    tableHtml += `
                        <td ${clickAttr}>
                            ${hoursText}
                        </td>
                    `;
                }

                tableHtml += `
                    <td style="border: 1px solid var(--border, #cbd5e1); padding: 6px 4px; text-align: right; font-weight: bold; background: #f8fafc; font-size: 0.8rem; color: var(--text-main, #1e293b);">
                        ${r.totalHours.toFixed(1).replace('.0', '')}
                    </td>
                `;

                tableHtml += `</tr>`;
            });

            tableHtml += `
                <tr style="background: #e2e8f0; font-weight: bold; border-top: 2px solid var(--border, #cbd5e1);">
                    <td colspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 6px 4px; text-align: center; font-size: 0.8rem; color: #1e293b;">日別合計</td>
            `;

            for (let d = 1; d <= daysInMonth; d++) {
                const hours = dailyTotals[d];
                const hoursText = hours > 0 ? hours.toFixed(1).replace('.0', '') : '';
                const cellStyle = colStyles[d - 1];
                tableHtml += `
                    <td style="text-align: center; padding: 4px 2px; font-size: 0.75rem; color: #1e293b; ${cellStyle}">
                        ${hoursText}
                    </td>
                `;
            }

            tableHtml += `
                    <td style="border: 1px solid var(--border, #cbd5e1); padding: 6px 4px; text-align: right; font-size: 0.8rem; background: #cbd5e1; color: #0f172a;">
                        ${grandTotal.toFixed(1).replace('.0', '')}
                    </td>
                </tr>
            `;

            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;
            return tableHtml;
        };

        listContainer.innerHTML = makeTableHtml(false);

        if (printContainer) {
            printContainer.innerHTML = makeTableHtml(true);
        }

        // クリックイベントの登録
        listContainer.querySelectorAll('.clickable-hours-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const project = cell.dataset.project;
                const task = cell.dataset.task;
                const day = parseInt(cell.dataset.day, 10);
                const key = `${project}::${task}::${day}`;
                const reports = detailData.get(key) || [];

                if (reports.length === 0) return;

                const modal = document.getElementById('history-detail-modal-overlay');
                const title = document.getElementById('history-detail-title');
                const content = document.getElementById('history-detail-content');

                if (!modal || !title || !content) return;

                title.innerHTML = `📅 ${year}年${month}月${day}日 &nbsp;&nbsp;|&nbsp;&nbsp; 🏗️ ${project}`;

                let detailHtml = `
                    <div style="width: 100%; max-width: 100%; box-sizing: border-box; border: 1px solid var(--border, #cbd5e1); border-radius: 8px; overflow: hidden; background: var(--bg-card, #ffffff); box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03);">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.85rem; text-align: left; table-layout: fixed; margin: 0;">
                            <thead>
                                <tr style="background: var(--bg-muted, #f1f5f9); border-bottom: 2px solid var(--border, #cbd5e1);">
                                    <th style="padding: 10px 12px; font-weight: bold; width: 30%; color: var(--text-main, #1e293b);">氏名</th>
                                    <th style="padding: 10px 12px; font-weight: bold; width: 45%; color: var(--text-main, #1e293b);">作業内容</th>
                                    <th style="padding: 10px 12px; font-weight: bold; width: 25%; text-align: right; color: var(--text-main, #1e293b);">工数</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                reports.forEach((r, idx) => {
                    const rowBg = idx % 2 === 1 ? 'background: var(--bg-muted, #f8fafc);' : '';
                    let taskText = task;
                    if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                        taskText = `その他 (${r.notes.trim()})`;
                    }
                    detailHtml += `
                        <tr style="border-bottom: 1px solid var(--border, #cbd5e1); ${rowBg}">
                            <td style="padding: 12px; font-weight: bold; color: var(--text-main, #1e293b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${r.author}
                            </td>
                            <td style="padding: 12px; vertical-align: middle;">
                                <span class="task-badge" style="display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${taskText.replace(/"/g, '&quot;')}">
                                    ${taskText}
                                </span>
                            </td>
                            <td style="padding: 12px; text-align: right; font-weight: bold; color: var(--primary-color, #0284c7); font-size: 0.9rem;">
                                ${r.hours} 時間
                            </td>
                        </tr>
                    `;
                });

                detailHtml += `
                            </tbody>
                        </table>
                    </div>
                `;

                content.innerHTML = detailHtml;
                modal.style.display = 'flex';
            });
        });

        // モーダルの「閉じる」ボタンイベント
        const closeBtn = document.getElementById('history-detail-close-btn');
        if (closeBtn) {
            closeBtn.onclick = () => {
                const modal = document.getElementById('history-detail-modal-overlay');
                if (modal) modal.style.display = 'none';
            };
        }
    }

    function renderDailyReportTotal() {
        const listContainer = document.getElementById('total-list-container');
        const printContainer = document.getElementById('total-print-container');
        if (!listContainer) return;

        const filterProjectSelect = document.getElementById('total-filter-project');
        const filterAuthorSelect = document.getElementById('total-filter-author');

        const selectedProject = filterProjectSelect ? filterProjectSelect.value : '';
        const selectedAuthor = filterAuthorSelect ? filterAuthorSelect.value : '';

        // プロジェクトフィルタードロップダウンの更新
        if (filterProjectSelect) {
            const projects = [...new Set(allDailyReports.map(r => r.projectName))].filter(Boolean).sort();
            filterProjectSelect.innerHTML = '<option value="">すべての工事</option>';
            projects.forEach(p => {
                const rep = allDailyReports.find(r => r.projectName === p);
                const pid = rep ? rep.projectId : p;
                filterProjectSelect.innerHTML += `<option value="${pid}">${p}</option>`;
            });
            if (selectedProject) {
                filterProjectSelect.value = selectedProject;
            }
        }

        // 社員フィルタードロップダウンの更新 (管理者用)
        if (filterAuthorSelect && currentCompany && currentCompany.role === 'admin') {
            const authors = [...new Set(allDailyReports.map(r => r.author))].filter(Boolean).sort();
            filterAuthorSelect.innerHTML = '<option value="">すべての社員</option>';
            authors.forEach(a => {
                filterAuthorSelect.innerHTML += `<option value="${a}">${a}</option>`;
            });
            if (selectedAuthor) {
                filterAuthorSelect.value = selectedAuthor;
            }
        }

        // データフィルタリング
        let filteredReports = allDailyReports;

        if (selectedProject) {
            filteredReports = filteredReports.filter(r => r.projectId === selectedProject);
        }

        if (selectedAuthor) {
            filteredReports = filteredReports.filter(r => r.author === selectedAuthor || r.email === selectedAuthor);
        }

        if (filteredReports.length === 0) {
            const emptyHtml = `<p style="text-align:center;color:var(--text-muted);padding:30px;font-weight:bold;">選択された条件に一致する日報データがありません。</p>`;
            listContainer.innerHTML = emptyHtml;
            if (printContainer) printContainer.innerHTML = emptyHtml;
            return;
        }

        // 工事別・作業別集計用マップ
        const totalData = new Map(); // projectName -> Map(taskName -> hours)
        
        filteredReports.forEach(r => {
            if (!r.projectName) return;
            const tasks = Array.isArray(r.tasks) ? r.tasks : (r.tasks ? [r.tasks] : []);
            const hours = parseFloat(r.hours) || 0;

            tasks.forEach(task => {
                if (!task) return;
                let taskName = task;
                if (task === 'その他' && r.notes && r.notes.trim() !== '') {
                    taskName = `その他（${r.notes.trim()}）`;
                }

                if (!totalData.has(r.projectName)) {
                    totalData.set(r.projectName, new Map());
                }
                const projectMap = totalData.get(r.projectName);
                const currentHours = projectMap.get(taskName) || 0;
                projectMap.set(taskName, currentHours + hours);
            });
        });

        // ソート用順序
        const TASK_ORDER = [
            "一次加工", "組立て", "溶接", "塗装", "出荷",
            "積算", "見積作成", "図面作図", "原寸", "打合せ",
            "自主検査", "検査準備", "検査受検", "是正対応", "出荷準備", "その他"
        ];
        const getTaskOrderIndex = (task) => {
            const idx = TASK_ORDER.indexOf(task);
            return idx === -1 ? 999 : idx;
        };

        const sortedProjects = [...totalData.keys()].sort();
        const rows = [];
        const projectRowSpans = {};
        const projectTotals = {};
        let grandTotal = 0;

        sortedProjects.forEach(proj => {
            const projectMap = totalData.get(proj);
            const sortedTasks = [...projectMap.keys()].sort((a, b) => getTaskOrderIndex(a) - getTaskOrderIndex(b));

            let projTotal = 0;
            sortedTasks.forEach(task => {
                const hours = projectMap.get(task);
                if (hours > 0) {
                    rows.push({
                        projectName: proj,
                        taskName: task,
                        hours
                    });
                    projTotal += hours;
                    projectRowSpans[proj] = (projectRowSpans[proj] || 0) + 1;
                }
            });
            projectTotals[proj] = projTotal;
            grandTotal += projTotal;
        });

        if (rows.length === 0) {
            const emptyHtml = `<p style="text-align:center;color:var(--text-muted);padding:30px;font-weight:bold;">稼働実績データがありません。</p>`;
            listContainer.innerHTML = emptyHtml;
            if (printContainer) printContainer.innerHTML = emptyHtml;
            return;
        }

        // テーブルHTML生成
        const makeTableHtml = (isPrint = false) => {
            const renderedProjects = new Set();
            const renderedTotals = new Set();
            let tableHtml = `
                <div style="text-align: right; font-size: 0.72rem; color: var(--text-muted, #64748b); margin-bottom: 6px; font-weight: bold;">
                    ※各セルの数値は、これまでの累計作業時間（時間単位: h）を表します。
                </div>
                <div class="table-responsive" style="overflow-x: auto; width: 100%; -webkit-overflow-scrolling: touch;">
                    <table class="grid-table" style="table-layout: fixed; width: 100%; border-collapse: collapse; font-size: 0.8rem; border: 1px solid var(--border, #cbd5e1); min-width: ${isPrint ? '100%' : '700px'};">
                        <colgroup>
                            <col style="width: 35%;">
                            <col style="width: 35%;">
                            <col style="width: 15%;">
                            <col style="width: 15%;">
                        </colgroup>
                        <thead>
                            <tr style="background: var(--bg-muted, #f1f5f9); border-bottom: 2px solid var(--border, #cbd5e1);">
                                <th style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: left; font-weight: bold; width: 35%;">工事名</th>
                                <th style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: left; font-weight: bold; width: 35%;">作業内容</th>
                                <th style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: right; font-weight: bold; width: 15%;">作業合計 (h)</th>
                                <th style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: right; font-weight: bold; background: #e2e8f0; color: #1e293b; width: 15%;">工事合計 (h)</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            rows.forEach(r => {
                tableHtml += `<tr style="border-bottom: 1px solid var(--border, #cbd5e1);">`;

                if (!renderedProjects.has(r.projectName)) {
                    const rowspan = projectRowSpans[r.projectName];
                    tableHtml += `
                        <td rowspan="${rowspan}" style="border: 1px solid var(--border, #cbd5e1); padding: 8px; font-weight: bold; vertical-align: middle; background: var(--card-bg, #ffffff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.projectName}">
                            ${r.projectName}
                        </td>
                    `;
                    renderedProjects.add(r.projectName);
                }

                tableHtml += `
                    <td style="border: 1px solid var(--border, #cbd5e1); padding: 8px; vertical-align: middle; background: var(--card-bg, #ffffff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.taskName}">
                        ${r.taskName}
                    </td>
                    <td style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: right; font-weight: bold; background: var(--card-bg, #ffffff);">
                        ${r.hours.toFixed(1).replace('.0', '')}
                    </td>
                `;

                // 工事合計セルも rowspan
                if (!renderedTotals.has(r.projectName)) {
                    const rowspan = projectRowSpans[r.projectName];
                    const projTotal = projectTotals[r.projectName];
                    tableHtml += `
                        <td rowspan="${rowspan}" style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: right; font-weight: bold; background: #f8fafc; color: var(--text-main, #1e293b); vertical-align: middle;">
                            ${projTotal.toFixed(1).replace('.0', '')}
                        </td>
                    `;
                    renderedTotals.add(r.projectName);
                }

                tableHtml += `</tr>`;
            });

            tableHtml += `
                <tr style="background: #e2e8f0; font-weight: bold; border-top: 2px solid var(--border, #cbd5e1);">
                    <td colspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: center; color: #1e293b;">総合計（累計）</td>
                    <td colspan="2" style="border: 1px solid var(--border, #cbd5e1); padding: 8px; text-align: right; font-size: 0.9rem; background: #cbd5e1; color: #0f172a;">
                        ${grandTotal.toFixed(1).replace('.0', '')} H
                    </td>
                </tr>
            `;

            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;
            return tableHtml;
        };

        listContainer.innerHTML = makeTableHtml(false);
        if (printContainer) {
            printContainer.innerHTML = makeTableHtml(true);
        }
    }



    // 工事別・作業別工数集計の描画

    function renderDailyReportSummary() {

        const thead = document.getElementById('summary-thead');

        const tbody = document.getElementById('summary-tbody');

        if (!thead || !tbody) return;



        const filterMonthSelect = document.getElementById('summary-filter-month');

        const filterProjectSelect = document.getElementById('summary-filter-project');



        const selectedMonth = filterMonthSelect ? filterMonthSelect.value : '';

        const selectedProject = filterProjectSelect ? filterProjectSelect.value : '';



        let filteredReports = allDailyReports;

        if (selectedMonth) {

            filteredReports = filteredReports.filter(r => r.date && r.date.startsWith(selectedMonth));

        }

        if (selectedProject) {

            filteredReports = filteredReports.filter(r => r.projectId === selectedProject);

        }



        if (filterMonthSelect && filterMonthSelect.children.length <= 1) {

            const months = [...new Set(allDailyReports.map(r => r.date ? r.date.substring(0, 7) : ''))].filter(Boolean).sort().reverse();

            filterMonthSelect.innerHTML = '<option value="">すべての月</option>';

            months.forEach(m => {

                filterMonthSelect.innerHTML += `<option value="${m}">${m.replace('-', '年')}月</option>`;

            });

            filterMonthSelect.value = selectedMonth;

        }



        const taskTypes = ["切断", "孔あけ", "溶接", "塗装", "組立", "検査", "出荷準備", "図面作図", "検査対応", "積算", "見積作成", "現寸"];



        let headHtml = `

            <tr style="background:var(--bg-muted, #f1f5f9);border-bottom:2px solid var(--border);">

                <th style="padding:10px;text-align:left;min-width:180px;">工事名</th>

                <th style="padding:10px;text-align:center;min-width:100px;">工事番号</th>

                ${taskTypes.map(t => `<th style="padding:10px;text-align:right;width:75px;">${t}</th>`).join('')}

                <th style="padding:10px;text-align:right;width:80px;font-weight:bold;background:#e2e8f0;color:#1e293b;">合計(h)</th>

            </tr>

        `;

        thead.innerHTML = headHtml;



        const projectSummary = {};

        filteredReports.forEach(r => {

            const pid = r.projectId;

            if (!projectSummary[pid]) {

                projectSummary[pid] = {

                    projectName: r.projectName,

                    projectNumber: r.projectNumber,

                    hoursByTask: {},

                    totalHours: 0

                };

                taskTypes.forEach(t => projectSummary[pid].hoursByTask[t] = 0);

            }



            const taskCount = (r.tasks || []).length;

            if (taskCount > 0) {

                const share = r.hours / taskCount;

                r.tasks.forEach(t => {

                    if (projectSummary[pid].hoursByTask[t] !== undefined) {

                        projectSummary[pid].hoursByTask[t] += share;

                    }

                });

            }

            projectSummary[pid].totalHours += r.hours;

        });



        const summaryRows = Object.values(projectSummary);

        summaryRows.sort((a, b) => (a.projectName || '') > (b.projectName || '') ? 1 : -1);



        if (summaryRows.length === 0) {

            tbody.innerHTML = `<tr><td colspan="${taskTypes.length + 3}" style="text-align:center;padding:25px;color:var(--text-muted);font-weight:bold;">集計期間内のデータがありません。</td></tr>`;

            return;

        }



        let bodyHtml = '';

        const colTotals = {};

        taskTypes.forEach(t => colTotals[t] = 0);

        let grandTotal = 0;



        summaryRows.forEach(row => {

            bodyHtml += `<tr style="border-bottom:1px solid var(--border);">

                <td style="padding:10px;text-align:left;font-weight:bold;color:var(--text-main);">${row.projectName}</td>

                <td style="padding:10px;text-align:center;color:var(--text-muted);">${row.projectNumber || '-'}</td>

            `;



            taskTypes.forEach(t => {

                const hr = row.hoursByTask[t] || 0;

                colTotals[t] += hr;

                bodyHtml += `<td style="padding:10px;text-align:right;color:${hr > 0 ? 'var(--text-main)' : 'var(--text-muted)'};">${hr > 0 ? hr.toFixed(1) : '-'}</td>`;

            });



            grandTotal += row.totalHours;

            bodyHtml += `<td style="padding:10px;text-align:right;font-weight:bold;background:#f8fafc;color:#1e3a8a;">${row.totalHours.toFixed(1)}</td></tr>`;

        });



        bodyHtml += `<tr style="border-top:2px double var(--border);background:#f1f5f9;font-weight:bold;color:#1e293b;">

            <td colspan="2" style="padding:10px;text-align:center;">合計</td>

            ${taskTypes.map(t => `<td style="padding:10px;text-align:right;">${colTotals[t] > 0 ? colTotals[t].toFixed(1) : '-'}</td>`).join('')}

            <td style="padding:10px;text-align:right;color:#1e3a8a;font-size:1.05rem;">${grandTotal.toFixed(1)}</td>

        </tr>`;



        tbody.innerHTML = bodyHtml;



        const printSummaryTitle = document.getElementById('print-summary-title');

        if (printSummaryTitle) {

            const titleText = selectedMonth 

                ? `${selectedMonth.substring(0, 4)}年${selectedMonth.substring(5, 7)}月 工事別作業時間集計`

                : '工事別作業時間集計 (全期間)';

            printSummaryTitle.textContent = titleText;

        }

    }


    // ============================================================
    // 📝 日次日報入力フォームの制御とイベントバインド (2026年5月31日)
    const reportDateInput = document.getElementById('report-date');
    const btnDateToday = document.getElementById('btn-date-today');
    const btnDateYesterday = document.getElementById('btn-date-yesterday');
    const reportHoursInput = document.getElementById('report-hours');
    const btnHoursMinus = document.getElementById('btn-hours-minus');
    const btnHoursPlus = document.getElementById('btn-hours-plus');
    const dailyReportForm = document.getElementById('daily-report-form');

    const formatDate = (date) => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    // 初期値として今日の日付を設定
    if (reportDateInput && !reportDateInput.value) {
        // reportDateInput.value = formatDate(new Date()); // 日付はクリアせず維持する
            if (!reportDateInput.value) {
                reportDateInput.value = formatDate(new Date());
            }
    }

    // 作業日変更時に、本日の登録済み日報一覧を更新
    if (reportDateInput) {
        reportDateInput.addEventListener('change', () => {
            if (typeof renderBufferedReports === 'function') {
                renderBufferedReports();
            }
        });
    }

    // 社員選択変更時にも、登録済み日報一覧を更新
    const reportMemberSelect = document.getElementById('report-member-select');
    if (reportMemberSelect) {
        reportMemberSelect.addEventListener('change', () => {
            if (typeof renderBufferedReports === 'function') {
                renderBufferedReports();
            }
        });
    }

    // 「今日」ボタン
    if (btnDateToday && reportDateInput) {
        btnDateToday.addEventListener('click', () => {
            // reportDateInput.value = formatDate(new Date()); // 日付はクリアせず維持する
            if (!reportDateInput.value) {
                reportDateInput.value = formatDate(new Date());
            }
        });
    }

    // 「昨日」ボタン
    if (btnDateYesterday && reportDateInput) {
        btnDateYesterday.addEventListener('click', () => {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            reportDateInput.value = formatDate(yesterday);
        });
    }

    // 工数「ー」ボタン
    if (btnHoursMinus && reportHoursInput) {
        btnHoursMinus.addEventListener('click', () => {
            let val = parseFloat(reportHoursInput.value) || 8.0;
            val = Math.max(0.5, val - 0.5);
            reportHoursInput.value = val.toFixed(1);
        });
    }

    // 工数「＋」ボタン
    if (btnHoursPlus && reportHoursInput) {
        btnHoursPlus.addEventListener('click', () => {
            let val = parseFloat(reportHoursInput.value) || 8.0;
            val = Math.min(24.0, val + 0.5);
            reportHoursInput.value = val.toFixed(1);
        });
    }



    // 日報登録処理
    if (dailyReportForm) {

        // 編集キャンセルボタンを動的に追加

        let cancelEditBtn = document.getElementById('btn-report-cancel-edit');

        if (!cancelEditBtn) {

            cancelEditBtn = document.createElement('button');

            cancelEditBtn.type = 'button';

            cancelEditBtn.id = 'btn-report-cancel-edit';

            cancelEditBtn.className = 'btn btn-secondary';

            cancelEditBtn.style.cssText = 'width:100%; height:45px; margin-top:10px; display:none;';

            cancelEditBtn.textContent = '編集をキャンセルする';

            dailyReportForm.appendChild(cancelEditBtn);

        }



        // 編集対象の日報ID保持用の隠しinput

        let reportIdInput = document.getElementById('report-edit-id');

        if (!reportIdInput) {

            reportIdInput = document.createElement('input');

            reportIdInput.type = 'hidden';

            reportIdInput.id = 'report-edit-id';

            dailyReportForm.appendChild(reportIdInput);

        }



        cancelEditBtn.addEventListener('click', () => {

            resetDailyReportForm();

        });
        dailyReportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = document.getElementById('btn-report-submit');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = '登録中...';
            }

            const memberSelectEl = document.getElementById('report-member-select');
            const selectedMemberName = memberSelectEl ? memberSelectEl.value : '';

            const dateVal = reportDateInput.value;
            const projectIdVal = document.getElementById('report-project-id').value;
            const projectSelectEl = document.getElementById('report-project-id');
            const projectText = projectSelectEl ? projectSelectEl.options[projectSelectEl.selectedIndex].text : '';
            
            const reportIdInput = document.getElementById('report-edit-id');
            const editId = reportIdInput ? reportIdInput.value : '';

            if (!selectedMemberName) {
                showToast('社員名を選択してください。', 'warning');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '作業を登録';
                }
                return;
            }

            // チェックされたタスク
            const taskArray = [];
            document.querySelectorAll('input[name="report-tasks"]:checked').forEach(cb => {
                taskArray.push(cb.value);
            });

            const hoursVal = parseFloat(reportHoursInput.value) || 0;
            const notesVal = document.getElementById('report-notes').value.trim();

            if (taskArray.includes('その他') && !notesVal) {
                showToast('「その他」の具体的な作業内容を入力してください。', 'warning');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '作業を登録';
                }
                return;
            }

            if (!dateVal || !projectIdVal) {
                showToast('作業日と工事名を選択してください。', 'warning');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '作業を登録';
                }
                return;
            }

            if (taskArray.length === 0) {
                showToast('作業内容を選択してください。', 'warning');
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '作業を登録';
                }
                return;
            }

            const reportData = {
                companyId: currentCompany.companyId,
                uid: currentUser.uid,
                email: currentUser.email,
                author: selectedMemberName,
                date: dateVal,
                projectId: projectIdVal,
                projectName: projectText.split(' (')[0], // 「工事名 (工事番号)」から工事名部分のみ抽出
                projectNumber: projectText.includes('(') ? projectText.split('(')[1].replace(')', '') : '',
                tasks: taskArray,
                hours: hoursVal,
                notes: notesVal,
                createdAt: new Date().toISOString()
            };

            try {
                if (editId) {
                    await updateDoc(doc(db, "daily_reports", editId), reportData);
                    alert('作業を更新しました！');
                    resetDailyReportForm();
                } else {
                    // 重複登録のチェック（社員名ベース）
                    const duplicateQuery = query(
                        collection(db, "daily_reports"),
                        where("companyId", "==", currentCompany.companyId),
                        where("author", "==", selectedMemberName),
                        where("date", "==", dateVal),
                        where("projectId", "==", projectIdVal)
                    );
                    const querySnapshot = await getDocs(duplicateQuery);
                    
                    if (!querySnapshot.empty) {
                        if (confirm(`既に同じ作業日（${dateVal}）の工事「${reportData.projectName}」に対する日報が登録されています。上書き更新しますか？`)) {
                            const docId = querySnapshot.docs[0].id;
                            await updateDoc(doc(db, "daily_reports", docId), reportData);
                            alert('作業を上書き更新しました！');
                            resetDailyReportForm();
                        } else {
                            if (submitBtn) {
                                submitBtn.disabled = false;
                                submitBtn.textContent = '作業を登録';
                            }
                            return;
                        }
                    } else {
                        reportData.createdAt = new Date().toISOString();
                        await addDoc(collection(db, "daily_reports"), reportData);
                        alert('作業を登録しました！');
                        resetDailyReportForm();
                    }
                }

                // 日報履歴などを再読み込みする
                if (typeof window.loadDailyReports === 'function') {
                    await window.loadDailyReports();
                }
            } catch (err) {
                console.error("Error saving daily report: ", err);
                alert('保存に失敗しました: ' + err.message);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = '作業を登録';
                }
            }
        });

        // ラジオボタンの「その他」と「その他の作業」入力欄の連動表示制御
        document.querySelectorAll('input[name="report-tasks"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const notesGroup = document.getElementById('report-notes-group');
                if (notesGroup) {
                    notesGroup.style.display = (radio.value === 'その他' && radio.checked) ? 'block' : 'none';
                }
            });
        });
    }
});

// ==========================================
// 管理者設定メニューおよび再認証制御ロジック
// ==========================================

// 一時的なFirebaseアプリを用いて、メインのセッションを壊さずに管理者情報を検証する
async function verifyAdminCredentials(email, password) {
    const tempAppName = "TempAdminApp_" + Date.now();
    const tempApp = initializeApp(firebaseConfig, tempAppName);
    const tempAuth = getAuth(tempApp);
    try {
        const userCredential = await signInWithEmailAndPassword(tempAuth, email, password);
        const tempUid = userCredential.user.uid;
        
        // Firestoreから管理者権限があるかをクエリ
        const companyData = await resolveUserCompany(email, tempUid);
        
        await deleteApp(tempApp);
        
        if (companyData && companyData.role === 'admin') {
            // 現在ログイン中の会社と一致するか厳格に検証
            if (currentCompany) {
                const isOwner = currentCompany.ownerUid === tempUid;
                const isAdminEmail = currentCompany.adminEmails && currentCompany.adminEmails.includes(email);
                
                if (!isOwner && !isAdminEmail) {
                    throw new Error("現在ログインしている会社とは異なる会社の管理者アカウントです。");
                }
            }
            return companyData;
        } else {
            throw new Error("このアカウントには管理者（企業）権限がありません。");
        }
    } catch (err) {
        try { await deleteApp(tempApp); } catch(e) {}
        // Firebaseの認証エラーコードの日本語化
        let errorMsg = err.message;
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
            errorMsg = "メールアドレスまたはパスワードが正しくありません。";
        }
        throw new Error(errorMsg);
    }
}

// DOMContentLoadedのタイミングでイベントを紐付け
document.addEventListener('DOMContentLoaded', () => {
    const btnAdminSettings = document.getElementById('btn-admin-settings');
    const adminSettingsModal = document.getElementById('admin-settings-modal');
    const btnCloseSettingsModal = document.getElementById('btn-close-settings-modal');
    const settingsAuthSection = document.getElementById('settings-auth-section');
    const settingsMenuSection = document.getElementById('settings-menu-section');
    const settingsAuthForm = document.getElementById('settings-auth-form');
    const settingsAuthEmail = document.getElementById('settings-auth-email');
    const settingsAuthPassword = document.getElementById('settings-auth-password');
    const settingsAuthError = document.getElementById('settings-auth-error');
    
    const settingsPlanLimit = document.getElementById('settings-plan-limit');
    const settingsBtnChangePlan = document.getElementById('settings-btn-change-plan');
    const settingsBtnSchedule = document.getElementById('settings-btn-schedule');
    const settingsBtnEmployee = document.getElementById('settings-btn-employee');
    const settingsBtnCost = document.getElementById('settings-btn-cost');
    const settingsBtnVendor = document.getElementById('settings-btn-vendor');
    const btnCloseAdminMode = document.getElementById('btn-close-admin-mode');
    const settingsBtnCloseMenu = document.getElementById('settings-btn-close-menu');

    let previousActiveTabTarget = 'gantt-view'; // 初期値

    const lockNavAndHeader = (lock) => {
        const navTabs = document.querySelector('nav.tabs');
        const btnAdmin = document.getElementById('btn-admin-settings');
        const themeToggle = document.getElementById('theme-toggle');
        const btnLogout = document.getElementById('btn-logout');
        [navTabs, btnAdmin, themeToggle, btnLogout].forEach(el => {
            if (el) {
                if (lock) {
                    el.classList.add('tabs-locked');
                } else {
                    el.classList.remove('tabs-locked');
                }
            }
        });
    };

    if (!btnAdminSettings || !adminSettingsModal) return;

    // ⚙️設定ボタンをクリックした際
    btnAdminSettings.addEventListener('click', () => {
        // 入力値をクリア
        settingsAuthEmail.value = '';
        settingsAuthPassword.value = '';
        settingsAuthError.textContent = '';
        settingsAuthError.classList.add('hidden');
        
        // 認証画面を表示、メニューを非表示
        settingsAuthSection.style.display = 'block';
        settingsMenuSection.style.display = 'none';
        
        // モーダル表示
        adminSettingsModal.style.display = 'flex';
    });

    // 閉じる (×) ボタンをクリックした際
    btnCloseSettingsModal.addEventListener('click', () => {
        adminSettingsModal.style.display = 'none';
    });

    // 最下段の「閉じる」ボタンをクリックした際
    if (settingsBtnCloseMenu) {
        settingsBtnCloseMenu.addEventListener('click', () => {
            adminSettingsModal.style.display = 'none';
        });
    }

    // モーダルの外側クリックで閉じる
    adminSettingsModal.addEventListener('click', (e) => {
        if (e.target === adminSettingsModal) {
            adminSettingsModal.style.display = 'none';
        }
    });

    // 認証フォーム送信
    settingsAuthForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = settingsAuthEmail.value.trim();
        const password = settingsAuthPassword.value;
        const submitBtn = settingsAuthForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = "認証中...";
        settingsAuthError.classList.add('hidden');

        try {
            const companyData = await verifyAdminCredentials(email, password);
            
            // 認証成功時：メニューを表示
            const maxUsers = companyData.maxUsers || 10;
            if (settingsPlanLimit) {
                settingsPlanLimit.textContent = maxUsers;
            }
            
            // トライアル情報の表示
            const trialInfoDiv = document.getElementById('settings-trial-info');
            const trialPeriodSpan = document.getElementById('settings-trial-period');
            if (trialInfoDiv && trialPeriodSpan) {
                const nowSec = Math.floor(Date.now() / 1000);
                const trialStart = companyData.trialStart;
                const trialEnd = companyData.trialEnd;
                
                if (trialEnd && nowSec < trialEnd) {
                    const startDate = new Date(trialStart * 1000);
                    const endDate = new Date(trialEnd * 1000);
                    const startStr = `${startDate.getMonth() + 1}月${startDate.getDate()}日`;
                    const endStr = `${endDate.getMonth() + 1}月${endDate.getDate()}日`;
                    trialPeriodSpan.textContent = `（${startStr}～${endStr}まで）`;
                    trialInfoDiv.style.display = 'block';
                } else {
                    trialInfoDiv.style.display = 'none';
                }
            }

            // プラン変更ボタンの紐付け
            if (settingsBtnChangePlan) {
                settingsBtnChangePlan.onclick = () => {
                    window.open(`/change-plan.html?cid=${companyData.companyId}`, '_blank');
                };
            }

            settingsAuthSection.style.display = 'none';
            settingsMenuSection.style.display = 'block';
        } catch (err) {
            settingsAuthError.textContent = err.message;
            settingsAuthError.classList.remove('hidden');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });

    // メニュー：工事登録へ
    if (settingsBtnSchedule) {
        settingsBtnSchedule.addEventListener('click', () => {
            // 現在アクティブな一般タブを退避（戻る時のため）
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.target !== 'schedule-input-view' && activeTab.dataset.target !== 'employee-manage-view' && activeTab.dataset.target !== 'attendance-admin-view' && activeTab.dataset.target !== 'cost-manage-view' && activeTab.dataset.target !== 'vendor-manage-view') {
                previousActiveTabTarget = activeTab.dataset.target;
            }
            
            adminSettingsModal.style.display = 'none';
            
            // 非表示にしている隠しタブボタンをクリックさせて画面切り替え
            const targetTab = document.getElementById('tab-schedule-input-hidden');
            if (targetTab) {
                targetTab.click();
            }
            
            // 終了ボタンを表示
            if (btnCloseAdminMode) {
                btnCloseAdminMode.style.display = 'block';
            }
            lockNavAndHeader(true);
        });
    }

    // メニュー：社員登録へ
    if (settingsBtnEmployee) {
        settingsBtnEmployee.addEventListener('click', () => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.target !== 'schedule-input-view' && activeTab.dataset.target !== 'employee-manage-view' && activeTab.dataset.target !== 'attendance-admin-view' && activeTab.dataset.target !== 'cost-manage-view' && activeTab.dataset.target !== 'vendor-manage-view') {
                previousActiveTabTarget = activeTab.dataset.target;
            }

            adminSettingsModal.style.display = 'none';

            const targetTab = document.getElementById('tab-employee-manage');
            if (targetTab) {
                targetTab.click();
            }

            if (btnCloseAdminMode) {
                btnCloseAdminMode.style.display = 'block';
            }
            lockNavAndHeader(true);
        });
    }

    // メニュー：出退勤管理へ
    const settingsBtnAttendanceAdmin = document.getElementById('settings-btn-attendance-admin');
    if (settingsBtnAttendanceAdmin) {
        settingsBtnAttendanceAdmin.addEventListener('click', () => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.target !== 'schedule-input-view' && activeTab.dataset.target !== 'employee-manage-view' && activeTab.dataset.target !== 'attendance-admin-view' && activeTab.dataset.target !== 'cost-manage-view' && activeTab.dataset.target !== 'vendor-manage-view') {
                previousActiveTabTarget = activeTab.dataset.target;
            }
            adminSettingsModal.style.display = 'none';
            const targetTab = document.getElementById('tab-attendance-admin-hidden');
            if (targetTab) {
                targetTab.click();
            }
            if (btnCloseAdminMode) {
                btnCloseAdminMode.style.display = 'block';
            }
            lockNavAndHeader(true);
        });
    }

    // メニュー：原価管理へ
    if (settingsBtnCost) {
        settingsBtnCost.addEventListener('click', () => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.target !== 'schedule-input-view' && activeTab.dataset.target !== 'employee-manage-view' && activeTab.dataset.target !== 'attendance-admin-view' && activeTab.dataset.target !== 'cost-manage-view' && activeTab.dataset.target !== 'vendor-manage-view') {
                previousActiveTabTarget = activeTab.dataset.target;
            }
            adminSettingsModal.style.display = 'none';
            const targetTab = document.getElementById('tab-cost-hidden');
            if (targetTab) {
                targetTab.click();
            }
            if (btnCloseAdminMode) {
                btnCloseAdminMode.style.display = 'block';
            }
            lockNavAndHeader(true);
        });
    }

    // メニュー：外注先管理へ
    if (settingsBtnVendor) {
        settingsBtnVendor.addEventListener('click', () => {
            const activeTab = document.querySelector('.tab-btn.active');
            if (activeTab && activeTab.dataset.target !== 'schedule-input-view' && activeTab.dataset.target !== 'employee-manage-view' && activeTab.dataset.target !== 'attendance-admin-view' && activeTab.dataset.target !== 'cost-manage-view' && activeTab.dataset.target !== 'vendor-manage-view') {
                previousActiveTabTarget = activeTab.dataset.target;
            }
            adminSettingsModal.style.display = 'none';
            const targetTab = document.getElementById('tab-vendor-hidden');
            if (targetTab) {
                targetTab.click();
            }
            if (btnCloseAdminMode) {
                btnCloseAdminMode.style.display = 'block';
            }
            lockNavAndHeader(true);
        });
    }

    // 🔙 管理者設定メニューへ戻るボタンをクリックした際
    if (btnCloseAdminMode) {
        btnCloseAdminMode.addEventListener('click', () => {
            // 終了ボタンを非表示
            btnCloseAdminMode.style.display = 'none';
            
            // 元の一般タブに戻る（クリックイベントを発火）
            const originalTab = document.querySelector(`.tab-btn[data-target="${previousActiveTabTarget}"]`);
            if (originalTab) {
                originalTab.click();
            } else {
                // 退避していない場合はデフォルトの工程管理表に戻る
                const defaultTab = document.querySelector('.tab-btn[data-target="gantt-view"]');
                if (defaultTab) defaultTab.click();
            }

            // 管理者設定メニューを再度開く（認証は完了しているのでメニューセクションを直接表示）
            if (adminSettingsModal) {
                settingsAuthSection.style.display = 'none';
                settingsMenuSection.style.display = 'block';
                adminSettingsModal.style.display = 'flex';
            }
            lockNavAndHeader(false);
        });
    }

    // ==========================================
    // 出退勤打刻画面のイベント紐付け
    // ==========================================
    const attendMemberSelect = document.getElementById('attend-member-select');
    if (attendMemberSelect) {
        attendMemberSelect.addEventListener('change', () => {
            loadAttendanceData(attendMemberSelect.value);
        });
    }

    const btnAttendCheckin = document.getElementById('btn-attend-checkin');
    if (btnAttendCheckin) {
        btnAttendCheckin.addEventListener('click', () => {
            performCheckIn();
        });
    }

    const btnAttendCheckout = document.getElementById('btn-attend-checkout');
    if (btnAttendCheckout) {
        btnAttendCheckout.addEventListener('click', () => {
            performCheckOut();
        });
    }

    // ==========================================
    // 管理者出退勤管理画面のイベント紐付け
    // ==========================================
    const attendAdminFilterMonth = document.getElementById('attend-admin-filter-month');
    if (attendAdminFilterMonth) {
        attendAdminFilterMonth.addEventListener('change', () => {
            loadAttendanceAdminData();
        });
    }

    const attendAdminFilterMember = document.getElementById('attend-admin-filter-member');
    if (attendAdminFilterMember) {
        attendAdminFilterMember.addEventListener('change', () => {
            loadAttendanceAdminData();
        });
    }

    // 表示モード切り替えスイッチ
    const btnAttendModeList = document.getElementById('btn-attend-mode-list');
    const btnAttendModeCalendar = document.getElementById('btn-attend-mode-calendar');
    const containerList = document.getElementById('attend-admin-list-container');
    const containerCalendar = document.getElementById('attend-admin-calendar-container');

    if (btnAttendModeList && btnAttendModeCalendar) {
        btnAttendModeList.addEventListener('click', () => {
            btnAttendModeList.classList.add('active');
            btnAttendModeList.style.background = 'var(--primary)';
            btnAttendModeList.style.color = 'white';
            btnAttendModeCalendar.classList.remove('active');
            btnAttendModeCalendar.style.background = 'transparent';
            btnAttendModeCalendar.style.color = 'var(--text-main)';

            if (containerList) containerList.style.display = 'block';
            if (containerCalendar) containerCalendar.style.display = 'none';
        });

        btnAttendModeCalendar.addEventListener('click', () => {
            btnAttendModeCalendar.classList.add('active');
            btnAttendModeCalendar.style.background = 'var(--primary)';
            btnAttendModeCalendar.style.color = 'white';
            btnAttendModeList.classList.remove('active');
            btnAttendModeList.style.background = 'transparent';
            btnAttendModeList.style.color = 'var(--text-main)';

            if (containerCalendar) containerCalendar.style.display = 'block';
            if (containerList) containerList.style.display = 'none';

            // カレンダー再描画
            renderAttendanceCalendar();
        });
    }

    // カレンダー印刷
    const btnAttendPrintCalendar = document.getElementById('btn-attend-print-calendar');
    if (btnAttendPrintCalendar) {
        btnAttendPrintCalendar.addEventListener('click', () => {
            printAttendanceCalendar();
        });
    }

    // Excelエクスポート
    const btnAttendExportCalendar = document.getElementById('btn-attend-export-calendar');
    if (btnAttendExportCalendar) {
        btnAttendExportCalendar.addEventListener('click', () => {
            exportAttendanceCalendarToExcel();
        });
    }

    // 原価管理・月次収支の初期化
    initCostManagePanel();
});

// ==========================================
// 出退勤打刻・管理機能ロジック
// ==========================================

// 現在日付取得用ヘルパー (YYYY-MM-DD)
function getTodayStr(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 現在月取得用ヘルパー (YYYY-MM)
function getTodayMonthStr(dateObj = new Date()) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

// 出退勤用デジタル時計の制御
let attendanceClockInterval = null;

function startAttendanceClock() {
    if (attendanceClockInterval) clearInterval(attendanceClockInterval);
    
    const updateClock = () => {
        const now = new Date();
        const dateEl = document.getElementById('attend-current-date');
        if (dateEl) {
            const days = ['日', '月', '火', '水', '木', '金', '土'];
            dateEl.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 (${days[now.getDay()]})`;
        }
        const timeEl = document.getElementById('attend-current-time');
        if (timeEl) {
            const h = String(now.getHours()).padStart(2, '0');
            const m = String(now.getMinutes()).padStart(2, '0');
            const s = String(now.getSeconds()).padStart(2, '0');
            timeEl.textContent = `${h}:${m}:${s}`;
        }
    };
    
    updateClock();
    attendanceClockInterval = setInterval(updateClock, 1000);
}

function stopAttendanceClock() {
    if (attendanceClockInterval) {
        clearInterval(attendanceClockInterval);
        attendanceClockInterval = null;
    }
}

// 打刻画面の社員名プルダウン生成
function populateAttendanceMemberDropdown() {
    const select = document.getElementById('attend-member-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">打刻する社員を選択してください</option>';
    
    if (!currentCompany || !currentCompany.employees) return;
    
    const employees = [...currentCompany.employees].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    employees.forEach(emp => {
        const opt = document.createElement('option');
        opt.value = emp.name;
        opt.textContent = emp.name;
        select.appendChild(opt);
    });

    select.value = "";
    resetAttendanceButtons();
}

function resetAttendanceButtons() {
    const btnCheckin = document.getElementById('btn-attend-checkin');
    const btnCheckout = document.getElementById('btn-attend-checkout');
    const checkinTimeEl = document.getElementById('attend-checkin-time');
    const checkoutTimeEl = document.getElementById('attend-checkout-time');
    const messageEl = document.getElementById('attend-message');

    if (btnCheckin) btnCheckin.disabled = true;
    if (btnCheckout) btnCheckout.disabled = true;
    if (checkinTimeEl) checkinTimeEl.textContent = "- - : - -";
    if (checkoutTimeEl) checkoutTimeEl.textContent = "- - : - -";
    if (messageEl) {
        messageEl.textContent = "";
        messageEl.className = "message hidden";
    }
}

// 社員選択時の打刻状況ロード
async function loadAttendanceData(memberName) {
    if (!memberName) {
        resetAttendanceButtons();
        return;
    }

    const btnCheckin = document.getElementById('btn-attend-checkin');
    const btnCheckout = document.getElementById('btn-attend-checkout');
    const checkinTimeEl = document.getElementById('attend-checkin-time');
    const checkoutTimeEl = document.getElementById('attend-checkout-time');
    const messageEl = document.getElementById('attend-message');
    
    if (!currentCompany || !currentCompany.companyId) return;

    try {
        const todayStr = getTodayStr();
        const docRef = doc(db, "companies", currentCompany.companyId, "attendance", memberName, "daily", todayStr);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const checkIn = data.checkIn || "";
            const checkOut = data.checkOut || "";

            if (checkinTimeEl) checkinTimeEl.textContent = checkIn ? checkIn : "- - : - -";
            if (checkoutTimeEl) checkoutTimeEl.textContent = checkOut ? checkOut : "- - : - -";

            if (!checkIn) {
                if (btnCheckin) btnCheckin.disabled = false;
                if (btnCheckout) btnCheckout.disabled = true;
                if (messageEl) {
                    messageEl.textContent = "";
                    messageEl.className = "message hidden";
                }
            } else if (checkIn && !checkOut) {
                if (btnCheckin) btnCheckin.disabled = true;
                if (btnCheckout) btnCheckout.disabled = false;
                if (messageEl) {
                    messageEl.textContent = "";
                    messageEl.className = "message hidden";
                }
            } else {
                if (btnCheckin) btnCheckin.disabled = true;
                if (btnCheckout) btnCheckout.disabled = true;
                if (messageEl) {
                    messageEl.textContent = "本日の打刻（出勤・退勤）は完了しています。";
                    messageEl.className = "message info";
                }
            }
        } else {
            if (checkinTimeEl) checkinTimeEl.textContent = "- - : - -";
            if (checkoutTimeEl) checkoutTimeEl.textContent = "- - : - -";
            if (btnCheckin) btnCheckin.disabled = false;
            if (btnCheckout) btnCheckout.disabled = true;
            if (messageEl) {
                messageEl.textContent = "";
                messageEl.className = "message hidden";
            }
        }
    } catch (error) {
        console.error("Error loading attendance data:", error);
        if (messageEl) {
            messageEl.textContent = "打刻データの取得に失敗しました。";
            messageEl.className = "message error";
        }
    }
}

// 出勤打刻処理
async function performCheckIn() {
    const select = document.getElementById('attend-member-select');
    if (!select) return;
    const memberName = select.value;
    if (!memberName) return;

    const btnCheckin = document.getElementById('btn-attend-checkin');
    if (!currentCompany || !currentCompany.companyId) return;

    try {
        if (btnCheckin) btnCheckin.disabled = true;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const todayStr = getTodayStr();

        const docRef = doc(db, "companies", currentCompany.companyId, "attendance", memberName, "daily", todayStr);
        
        const docSnap = await getDoc(docRef);
        if (docSnap.exists() && docSnap.data().checkIn) {
            alert("すでに出勤打刻が記録されています。");
            await loadAttendanceData(memberName);
            return;
        }

        await setDoc(docRef, {
            checkIn: timeStr,
            date: todayStr,
            memberName: memberName,
            updatedAt: now.getTime()
        }, { merge: true });

        if (typeof showToast === 'function') {
            showToast(`${memberName}さん、出勤打刻完了しました (${timeStr})`);
        } else {
            alert(`${memberName}さん、出勤打刻完了しました (${timeStr})`);
        }
        await loadAttendanceData(memberName);

    } catch (error) {
        console.error("Error checking in:", error);
        alert("打刻に失敗しました。もう一度お試しください。");
        if (btnCheckin) btnCheckin.disabled = false;
    }
}

// 退勤打刻処理
async function performCheckOut() {
    const select = document.getElementById('attend-member-select');
    if (!select) return;
    const memberName = select.value;
    if (!memberName) return;

    const btnCheckout = document.getElementById('btn-attend-checkout');
    if (!currentCompany || !currentCompany.companyId) return;

    try {
        if (btnCheckout) btnCheckout.disabled = true;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const todayStr = getTodayStr();

        const docRef = doc(db, "companies", currentCompany.companyId, "attendance", memberName, "daily", todayStr);

        const docSnap = await getDoc(docRef);
        if (!docSnap.exists() || !docSnap.data().checkIn) {
            alert("出勤打刻が記録されていません。出勤打刻から行ってください。");
            await loadAttendanceData(memberName);
            return;
        }
        if (docSnap.exists() && docSnap.data().checkOut) {
            alert("すでに退勤打刻が記録されています。");
            await loadAttendanceData(memberName);
            return;
        }

        await setDoc(docRef, {
            checkOut: timeStr,
            updatedAt: now.getTime()
        }, { merge: true });

        if (typeof showToast === 'function') {
            showToast(`${memberName}さん、退勤打刻完了しました (${timeStr})`);
        } else {
            alert(`${memberName}さん、退勤打刻完了しました (${timeStr})`);
        }
        await loadAttendanceData(memberName);

    } catch (error) {
        console.error("Error checking out:", error);
        alert("打刻に失敗しました。もう一度お試しください。");
        if (btnCheckout) btnCheckout.disabled = false;
    }
}

// 管理者画面のフィルター初期化
function initAttendanceAdminFilters() {
    const monthSelect = document.getElementById('attend-admin-filter-month');
    const memberSelect = document.getElementById('attend-admin-filter-member');

    if (monthSelect && monthSelect.children.length === 0) {
        const now = new Date();
        for (let i = 0; i < 6; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const val = getTodayMonthStr(d);
            const text = `${d.getFullYear()}年${d.getMonth() + 1}月`;
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = text;
            monthSelect.appendChild(opt);
        }
    }

    if (memberSelect) {
        memberSelect.innerHTML = '<option value="">すべての社員</option>';
        if (currentCompany && currentCompany.employees) {
            const employees = [...currentCompany.employees].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
            employees.forEach(emp => {
                const opt = document.createElement('option');
                opt.value = emp.name;
                opt.textContent = emp.name;
                memberSelect.appendChild(opt);
            });
        }
    }
}

// 管理者画面のデータロードと一覧表示
async function loadAttendanceAdminData() {
    const tbody = document.getElementById('attend-admin-tbody');
    const totalDaysEl = document.getElementById('attend-admin-total-days');
    const totalHoursEl = document.getElementById('attend-admin-total-hours');
    
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">データをロード中...</td></tr>';
    if (totalDaysEl) totalDaysEl.textContent = '0 日';
    if (totalHoursEl) totalHoursEl.textContent = '0.0 時間';

    if (!currentCompany || !currentCompany.companyId) return;

    const monthSelect = document.getElementById('attend-admin-filter-month');
    const memberSelect = document.getElementById('attend-admin-filter-member');
    if (!monthSelect || !memberSelect) return;

    const filterMonth = monthSelect.value;
    const filterMember = memberSelect.value;

    const targetMembers = [];
    if (filterMember) {
        targetMembers.push(filterMember);
    } else if (currentCompany.employees) {
        currentCompany.employees.forEach(emp => {
            targetMembers.push(emp.name);
        });
    }

    if (targetMembers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">社員が登録されていません。</td></tr>';
        return;
    }

    try {
        const startDay = `${filterMonth}-01`;
        const parts = filterMonth.split('-');
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10);
        const lastDate = new Date(year, month, 0).getDate();
        const endDay = `${filterMonth}-${String(lastDate).padStart(2, '0')}`;

        const promises = targetMembers.map(async (memberName) => {
            const collRef = collection(db, "companies", currentCompany.companyId, "attendance", memberName, "daily");
            const q = query(collRef, where("date", ">=", startDay), where("date", "<=", endDay));
            const querySnapshot = await getDocs(q);
            const records = [];
            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                records.push({
                    date: data.date,
                    memberName: memberName,
                    checkIn: data.checkIn || "",
                    checkOut: data.checkOut || "",
                });
            });
            return records;
        });

        const results = await Promise.all(promises);
        let allRecords = results.flat();

        allRecords.sort((a, b) => {
            if (a.date !== b.date) {
                return b.date.localeCompare(a.date);
            }
            return a.memberName.localeCompare(b.memberName, 'ja');
        });

        let totalDays = 0;
        let totalHours = 0;
        
        tbody.innerHTML = "";
        
        if (allRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">対象期間の打刻データはありません。</td></tr>';
            return;
        }

        allRecords.forEach(rec => {
            let workingHoursStr = "-";
            let workingHours = 0;

            if (rec.checkIn && rec.checkOut) {
                const inParts = rec.checkIn.split(':');
                const outParts = rec.checkOut.split(':');
                const inMin = parseInt(inParts[0], 10) * 60 + parseInt(inParts[1], 10);
                const outMin = parseInt(outParts[0], 10) * 60 + parseInt(outParts[1], 10);
                const diffMin = outMin - inMin;

                if (diffMin > 0) {
                    workingHours = diffMin / 60;
                    workingHoursStr = workingHours.toFixed(1) + " h";
                } else {
                    workingHoursStr = "0.0 h";
                }
            }

            if (rec.checkIn) {
                totalDays++;
            }
            totalHours += workingHours;

            const tr = document.createElement('tr');
            const dateObj = new Date(rec.date);
            const days = ['日', '月', '火', '水', '木', '金', '土'];
            const dateText = `${dateObj.getMonth() + 1}/${dateObj.getDate()} (${days[dateObj.getDay()]})`;

            tr.innerHTML = `
                <td style="padding: 10px; border: 1px solid var(--border); text-align: center;">${dateText}</td>
                <td style="padding: 10px; border: 1px solid var(--border); text-align: left; font-weight: bold;">${rec.memberName}</td>
                <td style="padding: 10px; border: 1px solid var(--border); text-align: center; color: #1e3a8a; font-weight: 500;">${rec.checkIn || "- - : - -"}</td>
                <td style="padding: 10px; border: 1px solid var(--border); text-align: center; color: #9a3412; font-weight: 500;">${rec.checkOut || "- - : - -"}</td>
                <td style="padding: 10px; border: 1px solid var(--border); text-align: right; font-weight: bold; color: var(--primary);">${workingHoursStr}</td>
            `;
            tbody.appendChild(tr);
        });

        if (totalDaysEl) totalDaysEl.textContent = `${totalDays} 日`;
        if (totalHoursEl) totalHoursEl.textContent = `${totalHours.toFixed(1)} 時間`;

        // データをキャッシュしてカレンダーを描画
        allAttendanceRecords = allRecords;
        if (document.getElementById('attend-admin-calendar-container') && 
            document.getElementById('attend-admin-calendar-container').style.display !== 'none') {
            renderAttendanceCalendar();
        }

    } catch (error) {
        console.error("Error loading attendance admin data:", error);
        tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: red;">データのロード中にエラーが発生しました。</td></tr>';
    }
}

// グローバルアタッチ
window.startAttendanceClock = startAttendanceClock;
window.stopAttendanceClock = stopAttendanceClock;
window.populateAttendanceMemberDropdown = populateAttendanceMemberDropdown;
window.loadAttendanceData = loadAttendanceData;
window.performCheckIn = performCheckIn;
window.performCheckOut = performCheckOut;
window.initAttendanceAdminFilters = initAttendanceAdminFilters;
window.loadAttendanceAdminData = loadAttendanceAdminData;

// 月間カレンダーのレンダリング
function renderAttendanceCalendar() {
    const thead = document.getElementById('attend-calendar-thead');
    const tbody = document.getElementById('attend-calendar-tbody');
    if (!thead || !tbody) return;

    thead.innerHTML = "";
    tbody.innerHTML = "";

    const monthSelect = document.getElementById('attend-admin-filter-month');
    if (!monthSelect) return;
    const filterMonth = monthSelect.value;
    if (!filterMonth) return;

    const parts = filterMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    // colgroupによる列幅均等割りの適用
    let colgroup = document.getElementById('attend-calendar-colgroup');
    if (!colgroup) {
        colgroup = document.createElement('colgroup');
        colgroup.id = 'attend-calendar-colgroup';
        const table = document.querySelector('.attendance-matrix-table');
        if (table) {
            table.insertBefore(colgroup, thead);
        }
    }
    let colgroupHtml = `<col style="width: 9%;">`; // 社員名
    const dayColWidth = (81 / daysInMonth).toFixed(2);
    for (let d = 1; d <= daysInMonth; d++) {
        colgroupHtml += `<col style="width: ${dayColWidth}%;">`;
    }
    colgroupHtml += `<col style="width: 5%;">`; // 出勤日数
    colgroupHtml += `<col style="width: 5%;">`; // 合計時間
    colgroup.innerHTML = colgroupHtml;

    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
    
    const tr1 = document.createElement('tr');
    tr1.style.backgroundColor = "var(--primary)";
    tr1.style.color = "white";

    const thName = document.createElement('th');
    thName.className = "sticky-col";
    thName.textContent = "社員名";
    thName.rowSpan = 2;
    thName.style.verticalAlign = "middle";
    tr1.appendChild(thName);

    for (let d = 1; d <= daysInMonth; d++) {
        const thDay = document.createElement('th');
        thDay.textContent = d;
        const dateObj = new Date(year, month - 1, d);
        const dayOfWeek = dateObj.getDay();
        if (dayOfWeek === 6) thDay.className = "weekend-sat";
        if (dayOfWeek === 0) thDay.className = "weekend-sun";
        tr1.appendChild(thDay);
    }

    const thDaysCount = document.createElement('th');
    thDaysCount.className = "total-col";
    thDaysCount.innerHTML = "出勤<br>日数";
    thDaysCount.rowSpan = 2;
    thDaysCount.style.verticalAlign = "middle";
    tr1.appendChild(thDaysCount);

    const thTotalHours = document.createElement('th');
    thTotalHours.className = "total-col";
    thTotalHours.innerHTML = "合計<br>時間";
    thTotalHours.rowSpan = 2;
    thTotalHours.style.verticalAlign = "middle";
    tr1.appendChild(thTotalHours);

    thead.appendChild(tr1);

    const tr2 = document.createElement('tr');
    for (let d = 1; d <= daysInMonth; d++) {
        const thW = document.createElement('th');
        const dateObj = new Date(year, month - 1, d);
        const dayOfWeek = dateObj.getDay();
        thW.textContent = daysOfWeek[dayOfWeek];
        if (dayOfWeek === 6) thW.className = "weekend-sat";
        if (dayOfWeek === 0) thW.className = "weekend-sun";
        tr2.appendChild(thW);
    }
    thead.appendChild(tr2);

    const recordsMap = {};
    allAttendanceRecords.forEach(rec => {
        if (!recordsMap[rec.memberName]) {
            recordsMap[rec.memberName] = {};
        }
        
        let workingHours = 0;
        if (rec.checkIn && rec.checkOut) {
            const inParts = rec.checkIn.split(':');
            const outParts = rec.checkOut.split(':');
            const inMin = parseInt(inParts[0], 10) * 60 + parseInt(inParts[1], 10);
            const outMin = parseInt(outParts[0], 10) * 60 + parseInt(outParts[1], 10);
            const diffMin = outMin - inMin;
            if (diffMin > 0) {
                workingHours = diffMin / 60;
            }
        }
        recordsMap[rec.memberName][rec.date] = workingHours;
    });

    const filterMember = document.getElementById('attend-admin-filter-member').value;
    let targetMembers = [];
    if (filterMember) {
        targetMembers.push(filterMember);
    } else if (currentCompany && currentCompany.employees) {
        targetMembers = currentCompany.employees.map(emp => emp.name);
    }
    targetMembers.sort((a, b) => a.localeCompare(b, 'ja'));

    if (targetMembers.length === 0) {
        const trEmpty = document.createElement('tr');
        const tdEmpty = document.createElement('td');
        tdEmpty.colSpan = daysInMonth + 3;
        tdEmpty.textContent = "社員が登録されていません。";
        tdEmpty.style.padding = "20px";
        tdEmpty.style.color = "var(--text-muted)";
        trEmpty.appendChild(tdEmpty);
        tbody.appendChild(trEmpty);
        return;
    }

    targetMembers.forEach(memberName => {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        tdName.className = "sticky-col";
        tdName.textContent = memberName;
        tr.appendChild(tdName);

        let employeeTotalHours = 0;
        let employeeTotalDays = 0;

        const employeeRecords = recordsMap[memberName] || {};

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${filterMonth}-${String(d).padStart(2, '0')}`;
            const tdDay = document.createElement('td');
            
            const hours = employeeRecords[dateStr];
            if (hours !== undefined && hours > 0) {
                tdDay.textContent = hours.toFixed(1);
                employeeTotalHours += hours;
                employeeTotalDays++;
            } else if (hours === 0) {
                tdDay.textContent = "0.0";
                employeeTotalDays++;
            } else {
                tdDay.textContent = "";
            }

            const dateObj = new Date(year, month - 1, d);
            const dayOfWeek = dateObj.getDay();
            if (dayOfWeek === 6) tdDay.className = "weekend-sat";
            if (dayOfWeek === 0) tdDay.className = "weekend-sun";

            tr.appendChild(tdDay);
        }

        const tdDays = document.createElement('td');
        tdDays.className = "total-col";
        tdDays.textContent = `${employeeTotalDays}日`;
        tr.appendChild(tdDays);

        const tdHours = document.createElement('td');
        tdHours.className = "total-col";
        tdHours.textContent = `${employeeTotalHours.toFixed(1)}h`;
        tr.appendChild(tdHours);

        tbody.appendChild(tr);
    });
}

// カレンダー印刷処理
function printAttendanceCalendar() {
    const monthSelect = document.getElementById('attend-admin-filter-month');
    const filterMonth = monthSelect ? monthSelect.value : "";
    let title = "出退勤月間集計表";
    if (filterMonth) {
        const parts = filterMonth.split('-');
        title += ` (${parts[0]}年${parts[1]}月)`;
    }
    // システム共通印刷ヘルパー doPrint を実行
    doPrint('attend-admin-calendar-container', title, 'A4 landscape');
}

// Excelエクスポート処理
function exportAttendanceCalendarToExcel() {
    if (typeof ExcelJS === 'undefined') {
        alert('ExcelJSライブラリの読み込みに失敗しました。');
        return;
    }
    if (!allAttendanceRecords || allAttendanceRecords.length === 0) {
        alert("出力するデータがありません。");
        return;
    }

    const monthSelect = document.getElementById('attend-admin-filter-month');
    if (!monthSelect) return;
    const filterMonth = monthSelect.value;
    const parts = filterMonth.split('-');
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const daysInMonth = new Date(year, month, 0).getDate();

    // 1. ワークブックとワークシートの初期化
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("出退勤月間集計");

    // A4横、1ページ幅にフィット、枠線表示設定を追加
    worksheet.pageSetup = {
        orientation: 'landscape',
        paperSize: 9, // A4
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0
    };
    worksheet.views = [{ showGridLines: true }];

    // 2. タイトル行 (A1)
    worksheet.mergeCells(1, 1, 1, daysInMonth + 3);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = `出退勤月間集計表 (${year}年${month}月)`;
    titleCell.font = { name: 'MS Gothic', size: 14, bold: true };
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 30;

    // 3. ヘッダー行1 (日付)
    const headerRow1 = worksheet.getRow(3);
    headerRow1.height = 20;
    
    const cellName = headerRow1.getCell(1);
    cellName.value = "社員名";
    
    for (let d = 1; d <= daysInMonth; d++) {
        headerRow1.getCell(d + 1).value = d;
    }
    headerRow1.getCell(daysInMonth + 2).value = "出勤日数";
    headerRow1.getCell(daysInMonth + 3).value = "合計時間";

    // 4. ヘッダー行2 (曜日)
    const headerRow2 = worksheet.getRow(4);
    headerRow2.height = 20;
    const daysOfWeek = ['日', '月', '火', '水', '木', '金', '土'];
    
    for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, month - 1, d);
        headerRow2.getCell(d + 1).value = daysOfWeek[dateObj.getDay()];
    }

    // セルの縦結合 (社員名、出勤日数、合計時間)
    worksheet.mergeCells(3, 1, 4, 1);
    worksheet.mergeCells(3, daysInMonth + 2, 4, daysInMonth + 2);
    worksheet.mergeCells(3, daysInMonth + 3, 4, daysInMonth + 3);

    // 5. 社員データの書き込み
    const recordsMap = {};
    allAttendanceRecords.forEach(rec => {
        if (!recordsMap[rec.memberName]) {
            recordsMap[rec.memberName] = {};
        }
        let workingHours = 0;
        if (rec.checkIn && rec.checkOut) {
            const inParts = rec.checkIn.split(':');
            const outParts = rec.checkOut.split(':');
            const inMin = parseInt(inParts[0], 10) * 60 + parseInt(inParts[1], 10);
            const outMin = parseInt(outParts[0], 10) * 60 + parseInt(outParts[1], 10);
            const diffMin = outMin - inMin;
            if (diffMin > 0) workingHours = diffMin / 60;
        }
        recordsMap[rec.memberName][rec.date] = workingHours;
    });

    const filterMember = document.getElementById('attend-admin-filter-member').value;
    let targetMembers = [];
    if (filterMember) {
        targetMembers.push(filterMember);
    } else if (currentCompany && currentCompany.employees) {
        targetMembers = currentCompany.employees.map(emp => emp.name);
    }
    targetMembers.sort((a, b) => a.localeCompare(b, 'ja'));

    let currentRow = 5;
    targetMembers.forEach(memberName => {
        const row = worksheet.getRow(currentRow);
        row.height = 22;

        row.getCell(1).value = memberName;
        let employeeTotalHours = 0;
        let employeeTotalDays = 0;
        const employeeRecords = recordsMap[memberName] || {};

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${filterMonth}-${String(d).padStart(2, '0')}`;
            const hours = employeeRecords[dateStr];
            if (hours !== undefined && hours >= 0) {
                row.getCell(d + 1).value = parseFloat(hours.toFixed(1));
                employeeTotalHours += hours;
                employeeTotalDays++;
            } else {
                row.getCell(d + 1).value = '';
            }
        }
        const startColLetter = "B";
        const endColLetter = getExcelColumnLetter(daysInMonth + 1);
        row.getCell(daysInMonth + 2).value = {
            formula: `=COUNT(${startColLetter}${currentRow}:${endColLetter}${currentRow})`,
            result: employeeTotalDays
        };
        row.getCell(daysInMonth + 3).value = {
            formula: `=SUM(${startColLetter}${currentRow}:${endColLetter}${currentRow})`,
            result: parseFloat(employeeTotalHours.toFixed(1))
        };

        currentRow++;
    });

    // 6. スタイル・枠線・色の適用
    const borderDef = {
        top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
    
    const headerBorderDef = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    const headerFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3B82F6' }
    };

    const headerTextFont = { name: 'MS Gothic', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const normalTextFont = { name: 'MS Gothic', size: 10 };
    const boldTextFont = { name: 'MS Gothic', size: 10, bold: true };

    for (let r = 3; r <= 4; r++) {
        const row = worksheet.getRow(r);
        for (let c = 1; c <= daysInMonth + 3; c++) {
            const cell = row.getCell(c);
            
            cell.font = headerTextFont;
            cell.fill = headerFill;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = headerBorderDef;

            if (r === 4 && c > 1 && c <= daysInMonth + 1) {
                const dateObj = new Date(year, month - 1, c - 1);
                const dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 6) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
                    cell.font = { name: 'MS Gothic', size: 10, bold: true, color: { argb: 'FF2563EB' } };
                } else if (dayOfWeek === 0) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                    cell.font = { name: 'MS Gothic', size: 10, bold: true, color: { argb: 'FFEF4444' } };
                }
            }
        }
    }

    for (let r = 5; r < currentRow; r++) {
        const row = worksheet.getRow(r);
        for (let c = 1; c <= daysInMonth + 3; c++) {
            const cell = row.getCell(c);
            
            cell.font = normalTextFont;
            cell.border = borderDef;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };

            if (c === 1) {
                cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
                cell.font = boldTextFont;
            }
            
            if (c > 1 && c <= daysInMonth + 1) {
                const dateObj = new Date(year, month - 1, c - 1);
                const dayOfWeek = dateObj.getDay();
                if (dayOfWeek === 6) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FF' } };
                } else if (dayOfWeek === 0) {
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF5F5' } };
                }
            }

            if (c === daysInMonth + 2 || c === daysInMonth + 3) {
                cell.font = boldTextFont;
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
            }
        }
    }

    worksheet.getColumn(1).width = 16;
    for (let c = 2; c <= daysInMonth + 1; c++) {
        worksheet.getColumn(c).width = 4.5;
    }
    worksheet.getColumn(daysInMonth + 2).width = 10;
    worksheet.getColumn(daysInMonth + 3).width = 12;

    workbook.xlsx.writeBuffer().then(buffer => {
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `出退勤月間集計_${filterMonth}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
    }).catch(err => {
        console.error("Excel書き込みエラー:", err);
        alert("Excelファイルの生成に失敗しました。");
    });
}

window.renderAttendanceCalendar = renderAttendanceCalendar;
window.printAttendanceCalendar = printAttendanceCalendar;
window.exportAttendanceCalendarToExcel = exportAttendanceCalendarToExcel;

// Excelのインデックス(1-based)を列名(A, B... Z, AA, AB...)に変換するヘルパー
function getExcelColumnLetter(colIndex) {
    let letter = "";
    let temp = colIndex;
    while (temp > 0) {
        let modulo = (temp - 1) % 26;
        letter = String.fromCharCode(65 + modulo) + letter;
        temp = Math.floor((temp - modulo) / 26);
    }
    return letter;
}



// ============================================================
// 💲 原価管理・月次収支機能 関連ロジック
// ============================================================

// 日本の祝日名取得
function getJapaneseHolidayName(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const w = date.getDay();

    if (month === 1 && day === 1) return "元日";
    if (month === 2 && day === 11) return "建国記念の日";
    if (month === 2 && day === 23 && year >= 2020) return "天皇誕生日";
    if (month === 4 && day === 29) return "昭和の日";
    if (month === 5 && day === 3) return "憲法記念日";
    if (month === 5 && day === 4) return "みどりの日";
    if (month === 5 && day === 5) return "こどもの日";
    if (month === 8 && day === 11 && year >= 2016) return "山の日";
    if (month === 11 && day === 3) return "文化の日";
    if (month === 11 && day === 23) return "勤労感謝の日";

    if (month === 1 && w === 1 && Math.floor((day - 1) / 7) === 1) return "成人の日";
    if (month === 7 && w === 1 && Math.floor((day - 1) / 7) === 2) return "海の日";
    if (month === 9 && w === 1 && Math.floor((day - 1) / 7) === 2) return "敬老の日";
    if (month === 10 && w === 1 && Math.floor((day - 1) / 7) === 1) return "スポーツの日";

    if (month === 3) {
        const equinoxDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        if (day === equinoxDay) return "春分の日";
    }
    if (month === 9) {
        const equinoxDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
        if (day === equinoxDay) return "秋分の日";
    }
    return null;
}

// 日本の祝日判定（振替休日・国民の休日含む）
function isJapaneseHoliday(date) {
    if (getJapaneseHolidayName(date)) return true;

    const w = date.getDay();
    if (w !== 0) {
        let checkDate = new Date(date.getTime());
        let isFurikae = false;
        while (true) {
            checkDate.setDate(checkDate.getDate() - 1);
            const checkW = checkDate.getDay();
            const hasHoliday = !!getJapaneseHolidayName(checkDate);
            
            if (hasHoliday && checkW === 0) {
                isFurikae = true;
                break;
            }
            if (!hasHoliday) break;
        }
        if (isFurikae) return true;
    }

    const prevDate = new Date(date.getTime());
    prevDate.setDate(prevDate.getDate() - 1);
    const nextDate = new Date(date.getTime());
    nextDate.setDate(nextDate.getDate() + 1);

    if (getJapaneseHolidayName(prevDate) && getJapaneseHolidayName(nextDate) && w !== 0 && w !== 6) {
        return true;
    }
    return false;
}

// 月の実稼働日数（土日祝を除く）を計算
function getWorkingDaysInMonth(year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    let count = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const w = d.getDay();
        if (w === 0 || w === 6) continue;
        if (isJapaneseHoliday(d)) continue;
        count++;
    }
    return count;
}

// 年月形式（YYYY-MM）から year, month をパース
function parseYearMonth(ymStr) {
    const parts = ymStr.split('-');
    return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10)
    };
}

// 対象年月の社員別・工事別労務費の自動計算
async function calculateMonthlyLaborCosts(yearMonthStr) {
    const { year, month } = parseYearMonth(yearMonthStr);
    const workingDays = getWorkingDaysInMonth(year, month);
    
    if (workingDays === 0) {
        return {
            workingDaysInMonth: 0,
            projectCosts: {},
            laborDetail: {}
        };
    }

    const employees = currentCompany.employees || [];
    const monthlySalaryEmployees = employees.filter(emp => emp.monthlySalary && emp.monthlySalary > 0);
    
    if (monthlySalaryEmployees.length === 0) {
        return {
            workingDaysInMonth: workingDays,
            projectCosts: {},
            laborDetail: {}
        };
    }

    const employeeRates = {};
    monthlySalaryEmployees.forEach(emp => {
        employeeRates[emp.name] = {
            name: emp.name,
            monthlySalary: emp.monthlySalary,
            dailyRate: emp.monthlySalary / workingDays
        };
    });

    const reportsRef = collection(db, "reports");
    const q = query(reportsRef, where("companyId", "==", currentCompany.companyId));
    const querySnapshot = await getDocs(q);
    
    const dailyWorkHours = {};
    const dailyTotalHours = {};
    const paidLeavesCount = {};

    querySnapshot.forEach(docSnap => {
        const r = docSnap.data();
        if (!r.week || !r.author) return;
        
        const rateInfo = employeeRates[r.author];
        if (!rateInfo) return;

        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const dates = getDaysOfWeek(r.week);
        if (!dates) return;

        days.forEach((day, idx) => {
            const dateObj = dates[idx];
            const dYear = dateObj.getFullYear();
            const dMonth = dateObj.getMonth() + 1;
            
            if (dYear === year && dMonth === month) {
                const dateStr = dateObj.toISOString().split('T')[0];
                const dayLog = r.dailyLogs ? r.dailyLogs[day] : null;
                const tasks = normalizeDailyTasks(dayLog);

                let dayTotal = 0;
                const dayProjects = {};
                let isLeave = false;

                tasks.forEach(t => {
                    const proj = t.project || '';
                    if (!proj) return;

                    if (proj === '有給' || proj === '有休' || (dayLog && dayLog.leaveType === '有給')) {
                        isLeave = true;
                        return;
                    }

                    if (['欠勤', '休日'].includes(proj) || (dayLog && ['欠勤', '休日'].includes(dayLog.leaveType))) {
                        return;
                    }

                    let hrs = 0;
                    if (t.timeline) {
                        hrs = t.timeline.split('').filter(s => s === '1' || s === '3' || s === '5').length * 0.5;
                    } else {
                        hrs = parseFloat(t.hours || 0);
                    }

                    if (hrs > 0) {
                        dayProjects[proj] = (dayProjects[proj] || 0) + hrs;
                        dayTotal += hrs;
                    }
                });

                if (isLeave) {
                    paidLeavesCount[r.author] = (paidLeavesCount[r.author] || 0) + 1;
                }

                if (dayTotal > 0) {
                    if (!dailyWorkHours[r.author]) dailyWorkHours[r.author] = {};
                    if (!dailyTotalHours[r.author]) dailyTotalHours[r.author] = {};
                    
                    dailyWorkHours[r.author][dateStr] = dayProjects;
                    dailyTotalHours[r.author][dateStr] = dayTotal;
                }
            }
        });
    });

    const projectCosts = {};
    const laborDetail = {};

    for (const empName in employeeRates) {
        const rateInfo = employeeRates[empName];
        const empWork = dailyWorkHours[empName] || {};
        const empTotals = dailyTotalHours[empName] || {};
        
        for (const dateStr in empWork) {
            const projects = empWork[dateStr];
            const dayTotal = empTotals[dateStr];
            
            if (dayTotal > 0) {
                for (const proj in projects) {
                    const hrs = projects[proj];
                    const cost = rateInfo.dailyRate * (hrs / dayTotal);
                    
                    projectCosts[proj] = (projectCosts[proj] || 0) + cost;
                    
                    if (!laborDetail[proj]) laborDetail[proj] = [];
                    let detailObj = laborDetail[proj].find(d => d.employeeName === empName);
                    if (!detailObj) {
                        detailObj = {
                            employeeName: empName,
                            workDays: 0,
                            laborCost: 0
                        };
                        laborDetail[proj].push(detailObj);
                    }
                    detailObj.laborCost += cost;
                    detailObj.workDays += (hrs / dayTotal);
                }
            }
        }
    }

    for (const proj in projectCosts) {
        projectCosts[proj] = Math.round(projectCosts[proj]);
    }
    for (const proj in laborDetail) {
        laborDetail[proj].forEach(d => {
            d.laborCost = Math.round(d.laborCost);
            d.workDays = Math.round(d.workDays * 10) / 10;
        });
    }

    return {
        workingDaysInMonth: workingDays,
        projectCosts,
        laborDetail
    };
}

// 原価管理・月次収支画面の初期化
function initCostManagePanel() {
    const tabCostHidden = document.getElementById('tab-cost-hidden');
    if (!tabCostHidden) return;

    let companyVendors = [];

    const btnTabForm = document.getElementById('btn-cost-tab-form');
    const btnTabList = document.getElementById('btn-cost-tab-list');
    const btnTabSummary = document.getElementById('btn-cost-tab-summary');

    const sectionForm = document.getElementById('cost-section-form');
    const sectionList = document.getElementById('cost-section-list');
    const sectionSummary = document.getElementById('cost-section-summary');

    const switchSubTab = (activeBtn, activeSection) => {
        [btnTabForm, btnTabList, btnTabSummary].forEach(btn => {
            if (btn) {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-main)';
            }
        });
        [sectionForm, sectionList, sectionSummary].forEach(sec => {
            if (sec) sec.style.display = 'none';
        });

        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.style.background = 'var(--primary)';
            activeBtn.style.color = 'white';
        }
        if (activeSection) activeSection.style.display = 'block';
    };

    if (btnTabForm) {
        btnTabForm.addEventListener('click', () => {
            switchSubTab(btnTabForm, sectionForm);
            loadCostInputFormDependencies();
        });
    }
    if (btnTabList) {
        btnTabList.addEventListener('click', () => {
            switchSubTab(btnTabList, sectionList);
            loadCostList();
        });
    }
    if (btnTabSummary) {
        btnTabSummary.addEventListener('click', () => {
            switchSubTab(btnTabSummary, sectionSummary);
            initCostSummaryFilters().then(() => loadCostSummary());
        });
    }

    const costProjectSelect = document.getElementById('cost-project-select');
    const costYearMonth = document.getElementById('cost-year-month');
    const costLaborCost = document.getElementById('cost-labor-cost');
    const costLaborDetailArea = document.getElementById('cost-labor-detail-area');
    const costLaborDetailList = document.getElementById('cost-labor-detail-list');

    const loadCostInputFormDependencies = async () => {
        if (!currentCompany) return;

        const schedulesRef = collection(db, "schedules");
        const q = query(schedulesRef, where("companyId", "==", currentCompany.companyId));
        const querySnapshot = await getDocs(q);
        
        costProjectSelect.innerHTML = '<option value="">工事を選択してください</option>';
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const opt = document.createElement('option');
            opt.value = docSnap.id;
            opt.textContent = `${data.project} (${data.projectNumber || '番号なし'})`;
            costProjectSelect.appendChild(opt);
        });

        // 外注先リストを Firestore から取得
        try {
            const vendorsRef = collection(db, "companies", currentCompany.companyId, "vendors");
            const vendorsSnap = await getDocs(vendorsRef);
            companyVendors = [];
            vendorsSnap.forEach(docSnap => {
                const data = docSnap.data();
                companyVendors.push({
                    id: docSnap.id,
                    name: data.name
                });
            });
        } catch (err) {
            console.error("Error loading vendors for cost input dependency:", err);
        }

        if (!costYearMonth.value) {
            const now = new Date();
            costYearMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }

        costProjectSelect.onchange = () => loadExistingCostRecord();
        costYearMonth.onchange = () => loadExistingCostRecord();
    };

    const costDetailsTbody = document.getElementById('cost-details-tbody');
    const btnCostAddDetail = document.getElementById('btn-cost-add-detail');
    const costBillingAmount = document.getElementById('cost-billing-amount');
    const costTotalDisplay = document.getElementById('cost-total-display');
    const costProfitDisplay = document.getElementById('cost-profit-display');
    const costProfitRateDisplay = document.getElementById('cost-profit-rate-display');

    const addCostDetailRow = (data = null) => {
        if (!costDetailsTbody) return;

        const tr = document.createElement('tr');
        tr.className = 'cost-detail-row';
        tr.style.borderBottom = '1px solid var(--border)';

        tr.innerHTML = `
            <td style="padding: 8px; border: 1px solid var(--border);">
                <select class="detail-category" required style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 4px; background: var(--card-bg); color: var(--text);">
                    <option value="material">材料費</option>
                    <option value="subcontract">外注費</option>
                    <option value="expense">経費</option>
                </select>
            </td>
            <td style="padding: 8px; border: 1px solid var(--border);" class="supplier-cell-container">
                <input type="text" class="detail-supplier" placeholder="例: ○○商事" style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 8px; background: var(--card-bg); color: var(--text);">
            </td>
            <td style="padding: 8px; border: 1px solid var(--border);">
                <input type="text" class="detail-content" placeholder="例: 鋼材一式" style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 8px; background: var(--card-bg); color: var(--text);">
            </td>
            <td style="padding: 8px; border: 1px solid var(--border);">
                <input type="number" class="detail-amount" required placeholder="0" min="0" style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 8px; text-align: right; background: var(--card-bg); color: var(--text);">
            </td>
            <td style="padding: 8px; border: 1px solid var(--border);">
                <input type="date" class="detail-date" style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 4px; background: var(--card-bg); color: var(--text);">
            </td>
            <td style="padding: 8px; border: 1px solid var(--border); text-align: center;">
                <button type="button" class="btn-detail-delete" style="background: none; border: none; color: #ef4444; font-size: 1.2rem; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; justify-content: center;" title="削除">🗑️</button>
            </td>
        `;

        const categorySelect = tr.querySelector('.detail-category');
        const contentInput = tr.querySelector('.detail-content');
        const amountInput = tr.querySelector('.detail-amount');
        const dateInput = tr.querySelector('.detail-date');
        const deleteBtn = tr.querySelector('.btn-detail-delete');

        const updateSupplierInput = (category, existingVal = '') => {
            const container = tr.querySelector('.supplier-cell-container');
            if (!container) return;

            if (category === 'subcontract') {
                let optionsHtml = '<option value="">外注先を選択してください</option>';
                companyVendors.forEach(vendor => {
                    optionsHtml += `<option value="${vendor.name}">${vendor.name}</option>`;
                });
                container.innerHTML = `
                    <select class="detail-supplier" required style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 4px; background: var(--card-bg); color: var(--text);">
                        ${optionsHtml}
                    </select>
                `;
            } else {
                container.innerHTML = `
                    <input type="text" class="detail-supplier" placeholder="例: ○○商事" style="width: 100%; height: 36px; border-radius: 4px; border: 1px solid var(--border); padding: 0 8px; background: var(--card-bg); color: var(--text);">
                `;
            }

            const supplierInput = container.querySelector('.detail-supplier');
            if (supplierInput && existingVal) {
                supplierInput.value = existingVal;
            }
        };

        if (data) {
            categorySelect.value = data.category || 'material';
            updateSupplierInput(categorySelect.value, data.supplier || '');
            contentInput.value = data.content || '';
            amountInput.value = data.amount || '';
            dateInput.value = data.date || '';
        } else {
            updateSupplierInput(categorySelect.value);
        }

        categorySelect.addEventListener('change', () => {
            updateSupplierInput(categorySelect.value);
            calculateAndDisplayCostSummary();
        });

        [categorySelect, amountInput].forEach(elem => {
            elem.addEventListener('change', () => calculateAndDisplayCostSummary());
        });
        amountInput.addEventListener('input', () => calculateAndDisplayCostSummary());

        deleteBtn.addEventListener('click', () => {
            tr.remove();
            calculateAndDisplayCostSummary();
        });

        costDetailsTbody.appendChild(tr);
    };

    if (btnCostAddDetail) {
        btnCostAddDetail.onclick = () => {
            addCostDetailRow();
            calculateAndDisplayCostSummary();
        };
    }
    if (costBillingAmount) {
        costBillingAmount.oninput = () => {
            calculateAndDisplayCostSummary();
        };
    }

    const calculateAndDisplayCostSummary = () => {
        let materialSum = 0;
        let subcontractSum = 0;
        let expenseSum = 0;

        if (costDetailsTbody) {
            const rows = costDetailsTbody.querySelectorAll('.cost-detail-row');
            rows.forEach(row => {
                const category = row.querySelector('.detail-category').value;
                const val = parseInt(row.querySelector('.detail-amount').value, 10) || 0;
                if (category === 'material') {
                    materialSum += val;
                } else if (category === 'subcontract') {
                    subcontractSum += val;
                } else if (category === 'expense') {
                    expenseSum += val;
                }
            });
        }

        const materialInput = document.getElementById('cost-material-cost');
        const subcontractInput = document.getElementById('cost-subcontract-cost');
        const expenseInput = document.getElementById('cost-expense-cost');

        if (materialInput) materialInput.value = materialSum.toLocaleString();
        if (subcontractInput) subcontractInput.value = subcontractSum.toLocaleString();
        if (expenseInput) expenseInput.value = expenseSum.toLocaleString();

        const billingAmount = parseInt(costBillingAmount.value, 10) || 0;
        const laborCostVal = parseInt(costLaborCost.dataset.value || 0, 10);
        const totalCost = materialSum + subcontractSum + expenseSum + laborCostVal;
        const profit = billingAmount - totalCost;
        let profitRate = 0;
        if (billingAmount > 0) {
            profitRate = (profit / billingAmount) * 100;
        }

        if (costTotalDisplay) costTotalDisplay.textContent = `¥${totalCost.toLocaleString()}`;
        if (costProfitDisplay) {
            costProfitDisplay.textContent = `¥${profit.toLocaleString()}`;
            if (profit < 0) {
                costProfitDisplay.style.color = '#ef4444';
            } else {
                costProfitDisplay.style.color = '#16a34a';
            }
        }
        if (costProfitRateDisplay) {
            costProfitRateDisplay.textContent = `${profitRate.toFixed(1)}%`;
            if (profitRate < 0) {
                costProfitRateDisplay.style.color = '#ef4444';
            } else {
                costProfitRateDisplay.style.color = '#2563eb';
            }
        }
    };

    const loadExistingCostRecord = async () => {
        const workId = costProjectSelect.value;
        const ymStr = costYearMonth.value;
        if (!workId || !ymStr || !currentCompany) {
            resetCostInputFields(true);
            return;
        }

        const yyyymm = ymStr.replace('-', '');
        costLaborCost.value = "計算中...";
        costLaborDetailArea.style.display = 'none';

        try {
            const laborResults = await calculateMonthlyLaborCosts(ymStr);
            const projectCosts = laborResults.projectCosts || {};
            const laborDetail = laborResults.laborDetail || {};

            const optText = costProjectSelect.options[costProjectSelect.selectedIndex].textContent;
            const projectName = optText.split(' (')[0];

            let calculatedLaborCost = 0;
            let detailList = [];

            if (projectCosts[projectName]) {
                calculatedLaborCost = projectCosts[projectName];
                detailList = laborDetail[projectName] || [];
            }

            costLaborCost.value = calculatedLaborCost.toLocaleString();
            costLaborCost.dataset.value = calculatedLaborCost;

            if (detailList.length > 0) {
                costLaborDetailList.innerHTML = detailList.map(d => `
                    <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px dashed var(--border);">
                        <span>👤 ${d.employeeName} (実作業: ${d.workDays}日)</span>
                        <strong>¥${d.laborCost.toLocaleString()}</strong>
                    </div>
                `).join('');
                costLaborDetailArea.style.display = 'block';
            } else {
                costLaborDetailList.innerHTML = '<p style="color:var(--text-muted);margin:0;font-size:0.8rem;">月給制社員の従事実績はありませんでした。</p>';
                costLaborDetailArea.style.display = 'block';
            }

            const docRef = doc(db, "companies", currentCompany.companyId, "costRecords", `${workId}_${yyyymm}`);
            const docSnap = await getDoc(docRef);

            if (costDetailsTbody) costDetailsTbody.innerHTML = '';

            if (docSnap.exists()) {
                const data = docSnap.data();
                document.getElementById('cost-billing-amount').value = data.revenue?.billingAmount || '';
                document.getElementById('cost-billing-date').value = data.revenue?.billingDate || '';
                document.getElementById('cost-payment-amount').value = data.revenue?.paymentAmount || '';
                document.getElementById('cost-payment-date').value = data.revenue?.paymentDate || '';
                document.getElementById('cost-memo').value = data.memo || '';

                const costDetails = data.costDetails || [];
                if (costDetails.length > 0) {
                    costDetails.forEach(d => addCostDetailRow(d));
                } else {
                    let hasOldData = false;
                    if (data.cost?.materialCost) {
                        addCostDetailRow({ category: 'material', supplier: '（移行データ）', content: '材料費一括', amount: data.cost.materialCost, date: '' });
                        hasOldData = true;
                    }
                    if (data.cost?.subcontractCost) {
                        addCostDetailRow({ category: 'subcontract', supplier: '（移行データ）', content: '外注費一括', amount: data.cost.subcontractCost, date: '' });
                        hasOldData = true;
                    }
                    if (data.cost?.expenseCost) {
                        addCostDetailRow({ category: 'expense', supplier: '（移行データ）', content: '経費一括', amount: data.cost.expenseCost, date: '' });
                        hasOldData = true;
                    }
                    if (!hasOldData) {
                        addCostDetailRow();
                    }
                }
            } else {
                resetCostInputFields(false);
            }

            calculateAndDisplayCostSummary();
        } catch (err) {
            console.error("Error loading cost record:", err);
            costLaborCost.value = "計算エラー";
        }
    };

    const resetCostInputFields = (clearLabor = false) => {
        document.getElementById('cost-billing-amount').value = '';
        document.getElementById('cost-billing-date').value = '';
        document.getElementById('cost-payment-amount').value = '';
        document.getElementById('cost-payment-date').value = '';
        document.getElementById('cost-memo').value = '';
        if (costDetailsTbody) {
            costDetailsTbody.innerHTML = '';
        }
        addCostDetailRow();

        if (clearLabor) {
            costLaborCost.value = '0';
            costLaborCost.dataset.value = 0;
            costLaborDetailArea.style.display = 'none';
        }

        calculateAndDisplayCostSummary();
    };

    const costInputForm = document.getElementById('cost-input-form');
    const costSaveMsg = document.getElementById('cost-save-message');
    if (costInputForm) {
        costInputForm.onsubmit = async (e) => {
            e.preventDefault();
            const workId = costProjectSelect.value;
            const ymStr = costYearMonth.value;
            if (!workId || !ymStr || !currentCompany) return;

            const yyyymm = ymStr.replace('-', '');
            const optText = costProjectSelect.options[costProjectSelect.selectedIndex].textContent;
            const workName = optText.split(' (')[0];

            costSaveMsg.className = 'message';
            costSaveMsg.textContent = '保存中...';
            costSaveMsg.classList.remove('hidden');

            const billingAmount = document.getElementById('cost-billing-amount').value ? parseInt(document.getElementById('cost-billing-amount').value, 10) : 0;
            const billingDate = document.getElementById('cost-billing-date').value;
            const paymentAmount = document.getElementById('cost-payment-amount').value ? parseInt(document.getElementById('cost-payment-amount').value, 10) : 0;
            const paymentDate = document.getElementById('cost-payment-date').value;

            const costDetails = [];
            let materialCost = 0;
            let subcontractCost = 0;
            let expenseCost = 0;

            if (costDetailsTbody) {
                const rows = costDetailsTbody.querySelectorAll('.cost-detail-row');
                rows.forEach(row => {
                    const category = row.querySelector('.detail-category').value;
                    const supplier = row.querySelector('.detail-supplier').value.trim();
                    const content = row.querySelector('.detail-content').value.trim();
                    const amount = parseInt(row.querySelector('.detail-amount').value, 10) || 0;
                    const date = row.querySelector('.detail-date').value;

                    costDetails.push({
                        category,
                        supplier,
                        content,
                        amount,
                        date
                    });

                    if (category === 'material') {
                        materialCost += amount;
                    } else if (category === 'subcontract') {
                        subcontractCost += amount;
                    } else if (category === 'expense') {
                        expenseCost += amount;
                    }
                });
            }

            const laborCost = parseInt(costLaborCost.dataset.value || 0, 10);
            const memo = document.getElementById('cost-memo').value.trim();

            const laborResults = await calculateMonthlyLaborCosts(ymStr);
            const detailList = laborResults.laborDetail[workName] || [];

            const docRef = doc(db, "companies", currentCompany.companyId, "costRecords", `${workId}_${yyyymm}`);
            
            const costRecord = {
                workId,
                workName,
                yearMonth: yyyymm,
                revenue: {
                    billingAmount,
                    billingDate,
                    paymentAmount,
                    paymentDate
                },
                cost: {
                    materialCost,
                    subcontractCost,
                    expenseCost,
                    laborCost
                },
                costDetails,
                laborCostDetail: detailList.map(d => ({
                    employeeName: d.employeeName,
                    laborCost: d.laborCost,
                    workDays: d.workDays
                })),
                workingDaysInMonth: laborResults.workingDaysInMonth,
                memo,
                updatedBy: currentUser.displayName || currentUser.email.split('@')[0],
                updatedAt: new Date().toISOString()
            };

            try {
                await setDoc(docRef, costRecord, { merge: true });
                costSaveMsg.className = 'message success';
                costSaveMsg.textContent = '原価情報を保存しました！';
                setTimeout(() => costSaveMsg.classList.add('hidden'), 3000);
            } catch (err) {
                console.error("Error saving cost record:", err);
                costSaveMsg.className = 'message error';
                costSaveMsg.textContent = `保存に失敗しました: ${err.message}`;
            }
        };
    }

    const costListTbody = document.getElementById('cost-list-tbody');
    const loadCostList = async () => {
        if (!currentCompany || !costListTbody) return;
        costListTbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">データを読込み中...</td></tr>';

        try {
            const costRecordsRef = collection(db, "companies", currentCompany.companyId, "costRecords");
            const querySnapshot = await getDocs(costRecordsRef);

            const projectSummary = {};

            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                const workId = data.workId;
                if (!workId) return;

                if (!projectSummary[workId]) {
                    projectSummary[workId] = {
                        workName: data.workName || '不明な工事',
                        billingAmount: 0,
                        material: 0,
                        subcontract: 0,
                        expense: 0,
                        labor: 0
                    };
                }

                const s = projectSummary[workId];
                s.billingAmount += data.revenue?.billingAmount || 0;
                s.material += data.cost?.materialCost || 0;
                s.subcontract += data.cost?.subcontractCost || 0;
                s.expense += data.cost?.expenseCost || 0;
                s.labor += data.cost?.laborCost || 0;
            });

            const keys = Object.keys(projectSummary);
            if (keys.length === 0) {
                costListTbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-muted);">登録されている原価データがありません。</td></tr>';
                return;
            }

            costListTbody.innerHTML = keys.map(workId => {
                const s = projectSummary[workId];
                const costTotal = s.material + s.subcontract + s.expense + s.labor;
                const profit = s.billingAmount - costTotal;
                const profitRate = s.billingAmount > 0 ? (profit / s.billingAmount) * 100 : 0;
                
                const isLoss = profit < 0;
                const profitClass = isLoss ? 'text-danger' : '';
                const profitRateText = s.billingAmount > 0 ? `${profitRate.toFixed(1)}%` : '-';

                return `
                    <tr style="border-bottom: 1px solid var(--border);">
                        <td style="padding: 10px 12px; font-weight: bold; color: var(--text-main); text-align: left;">${s.workName}</td>
                        <td style="padding: 10px 12px; text-align: right;">¥${s.billingAmount.toLocaleString()}</td>
                        <td style="padding: 10px 12px; text-align: right;">¥${costTotal.toLocaleString()}</td>
                        <td style="padding: 10px 12px; text-align: right;" class="${profitClass}">¥${profit.toLocaleString()}</td>
                        <td style="padding: 10px 12px; text-align: center;" class="${profitClass}">${profitRateText}</td>
                        <td style="padding: 10px 12px; text-align: center;">
                            <button class="btn btn-secondary btn-small" onclick="viewCostDetailModal('${workId}')" style="padding: 2px 8px; font-size:0.75rem;">内訳</button>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (err) {
            console.error("Error loading cost list:", err);
            costListTbody.innerHTML = '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-danger);">データの読み込みに失敗しました。</td></tr>';
        }
    };

    const summaryMonthFilter = document.getElementById('cost-summary-month-filter');
    const initCostSummaryFilters = async () => {
        if (!currentCompany || !summaryMonthFilter) return;
        
        const costRecordsRef = collection(db, "companies", currentCompany.companyId, "costRecords");
        const querySnapshot = await getDocs(costRecordsRef);

        const monthsSet = new Set();
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.yearMonth) {
                const yyyymm = data.yearMonth;
                const ymStr = `${yyyymm.substring(0, 4)}-${yyyymm.substring(4, 6)}`;
                monthsSet.add(ymStr);
            }
        });

        const now = new Date();
        const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        monthsSet.add(currentYm);

        const sortedMonths = Array.from(monthsSet).sort().reverse();
        summaryMonthFilter.innerHTML = sortedMonths.map(ym => `<option value="${ym}">${ym.replace('-', '年')}分</option>`).join('');

        summaryMonthFilter.onchange = () => loadCostSummary();
    };

    const loadCostSummary = async () => {
        const ymStr = summaryMonthFilter.value;
        if (!ymStr || !currentCompany) return;

        const yyyymm = ymStr.replace('-', '');

        const totalBillingEl = document.getElementById('cost-summary-total-billing');
        const totalPaymentEl = document.getElementById('cost-summary-total-payment');
        const totalUnpaidEl = document.getElementById('cost-summary-total-unpaid');
        const totalProfitEl = document.getElementById('cost-summary-total-profit');

        const breakdownBillingEl = document.getElementById('cost-breakdown-billing');
        const breakdownPaymentEl = document.getElementById('cost-breakdown-payment');
        const breakdownUnpaidEl = document.getElementById('cost-breakdown-unpaid');
        const breakdownTotalCostEl = document.getElementById('cost-breakdown-total-cost');
        const breakdownMaterialEl = document.getElementById('cost-breakdown-material');
        const breakdownSubcontractEl = document.getElementById('cost-breakdown-subcontract');
        const breakdownExpenseEl = document.getElementById('cost-breakdown-expense');
        const breakdownLaborEl = document.getElementById('cost-breakdown-labor');
        const breakdownProfitEl = document.getElementById('cost-breakdown-profit');

        try {
            const costRecordsRef = collection(db, "companies", currentCompany.companyId, "costRecords");
            const q = query(costRecordsRef, where("yearMonth", "==", yyyymm));
            const querySnapshot = await getDocs(q);

            let billingSum = 0;
            let paymentSum = 0;
            let materialSum = 0;
            let subcontractSum = 0;
            let expenseSum = 0;
            let laborSum = 0;

            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                billingSum += data.revenue?.billingAmount || 0;
                paymentSum += data.revenue?.paymentAmount || 0;
                materialSum += data.cost?.materialCost || 0;
                subcontractSum += data.cost?.subcontractCost || 0;
                expenseSum += data.cost?.expenseCost || 0;
                laborSum += data.cost?.laborCost || 0;
            });

            const unpaidSum = billingSum - paymentSum;
            const costSum = materialSum + subcontractSum + expenseSum + laborSum;
            const profitSum = billingSum - costSum;
            const profitRate = billingSum > 0 ? (profitSum / billingSum) * 100 : 0;

            totalBillingEl.textContent = `¥${billingSum.toLocaleString()}`;
            totalPaymentEl.textContent = `¥${paymentSum.toLocaleString()}`;
            totalUnpaidEl.textContent = `¥${unpaidSum.toLocaleString()}`;
            
            const profitRateText = billingSum > 0 ? `${profitRate.toFixed(1)}%` : '0%';
            totalProfitEl.textContent = `¥${profitSum.toLocaleString()} (${profitRateText})`;

            const profitCard = document.getElementById('cost-summary-total-profit-card');
            if (profitCard) {
                if (profitSum < 0) {
                    profitCard.style.background = '#fef2f2';
                    profitCard.style.borderColor = '#fee2e2';
                    totalProfitEl.style.color = '#ef4444';
                } else {
                    profitCard.style.background = '#f0fdfa';
                    profitCard.style.borderColor = '#99f6e4';
                    totalProfitEl.style.color = '#0f766e';
                }
            }

            const unpaidCard = document.getElementById('cost-summary-total-unpaid-card');
            if (unpaidCard) {
                if (unpaidSum > 0) {
                    unpaidCard.style.background = '#fff7ed';
                    unpaidCard.style.borderColor = '#ffedd5';
                } else {
                    unpaidCard.style.background = '#f8fafc';
                    unpaidCard.style.borderColor = '#e2e8f0';
                }
            }

            breakdownBillingEl.textContent = `¥${billingSum.toLocaleString()}`;
            breakdownPaymentEl.textContent = `¥${paymentSum.toLocaleString()}`;
            breakdownUnpaidEl.textContent = `¥${unpaidSum.toLocaleString()}`;
            breakdownTotalCostEl.textContent = `¥${costSum.toLocaleString()}`;
            breakdownMaterialEl.textContent = `¥${materialSum.toLocaleString()}`;
            breakdownSubcontractEl.textContent = `¥${subcontractSum.toLocaleString()}`;
            breakdownExpenseEl.textContent = `¥${expenseSum.toLocaleString()}`;
            breakdownLaborEl.textContent = `¥${laborSum.toLocaleString()}`;
            
            const tableProfitClass = profitSum < 0 ? 'text-danger' : '';
            breakdownProfitEl.textContent = `¥${profitSum.toLocaleString()} (利益率: ${profitRateText})`;
            breakdownProfitEl.className = tableProfitClass;

        } catch (err) {
            console.error("Error loading cost summary:", err);
        }
    };

    tabCostHidden.addEventListener('click', () => {
        loadLatestCompanyInfo().then(() => {
            switchSubTab(btnTabForm, sectionForm);
            loadCostInputFormDependencies();
        });
    });
}

// 工事別の費用内訳詳細モーダル表示
async function viewCostDetailModal(workId) {
    let modal = document.getElementById('cost-detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'cost-detail-modal';
        modal.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:11000;padding:15px;box-sizing:border-box;";
        modal.innerHTML = `
            <div style="background:var(--card-bg);padding:25px;border-radius:12px;width:100%;max-width:550px;box-shadow:0 10px 25px rgba(0,0,0,0.2);color:var(--text-main);max-height:85vh;overflow-y:auto;display:flex;flex-direction:column;gap:15px;box-sizing:border-box;">
                <h3 id="cost-detail-modal-title" style="margin-top:0;margin-bottom:0;border-bottom:1px solid var(--border);padding-bottom:12px;font-size:1.2rem;color:var(--primary);">工事別原価内訳</h3>
                <div id="cost-detail-modal-body" style="display:flex;flex-direction:column;gap:15px;"></div>
                <div style="text-align:right;border-top:1px solid var(--border);padding-top:15px;margin-top:5px;">
                    <button class="btn btn-secondary" onclick="closeCostDetailModal()" style="background:#64748b;color:white;padding:8px 20px;border-radius:6px;border:none;font-weight:bold;cursor:pointer;">閉じる</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    const bodyEl = document.getElementById('cost-detail-modal-body');
    bodyEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);">内訳をロード中...</p>';
    modal.style.display = 'flex';

    try {
        const costRecordsRef = collection(db, "companies", currentCompany.companyId, "costRecords");
        const q = query(costRecordsRef, where("workId", "==", workId));
        const querySnapshot = await getDocs(q);

        let billingSum = 0;
        let materialSum = 0;
        let subcontractSum = 0;
        let expenseSum = 0;
        let laborSum = 0;
        let workName = '不明な工事';

        const monthlyBreakdown = [];

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            workName = data.workName || workName;

            const b = data.revenue?.billingAmount || 0;
            const m = data.cost?.materialCost || 0;
            const s = data.cost?.subcontractCost || 0;
            const e = data.cost?.expenseCost || 0;
            const l = data.cost?.laborCost || 0;
            const total = m + s + e + l;

            billingSum += b;
            materialSum += m;
            subcontractSum += s;
            expenseSum += e;
            laborSum += l;

            const yyyymm = data.yearMonth || '';
            const label = yyyymm ? `${yyyymm.substring(0, 4)}年${yyyymm.substring(4, 6)}月` : '不明';

            monthlyBreakdown.push({
                label,
                billing: b,
                material: m,
                subcontract: s,
                expense: e,
                labor: l,
                total
            });
        });

        document.getElementById('cost-detail-modal-title').textContent = `📊 内訳: ${workName}`;

        const totalCost = materialSum + subcontractSum + expenseSum + laborSum;
        const profit = billingSum - totalCost;
        const profitRate = billingSum > 0 ? (profit / billingSum) * 100 : 0;
        const profitClass = profit < 0 ? 'text-danger' : '';

        let html = `
            <div style="background:var(--bg-muted, #f1f5f9);padding:15px;border-radius:8px;font-size:0.9rem;">
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;"><span>総請求金額:</span><strong>¥${billingSum.toLocaleString()}</strong></div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;color:#b91c1c;"><span>総原価:</span><strong>¥${totalCost.toLocaleString()}</strong></div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;" class="${profitClass}"><span>総粗利:</span><strong>¥${profit.toLocaleString()}</strong></div>
                <div style="display:flex;justify-content:space-between;" class="${profitClass}"><span>総粗利益率:</span><strong>${billingSum > 0 ? profitRate.toFixed(1) + '%' : '0%'}</strong></div>
            </div>
            
            <h4 style="margin:10px 0 5px 0;font-size:0.95rem;border-left:3px solid var(--primary);padding-left:6px;">📅 月別原価詳細</h4>
            <div style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:220px;padding-right:5px;">
        `;

        if (monthlyBreakdown.length === 0) {
            html += '<p style="color:var(--text-muted);text-align:center;margin:10px 0;">月別の原価データがありません。</p>';
        } else {
            monthlyBreakdown.sort((a, b) => a.label.localeCompare(b.label));
            html += monthlyBreakdown.map(mb => `
                <div style="border:1px solid var(--border);padding:10px;border-radius:6px;background:var(--card-bg);font-size:0.82rem;line-height:1.4;">
                    <div style="font-weight:bold;color:var(--primary);margin-bottom:6px;border-bottom:1px solid var(--border);padding-bottom:3px;">${mb.label}分</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 15px;">
                        <div style="display:flex;justify-content:space-between;"><span>請求:</span><span>¥${mb.billing.toLocaleString()}</span></div>
                        <div style="display:flex;justify-content:space-between;"><span>原価計:</span><span style="font-weight:bold;color:#b91c1c;">¥${mb.total.toLocaleString()}</span></div>
                        <div style="display:flex;justify-content:space-between;color:var(--text-muted);padding-left:8px;"><span>└ 材料費:</span><span>¥${mb.material.toLocaleString()}</span></div>
                        <div style="display:flex;justify-content:space-between;color:var(--text-muted);padding-left:8px;"><span>└ 外注費:</span><span>¥${mb.subcontract.toLocaleString()}</span></div>
                        <div style="display:flex;justify-content:space-between;color:var(--text-muted);padding-left:8px;"><span>└ 経費:</span><span>¥${mb.expense.toLocaleString()}</span></div>
                        <div style="display:flex;justify-content:space-between;color:var(--text-muted);padding-left:8px;"><span>└ 労務費:</span><span>¥${mb.labor.toLocaleString()}</span></div>
                    </div>
                </div>
            `).join('');
        }

        html += '</div>';
        bodyEl.innerHTML = html;

    } catch (err) {
        console.error("Error loading cost detail modal:", err);
        bodyEl.innerHTML = '<p style="color:var(--text-danger);text-align:center;">読み込みに失敗しました。</p>';
    }
}

function closeCostDetailModal() {
    const modal = document.getElementById('cost-detail-modal');
    if (modal) modal.style.display = 'none';
}

window.viewCostDetailModal = viewCostDetailModal;
window.closeCostDetailModal = closeCostDetailModal;
