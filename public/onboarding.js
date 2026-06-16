// public/onboarding.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('onboarding-form');
  const messageDiv = document.getElementById('message');
  const submitBtn = document.getElementById('submit-btn');

  // お支払い方法のラジオボタン変更を検知してボタンテキストを動的変更
  const paymentRadios = document.querySelectorAll('input[name="paymentMethod"]');
  const planHidden = document.getElementById('onboarding-plan-id');
  const payMethodSection = document.getElementById('payment-method-section');
  const payMethodFreeNote = document.getElementById('payment-method-free-note');
  const quantityRadios = document.querySelectorAll('input[name="quantity"]');

  const syncPlanAndPaymentSection = () => {
    const selectedQuantity = form.querySelector('input[name="quantity"]:checked').value;
    if (selectedQuantity === 'free') {
      if (planHidden) planHidden.value = 'free';
      if (payMethodSection) payMethodSection.style.display = 'none';
      if (payMethodFreeNote) payMethodFreeNote.style.display = 'block';
      if (submitBtn) submitBtn.textContent = '無料版で登録を完了する';
    } else {
      if (planHidden) planHidden.value = 'price_1TaP0sJdCQkwItViebEBEhJa'; // Stripe Price ID
      if (payMethodSection) payMethodSection.style.display = 'block';
      if (payMethodFreeNote) payMethodFreeNote.style.display = 'none';
      syncSubmitButtonText();
    }
  };

  const syncSubmitButtonText = () => {
    const paymentMethod = form.paymentMethod.value;
    if (paymentMethod === 'invoice') {
      if (submitBtn) submitBtn.textContent = '登録を完了する';
    } else {
      if (submitBtn) submitBtn.textContent = '支払いに進む';
    }
  };

  // 初期化時に実行
  syncPlanAndPaymentSection();

  quantityRadios.forEach(radio => {
    radio.addEventListener('change', syncPlanAndPaymentSection);
  });

  paymentRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      syncSubmitButtonText();
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedQuantity = form.querySelector('input[name="quantity"]:checked').value;
    let paymentMethod = 'card';
    if (selectedQuantity === 'free') {
      paymentMethod = 'free';
    } else {
      paymentMethod = form.paymentMethod.value || 'card';
    }

    if (paymentMethod === 'free') {
      messageDiv.textContent = '無料版アカウントのセットアップを実行しています。少々お待ちください...';
    } else if (paymentMethod === 'invoice') {
      messageDiv.textContent = 'アカウントおよび請求書のセットアップを実行しています。少々お待ちください...';
    } else {
      messageDiv.textContent = '決済画面へ進んでいます。少々お待ちください...';
    }
    
    messageDiv.className = 'message';
    messageDiv.style.color = 'var(--primary)';
    messageDiv.style.display = 'block';

    // ボタンの非活性化とスピナーの表示
    let originalBtnText = '確定する';
    if (submitBtn) {
      originalBtnText = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-icon"></span> 処理中...';
    }

    const companyName = form.companyName.value.trim();
    const plan = form.plan.value; // price ID or 'free'
    if (!plan) {
      messageDiv.textContent = 'お選びいただくプランを選択してください。';
      messageDiv.className = 'message error';
      messageDiv.style.display = 'block';
      
      // ボタン復元
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
      return;
    }
    const quantity = form.quantity.value;
    const adminName = form.adminName.value.trim();
    const adminEmail = form.adminEmail.value.trim();
    const password = form.password.value;
    const passwordConfirm = form.passwordConfirm.value;

    if (password !== passwordConfirm) {
      messageDiv.textContent = 'パスワードと確認用パスワードが一致しません。';
      messageDiv.className = 'message error';
      messageDiv.style.color = 'red';
      messageDiv.style.display = 'block';

      // ボタン復元
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
      return;
    }

    // 構造化したリクエストボディ
    const payload = {
      companyName,
      plan,
      quantity,
      adminName,
      adminEmail,
      password,
      paymentMethod,
    };

    try {
      const response = await fetch('/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'サーバーエラー');
      }
      const data = await response.json();

      // 無料プランまたは請求書払いの場合は、Stripe決済を通さずに成功画面へリダイレクト
      if (data.paymentMethod === 'free') {
        window.location.replace('onboarding-success.html?method=free');
      } else if (data.paymentMethod === 'invoice') {
        window.location.replace('onboarding-success.html?method=invoice');
      } else if (data.url) {
        // Stripe Checkout の URL へリダイレクト
        window.location.replace(data.url);
      } else {
        throw new Error('Checkout URL または完了応答が取得できませんでした');
      }
    } catch (err) {
      console.error(err);
      messageDiv.textContent = `エラー: ${err.message}`;
      messageDiv.className = 'message error';
      messageDiv.style.color = 'red';
      messageDiv.style.display = 'block';

      // エラー時にボタンを活性状態に戻す
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
      }
    }
  });

  // パスワードの表示・非表示切り替え
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
});
