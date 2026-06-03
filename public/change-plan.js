// public/change-plan.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('change-plan-form');
  const companyNameEl = document.getElementById('company-name');
  const currentPlanNameEl = document.getElementById('current-plan-name');
  const optionsContainer = document.getElementById('options-container');
  const messageDiv = document.getElementById('message');
  const submitBtn = document.getElementById('submit-btn');

  let currentCompany = null;

  // Firebaseの初期化完了を待ってAuth監視を開始
  const interval = setInterval(() => {
    if (window.firebaseAuth && window.firebaseDb && window.firebaseOnAuthStateChanged) {
      clearInterval(interval);
      initApp();
    }
  }, 50);

  function initApp() {
    const auth = window.firebaseAuth;
    const db = window.firebaseDb;
    const onAuthStateChanged = window.firebaseOnAuthStateChanged;
    const doc = window.firebaseDoc;
    const getDoc = window.firebaseGetDoc;

    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // 未ログイン時はログイン画面へ戻す
        window.location.replace('app.html');
        return;
      }

      try {
        // パラメータから会社IDを取得
        const urlParams = new URLSearchParams(window.location.search);
        const cid = urlParams.get('cid');

        if (!cid) {
          throw new Error('会社IDパラメータ(cid)が不足しています。');
        }

        // Firestoreから会社ドキュメントを取得
        const docRef = doc(db, 'companies', cid);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
          throw new Error('会社データが見つかりませんでした。');
        }

        currentCompany = docSnap.data();

        // 権限確認 (admin のみ)
        const isAdmin = currentCompany.adminEmails && currentCompany.adminEmails.includes(user.email);
        const isOwner = currentCompany.ownerUid === user.uid;
        if (!isAdmin && !isOwner) {
          throw new Error('プラン変更は管理者のみ実行可能です。');
        }

        // 現在情報の表示
        const currentLimit = currentCompany.maxUsers || 10;
        companyNameEl.textContent = currentCompany.companyName || cid;
        currentPlanNameEl.textContent = `${currentLimit}名プラン`;

        // オプション（口数追加）の動的描画
        renderUpgradeOptions(currentLimit);

        form.style.display = 'block';

      } catch (err) {
        console.error(err);
        showMsg(err.message, 'error');
        companyNameEl.textContent = 'エラー';
        currentPlanNameEl.textContent = 'エラー';
      }
    });
  }

  // 追加オプションのレンダリング
  function renderUpgradeOptions(currentLimit) {
    const currentQty = currentLimit / 10; // 現在の口数
    optionsContainer.innerHTML = '';

    if (currentQty >= 5) {
      optionsContainer.innerHTML = '<p style="color:var(--text-muted);font-weight:600;">既に上限の5口（50名プラン）をご契約いただいています。</p>';
      submitBtn.disabled = true;
      return;
    }

    // 2口(20名)から5口(50名)までの選択肢を作成
    for (let qty = currentQty + 1; qty <= 5; qty++) {
      const addedLimit = (qty - currentQty) * 10;
      const totalLimit = qty * 10;
      const additionalPrice = (qty - currentQty) * 5000;

      const optionLabel = document.createElement('label');
      optionLabel.className = 'plan-option-label';

      optionLabel.innerHTML = `
        <input type="radio" name="quantity" value="${qty}" ${qty === currentQty + 1 ? 'checked' : ''} />
        <div class="plan-option-body">
          <div class="option-title">
            <span>＋${addedLimit}名追加 (合計 ${totalLimit}名まで)</span>
            <span class="option-price">＋¥${new Intl.NumberFormat('ja-JP').format(additionalPrice)}/月 <span style="font-size:0.75rem;color:var(--text-muted);"> (税別)</span></span>
          </div>
          <div class="option-desc">ご契約口数を ${currentQty}口から ${qty}口に変更し、ユーザー登録枠を最大 ${totalLimit}名に拡大します。</div>
        </div>
      `;
      optionsContainer.appendChild(optionLabel);
    }
  }

  // 確定ボタンのサブミット処理
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedQty = form.quantity.value;
    if (!selectedQty) return;

    showMsg('プランの変更手続きを実行しています。少々お待ちください...', 'info');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner-icon"></span> 処理中...';

    try {
      const payload = {
        companyId: currentCompany.companyId,
        newQuantity: parseInt(selectedQty, 10),
      };

      const response = await fetch('/api/change-plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'プラン変更処理に失敗しました。');
      }

      // 成功画面へ遷移
      window.location.replace('onboarding-success.html?method=change-success');

    } catch (err) {
      console.error(err);
      showMsg(`エラー: ${err.message}`, 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'プラン変更を確定する';
    }
  });

  function showMsg(text, type) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';
  }
});
