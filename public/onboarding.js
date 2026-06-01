// public/onboarding.js
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('onboarding-form');
  const messageDiv = document.getElementById('message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    messageDiv.textContent = '決済画面へ進んでいます。少々お待ちください...';
    messageDiv.className = 'message';
    messageDiv.style.color = 'var(--primary)';
    messageDiv.style.display = 'block';

    const companyName = form.companyName.value.trim();
    const planEl = form.querySelector('input[name="plan"]:checked');
    if (!planEl) {
      messageDiv.textContent = 'お選びいただくプランを選択してください。';
      messageDiv.className = 'message error';
      messageDiv.style.display = 'block';
      return;
    }
    const plan = planEl.value; // price ID
    const adminName = form.adminName.value.trim();
    const adminEmail = form.adminEmail.value.trim();
    const password = form.password.value;

    // 構造化したリクエストボディ
    const payload = {
      companyName,
      plan,
      adminName,
      adminEmail,
      password,
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
      // Stripe Checkout の URL へリダイレクト
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('Checkout URL が取得できませんでした');
      }
    } catch (err) {
      console.error(err);
      messageDiv.textContent = `エラー: ${err.message}`;
      messageDiv.className = 'message error';
      messageDiv.style.color = 'red';
      messageDiv.style.display = 'block';
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
