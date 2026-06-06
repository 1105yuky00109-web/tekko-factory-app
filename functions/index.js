// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ------------------------------------------------------------
// 汎用SMTPメール送信ヘルパー
// ------------------------------------------------------------
async function sendMailHelper({ to, subject, text, fromName = '日報アプリ管理部' }) {
  const nodemailer = require('nodemailer');
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT) || 465;
  const smtpUser = process.env.SMTP_USER || 'areva.noreply@gmail.com';
  const smtpPass = process.env.SMTP_PASS;
  
  const smtpFrom = process.env.SMTP_FROM || `${fromName} <${smtpUser}>`;

  if (!smtpPass) {
    console.log('--- [SMTP_PASSが未設定のためメール送信をシミュレートしました] ---');
    console.log('宛先:', to);
    console.log('件名:', subject);
    console.log('本文:\n', text);
    console.log('------------------------------------------------------------------');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const mailOptions = {
    from: smtpFrom,
    to: to,
    subject: subject,
    text: text,
  };

  await transporter.sendMail(mailOptions);
  console.log(`[Email] Mail sent successfully to ${to}`);
}


// ------------------------------------------------------------
// 1. createCheckoutSession
// ------------------------------------------------------------
// 重複しない会社IDを自動生成する（c_ + 8桁のランダム英数字）
async function generateUniqueCompanyId(database) {
  let isUnique = false;
  let companyId = '';
  let attempts = 0;
  while (!isUnique && attempts < 10) {
    attempts++;
    const randomStr = Math.random().toString(36).substring(2, 10);
    companyId = `c_${randomStr}`;
    const doc = await database.collection('companies').doc(companyId).get();
    if (!doc.exists) {
      isUnique = true;
    }
  }
  if (!isUnique) {
    throw new Error('会社IDの自動生成に失敗しました。時間をおいて再度お試しください。');
  }
  return companyId;
}

exports.api = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  // CORSヘッダーの設定
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  const rawPath = req.path || req.url || '';
  const path = rawPath.startsWith('/api') ? rawPath.substring(4) : rawPath;
  
  // 1. 請求書詳細取得API
  if (path === '/get-invoice-details') {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
    const { invoiceId } = req.body;
    if (!invoiceId) {
      return res.status(400).json({ error: 'invoiceId is required' });
    }

    // テスト用のダミーIDの場合は、モックデータを返却する
    if (invoiceId.startsWith('in_test')) {
      const mockData = {
        number: 'INV-20260603-TEST',
        date: Math.floor(Date.now() / 1000),
        dueDate: Math.floor(Date.now() / 1000) + 30 * 86400, // 30日後
        customerName: 'テスト企業 御中 大和田 様',
        amountDue: 5500,
        bankDetails: {
          bank_name: 'ＧＭＯあおぞらネット銀行',
          bank_code: '0310',
          branch_name: '法人営業部支店',
          branch_code: '101',
          account_type: 'normal',
          account_number: '1273942',
          account_holder_name: 'カ）アレバ',
        },
      };
      return res.json(mockData);
    }

    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      const customer = await stripe.customers.retrieve(invoice.customer);
      const customerName = customer.name || customer.description || 'お客様';

      const bankDetails = {
        bank_name: 'ＧＭＯあおぞらネット銀行',
        bank_code: '0310',
        branch_name: '法人営業部支店',
        branch_code: '101',
        account_type: 'normal',
        account_number: '1273942',
        account_holder_name: 'カ）アレバ',
      };

      const resData = {
        number: invoice.number,
        date: invoice.created,
        dueDate: invoice.due_date,
        customerName: customerName,
        amountDue: invoice.amount_due,
        bankDetails: bankDetails,
      };
      return res.json(resData);
    } catch (err) {
      console.error('get-invoice-details error', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 1.5. 【デバッグ用】ユーザー強制有効化＆パスワード強制変更API
  if (path === '/activate-user-debug') {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
    const { email, password } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'email is required' });
    }
    try {
      const user = await admin.auth().getUserByEmail(email);
      const updateData = { emailVerified: true };
      if (password) {
        updateData.password = password;
      }
      await admin.auth().updateUser(user.uid, updateData);
      return res.json({ success: true, message: `Successfully updated ${email}` });
    } catch (err) {
      console.error('activate-user-debug error', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // 1.8. プラン変更（登録人数の追加）API
  if (path === '/change-plan') {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }
    const { companyId, newQuantity } = req.body;
    if (!companyId || !newQuantity) {
      return res.status(400).json({ error: 'companyId and newQuantity are required.' });
    }

    try {
      // 1. Firestoreから会社データを取得
      const companyRef = db.collection('companies').doc(companyId);
      const companyDoc = await companyRef.get();
      if (!companyDoc.exists) {
        return res.status(404).json({ error: 'Company not found' });
      }
      const companyData = companyDoc.data();

      // 2. Stripe Customer ID と Subscription ID の取得
      let stripeCustomerId = companyData.stripeCustomerId || '';
      let subscriptionId = '';

      // サブコレクション subscriptions からサブスクIDを取得
      const subSnapshot = await companyRef.collection('subscriptions').get();
      if (!subSnapshot.empty) {
        subscriptionId = subSnapshot.docs[0].id;
      }

      if (!subscriptionId) {
        return res.status(400).json({ error: 'Active subscription not found for this company.' });
      }

      // Stripe API でサブスク情報を取得して Customer ID も解決
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionItemId = subscription.items.data[0].id;
      stripeCustomerId = stripeCustomerId || subscription.customer;

      // 会社ドキュメントに stripeCustomerId が欠落していた場合は保存（補完）
      if (!companyData.stripeCustomerId) {
        await companyRef.update({ stripeCustomerId });
      }

      console.log(`[API /change-plan] Modifying subscription ${subscriptionId} for customer ${stripeCustomerId} to quantity ${newQuantity}`);

      // 3. Stripeサブスクリプションの更新（既存の決済方法をそのまま引き継ぐ）
      const updatedSub = await stripe.subscriptions.update(subscriptionId, {
        items: [{
          id: subscriptionItemId,
          quantity: parseInt(newQuantity, 10),
        }],
        proration_behavior: 'always_invoice',
      });

      // 4. Firestoreの会社情報を更新
      const maxUsers = parseInt(newQuantity, 10) * 10;
      await companyRef.update({
        maxUsers: maxUsers,
        planName: `${maxUsers}名パック`,
        paymentMethod: isInvoice ? 'invoice' : 'card'
      });

      // 5. サブスクリプションサブコレクションも更新
      await companyRef.collection('subscriptions').doc(subscriptionId).update({
        status: updatedSub.status,
        currentPeriodEnd: updatedSub.current_period_end,
      });

      // 6. メールの送付判定
      const isInvoice = updatedSub.collection_method === 'send_invoice';
      const adminEmail = companyData.adminEmails && companyData.adminEmails[0];

      if (adminEmail) {
        let emailText = '';
        if (isInvoice) {
          // 請求書払いの場合
          const latestInvoiceId = updatedSub.latest_invoice;
          const invoiceLink = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/invoice.html?id=${latestInvoiceId}`;

          emailText = `${companyData.companyName}
御中 管理者 様

平素は「工事管理システム」をご利用いただき、誠にありがとうございます。

ご契約プランの変更手続きが完了いたしました。
新しいプラン上限数が即座に適用され、引き続きシステムをご利用いただけます。

----------------------------------------
■ ご契約プラン： ${maxUsers}名プラン
■ 最大登録社員数： ${maxUsers}名
■ お支払い方法： 請求書払い（銀行振込）
----------------------------------------

■ お支払い口座（請求書）の確認
今回のプラン変更に伴う追加料金の請求書は、以下のURLよりご確認および印刷いただけます。

請求書確認URL：
${invoiceLink}

※ 振込手数料はお客様負担にてお願いいたします。
※ ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。
`;
        } else {
          // クレジットカード決済の場合
          emailText = `${companyData.companyName}
御中 管理者 様

平素は「工事管理システム」をご利用いただき、誠にありがとうございます。

ご契約プランの変更手続きが完了いたしました。
新しいプラン上限数が即座に適用され、引き続きシステムをご利用いただけます。

----------------------------------------
■ ご契約プラン： ${maxUsers}名プラン
■ 最大登録社員数： ${maxUsers}名
■ お支払い方法： クレジットカード決済
----------------------------------------
※ 今回の追加分の日割り料金は、ご登録済みのクレジットカードより自動的に決済されます。

ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。
`;
        }

        await sendMailHelper({
          to: adminEmail,
          subject: `【重要】${companyData.companyName}様 ご契約プラン変更完了のお知らせ`,
          text: emailText,
          fromName: 'AREVA サポート窓口'
        });
        console.log(`[API /change-plan] Sent plan change success email to ${adminEmail}`);
      }

      return res.json({
        success: true,
        maxUsers,
        paymentMethod: isInvoice ? 'invoice' : 'card'
      });

    } catch (e) {
      console.error('/change-plan error', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // 2. 新規お申し込み（クレジットカード / 請求書払い）
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const {
    companyName,
    plan, // stripe price id
    quantity,
    adminName,
    adminEmail,
    password,
    paymentMethod, // 'card' or 'invoice'
  } = req.body;

  // デバッグ用ログ追加
  console.log(`[API] Received registration request. Path: ${path}, paymentMethod: ${paymentMethod}, plan: ${plan}, quantity: ${quantity}, adminEmail: ${adminEmail}`);

  if (!companyName || !plan || !adminEmail || !adminName || !password) {
    return res.status(400).json({ error: '必須入力項目が不足しています。' });
  }

  // 二重登録防止用のメールアドレス重複チェック
  try {
    await admin.auth().getUserByEmail(adminEmail);
    return res.status(400).json({ error: 'このメールアドレスはすでに登録されています。' });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      console.error('Email check error', err);
      return res.status(500).json({ error: 'メールアドレスの重複チェック中にエラーが発生しました。' });
    }
  }

  let companyId;
  try {
    companyId = await generateUniqueCompanyId(db);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  try {
    // 顧客（Customer）の作成
    const customer = await stripe.customers.create({
      email: adminEmail,
      name: `${companyName} 御中 ${adminName} 様`,
      metadata: {
        companyName,
        adminName,
        adminEmail,
      }
    });

    if (paymentMethod === 'invoice') {
      console.log(`[API] Processing Invoice payment flow for ${adminEmail}`);
      // 請求書払い：Stripeで直接サブスクリプションを作成（クレジットカード不要、14日間トライアル）
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{ price: plan, quantity: parseInt(quantity) || 1 }],
        trial_period_days: 14,
        collection_method: 'send_invoice',
        days_until_due: 30,
      });

      // Firebase Auth ユーザーを作成
      const userRecord = await admin.auth().createUser({
        email: adminEmail,
        password: password,
        displayName: adminName,
        emailVerified: true,
      });
      const adminUid = userRecord.uid;

      // Firestore に会社データを作成
      const companyRef = db.collection('companies').doc(companyId);
      const maxUsers = (parseInt(quantity) || 1) * 10;
      await companyRef.set({
        companyId,
        companyName,
        planId: plan,
        planName: `${maxUsers}名パック`,
        stripeCustomerId: customer.id,
        maxUsers: maxUsers,
        ownerUid: adminUid,
        adminEmails: [adminEmail],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        trialStart: subscription.trial_start || null,
        trialEnd: subscription.trial_end || null,
        paymentMethod: 'invoice',
      });

      // サブスクリプション情報の登録
      await companyRef.collection('subscriptions').doc(subscription.id).set({
        subscriptionId: subscription.id,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
      });

      // アカウント登録完了メール（有効化メール）の送信
      const invoiceLink = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/invoice.html?id=${subscription.latest_invoice}`;
      const loginUrl = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/app.html?logout=true&email=${encodeURIComponent(adminEmail)}`;

      const emailText = `${adminName} 様

この度は「工事・日報管理システム」をご契約いただき、誠にありがとうございます。
管理者様のアカウントおよび会社データのセットアップが完了いたしました。

以下のログイン情報にてシステムをご利用いただけます。

----------------------------------------
■ ログインURL
${loginUrl}

■ 管理者ログイン用メールアドレス
${adminEmail}
----------------------------------------
※ パスワードは登録時にご自身で設定された任意のパスワードとなります。

■ お支払い口座（請求書）の確認
今回の契約に関するお支払い（銀行振込）情報および適格請求書は、以下のURLよりご確認および印刷いただけます。
※現在は14日間の無料トライアル期間中のため、ご請求金額は ¥0 と表示されます。
※トライアル期間終了後に有償期間（本契約）に移行する際、同じお振込先へのお支払い手続きをお願いいたします。

請求書確認URL：
${invoiceLink}

ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。
`;

      await sendMailHelper({
        to: adminEmail,
        subject: `【重要】${companyName}様 アカウント登録完了のお知らせ`,
        text: emailText,
        fromName: 'AREVA サポート窓口'
      });

      return res.json({ success: true, paymentMethod: 'invoice', invoiceId: subscription.latest_invoice });

    } else {
      console.log(`[API] Processing Credit Card flow for ${adminEmail}, creating Checkout Session`);
      // クレジットカード決済：Stripe Checkout Sessionを作成
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'subscription',
        customer: customer.id,
        line_items: [{ price: plan, quantity: parseInt(quantity) || 1 }],
        subscription_data: {
          trial_period_days: 14,
        },
        metadata: {
          companyName,
          companyId,
          adminName,
          adminEmail,
          password,
          plan,
          quantity,
        },
        success_url: `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/onboarding-success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/onboarding.html`,
      });
      return res.json({ url: session.url });
    }
  } catch (e) {
    console.error('API processing error', e);
    return res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// 2. Stripe webhook handler
// ------------------------------------------------------------
exports.stripeWebhook = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 1. クレジットカード決済でのお申し込み完了時の処理
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const {
      companyName,
      companyId,
      adminName,
      adminEmail,
      password,
      quantity,
    } = session.metadata;

    const planId = session.metadata.plan || '';

    // Firebase Auth ユーザーを作成
    let adminUid;
    try {
      const userRecord = await admin.auth().createUser({
        email: adminEmail,
        password: password || undefined,
        displayName: adminName,
        emailVerified: true,
      });
      adminUid = userRecord.uid;
    } catch (e) {
      console.error('Auth user creation failed', e);
      const userRecord = await admin.auth().getUserByEmail(adminEmail);
      adminUid = userRecord.uid;
    }

    // Stripe 顧客の表示名をアップデート（敬称対応）
    try {
      if (session.customer) {
        await stripe.customers.update(session.customer, {
          name: `${companyName} 御中 ${adminName} 様`,
        });
      }
    } catch (custErr) {
      console.error('Failed to update customer name', custErr);
    }

    // Stripe サブスクリプション詳細の取得 (trial_start, trial_end 取得のため)
    let trialStart = null;
    let trialEnd = null;
    if (session.subscription) {
      try {
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        trialStart = subscription.trial_start || null;
        trialEnd = subscription.trial_end || null;
      } catch (subErr) {
        console.error('Failed to retrieve subscription details in checkout.session.completed', subErr);
      }
    }

    // Firestore に会社データを作成
    const companyRef = db.collection('companies').doc(companyId);
    const maxUsers = (parseInt(quantity) || 1) * 10;
    
    await companyRef.set({
      companyId,
      companyName,
      planId,
      planName: `${maxUsers}名パック`,
      stripeCustomerId: session.customer,
      maxUsers: maxUsers,
      ownerUid: adminUid,
      adminEmails: [adminEmail],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
      trialStart: trialStart,
      trialEnd: trialEnd,
      paymentMethod: 'card',
    });

    // サブスクリプション情報の登録
    const subId = session.subscription || 'sub_default';
    await companyRef.collection('subscriptions').doc(subId).set({
      subscriptionId: session.subscription || null,
      status: session.payment_status || null,
      currentPeriodEnd: session.current_period_end || null,
    });

    console.log(`Company ${companyId} created for ${adminEmail}`);

    // お名前.com SMTP経由での登録完了メール送信
    try {
      const loginUrl = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/app.html?logout=true&email=${encodeURIComponent(adminEmail)}`;

      const emailText = `${adminName} 様

この度は「工事・日報管理システム」をご契約いただき、誠にありがとうございます。
管理者様のアカウントおよび会社データのセットアップが完了いたしました。

以下のログイン情報にてシステムをご利用いただけます。

----------------------------------------
■ ログインURL
${loginUrl}

■ 管理者ログイン用メールアドレス
${adminEmail}
----------------------------------------
※ パスワードは登録時にご自身で設定された任意のパスワードとなります。

ログイン後, 管理者メニューよりユーザー（社員）の追加や予定表の設定を行ってください。

ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。
`;

      await sendMailHelper({
        to: adminEmail,
        subject: `【重要】${companyName}様 アカウント登録完了のお知らせ`,
        text: emailText,
        fromName: 'AREVA サポート窓口'
      });
      console.log(`[Webhook] 登録完了メールを ${adminEmail} 宛に送信しました。`);
    } catch (mailErr) {
      console.error('メール送信処理中にエラーが発生しました:', mailErr);
    }

  // 2. 本契約移行時（および月次更新時）の請求書確定イベントの処理
  } else if (event.type === 'invoice.finalized') {
    const invoice = event.data.object;
    const customerId = invoice.customer;
    let customerName = 'お客様';
    let customerEmail = invoice.customer_email;

    try {
      const customer = await stripe.customers.retrieve(customerId);
      customerName = customer.name || customer.description || 'お客様';
      customerEmail = customerEmail || customer.email;
    } catch (custErr) {
      console.error('Customer retrieve error', custErr);
    }

    const invoiceId = invoice.id;
    const amountDue = invoice.amount_due;

    // 無料トライアル（0円）の確定はスキップし、本課金時のみ請求メールを送る
    if (amountDue > 0) {
      const invoiceLink = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/invoice.html?id=${invoiceId}`;
      const dueDateStr = invoice.due_date 
        ? new Date(invoice.due_date * 1000).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '-';

      const emailText = `${customerName}

平素は「工事・日報管理システム」をご利用いただき、誠にありがとうございます。
無料トライアル期間が終了し、本契約が開始されましたのでご請求書を送付いたします。

以下のURLより適格請求書およびお振込先口座（GMOあおぞらネット銀行）情報をご確認の上、
支払期限までにお手続きをお願い申し上げます。

----------------------------------------
■ ご請求金額： ¥${new Intl.NumberFormat('ja-JP').format(amountDue)}- (税込)
■ お支払期限： ${dueDateStr}
----------------------------------------

■ 請求書URL（お振込み先口座のご確認）：
${invoiceLink}

※ 振込手数料はお客様負担にてお願いいたします。
※ すでにお振込み手続きがお済みの場合は、行き違いですので何卒ご容赦ください。

ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。
`;

      await sendMailHelper({
        to: customerEmail,
        subject: `【重要】本契約開始に伴うご請求書送付のお知らせ`,
        text: emailText,
        fromName: 'AREVA サポート窓口'
      });
      console.log(`[Webhook] Sent finalized invoice email to ${customerEmail} for invoice ${invoiceId}`);
    } else {
      console.log(`[Webhook] Invoice ${invoiceId} finalized with 0 amount, skipping email.`);
    }
  } else if (event.type === 'customer.subscription.trial_will_end') {
    const subscription = event.data.object;
    const customerId = subscription.customer;
    let customerName = 'お客様';
    let customerEmail = subscription.customer_email || '';

    try {
      const customer = await stripe.customers.retrieve(customerId);
      customerName = customer.name || customer.description || 'お客様';
      customerEmail = customerEmail || customer.email;
    } catch (custErr) {
      console.error('Customer retrieve error in trial_will_end', custErr);
    }

    if (customerEmail) {
      const trialEnd = subscription.trial_end;
      const trialEndDateStr = trialEnd 
        ? new Date(trialEnd * 1000).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '-';
      const billingStartDateStr = trialEnd
        ? new Date((trialEnd + 86400) * 1000).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '-';

      // 会社データからプラン名やユーザー上限数を取得
      let maxUsersText = '10名';
      let planNameText = '10名パック';
      try {
        const compSnapshot = await db.collection('companies').where('planId', '==', subscription.plan ? subscription.plan.id : '').get();
        if (!compSnapshot.empty) {
          const compData = compSnapshot.docs[0].data();
          maxUsersText = `最大 ${compData.maxUsers || 10}名`;
          planNameText = compData.planName || '10名パック追加プラン';
        }
      } catch (dbErr) {
        console.error('Firestore retrieve error in trial_will_end', dbErr);
      }

      const emailText = `${customerName}

平素は「工事・日報管理システム」をご利用いただき、誠にありがとうございます。

現在ご利用いただいております無料トライアル期間（14日間）が、まもなく終了いたしますのでご案内申し上げます。

■ トライアル終了日： ${trialEndDateStr}
■ 本契約開始日（課金開始日）： ${billingStartDateStr}

トライアル期間終了後は、自動的に有償プラン（本契約）へと移行し、初回のご請求が発生いたします。

--------------------------------------------------
■ ご契約プラン： ${planNameText}
■ ご利用可能ユーザー数： ${maxUsersText}
■ お支払い方法： 請求書払い（銀行振込）
--------------------------------------------------

本契約開始日にStripeより別途「適格請求書（振込口座記載）」がメールにて送付されます。請求書に記載 of 指定振込口座（GMOあおぞらネット銀行）へ、支払期限までにお振込みをお願いいたします。

※ トライアル期間中（終了日前日まで）にご解約手続きを行われた場合、料金の請求は発生いたしません。
※ 解約やプラン変更を希望される場合は、システム内「契約管理」よりお手続きをお願いいたします。

ご不明な点がございましたら、AREVA サポート窓口までお問い合わせください。
今後ともよろしくお願い申し上げます。

--------------------------------------------------
AREVA サポート窓口
Email: info@areva.co.jp
URL: https://tekko-factory-app.web.app/
--------------------------------------------------
`;

      await sendMailHelper({
        to: customerEmail,
        subject: `【事前案内】無料トライアル終了と本契約移行に関するお知らせ`,
        text: emailText,
        fromName: 'AREVA サポート窓口'
      });
      console.log(`[Webhook] Sent trial_will_end email to ${customerEmail}`);
    } else {
      console.warn(`[Webhook] trial_will_end received but customer email not found for customer: ${customerId}`);
    }
  }

  res.json({ received: true });
});

// ------------------------------------------------------------
// 3. addEmployee (管理者による社員追加API)
// ------------------------------------------------------------
exports.addEmployee = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  // CORSヘッダーの設定（ローカルエミュレータなどのクロスドメインからのリクエスト対応用）
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const {
    companyId,
    adminEmail,
    adminUid,
    employeeName,
    employeeEmail
  } = req.body;

  if (!companyId || !adminEmail || !adminUid || !employeeName || !employeeEmail) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    // 1. 管理者の権限確認 (Firestoreから会社情報を取得し、ownerUidまたはadminEmailsが一致するか確認)
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '指定された会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const isAdmin = companyData.ownerUid === adminUid || (companyData.adminEmails && companyData.adminEmails.includes(adminEmail));
    if (!isAdmin) {
      return res.status(403).json({ error: '社員を追加する権限がありません。' });
    }

    // 1.5 プランの上限人数チェック (管理者 + 社員数)
    const maxUsers = companyData.maxUsers || 20;
    const currentEmployeesCount = (companyData.employees || []).length;
    const adminCount = (companyData.adminEmails || []).length;
    const totalUsersCount = adminCount + currentEmployeesCount;
    if (totalUsersCount >= maxUsers) {
      return res.status(400).json({ error: `契約プランの上限人数（最大${maxUsers}名）に達しているため、これ以上登録できません。` });
    }

    // 2. 仮パスワード（英数字混ざり12桁）をサーバーサイドで自動生成
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$';
    let tempPassword = '';
    for (let i = 0; i < 12; i++) {
      tempPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // 3. 社員の Firebase Auth ユーザーを作成
    let employeeUid;
    try {
      const userRecord = await admin.auth().createUser({
        email: employeeEmail,
        password: tempPassword,
        displayName: employeeName,
        emailVerified: true,
      });
      employeeUid = userRecord.uid;
    } catch (authErr) {
      console.error('Auth user creation failed', authErr);
      if (authErr.code === 'auth/email-already-exists') {
        return res.status(400).json({ error: 'このメールアドレスはすでに他のアカウントで使用されています。' });
      }
      return res.status(500).json({ error: `Authユーザーの作成に失敗しました: ${authErr.message}` });
    }

    // 4. 会社ドキュメントの memberEmails および employees 配列に追加 (初回ログイン時にパスワード変更を求めるフラグを付与)
    await companyRef.update({
      memberEmails: admin.firestore.FieldValue.arrayUnion(employeeEmail),
      employees: admin.firestore.FieldValue.arrayUnion({
        uid: employeeUid,
        name: employeeName,
        email: employeeEmail,
        createdAt: new Date().toISOString(),
        mustChangePassword: true
      })
    });

    console.log(`Employee ${employeeEmail} successfully registered for company ${companyId}`);
    try {
      const loginUrl = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/app.html`;

      const mailText = `${employeeName} 様

いつも「工事・日報管理システム」をご利用いただき、ありがとうございます。
管理者様により、あなたのアカウントがシステムに登録されました。

以下のログイン情報および手順に従って、システムをご利用ください。

----------------------------------------
■ ログインURL
${loginUrl}

■ ログイン用メールアドレス
${employeeEmail}

■ 初期仮パスワード
${tempPassword}
----------------------------------------

【重要】セキュリティ向上のため、初めてログインされた直後にご自身で新しいパスワードを設定する画面が表示されます。
メールに記載された上記の仮パスワードでログインし、画面の指示に従って新しいパスワードを設定してください。

本メールはシステムより自動送信されています。
`;

      await sendMailHelper({
        to: employeeEmail,
        subject: '【重要】アカウント登録完了のお知らせ',
        text: mailText,
        fromName: '日報管理システム事務局'
      });
      console.log(`[Email] 社員宛て登録案内メールを ${employeeEmail} 宛に送信しました。`);
    } catch (mailErr) {
      console.error('メール送信処理中にエラーが発生しました:', mailErr);
    }

    res.json({ success: true, uid: employeeUid });
  } catch (err) {
    console.error('addEmployee error', err);
    res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------
// 4. checkEmailRegistered (未ログイン状態でのメールアドレス登録確認用)
// ------------------------------------------------------------
exports.checkEmailRegistered = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'メールアドレスが指定されていません。' });
  }

  try {
    // Auth上にそのメールアドレスが存在するかチェック
    await admin.auth().getUserByEmail(email);
    res.json({ registered: true });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return res.json({ registered: false });
    }
    console.error('checkEmailRegistered error', error);
    res.status(500).json({ error: error.message });
  }
});

// 日付表記 (例: 2026-05-31) を 日本語表記 (例: 2026年05月31日) に変換する
function formatDateString(dateStr) {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-');
    return `${year}年${month}月${day}日`;
  } catch (e) {
    console.error('Error formatting date string:', e);
    return dateStr;
  }
}

// ------------------------------------------------------------
// 6. sendRemindNotification (管理者からの日報催促通知API)
// ------------------------------------------------------------
exports.sendRemindNotification = functions.region('asia-northeast1').https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const { companyId, employeeUid, date } = req.body;
  if (!companyId || !employeeUid || !date) {
    return res.status(400).json({ error: '必須項目が不足しています。' });
  }

  try {
    const companyRef = db.collection('companies').doc(companyId);
    const companyDoc = await companyRef.get();
    if (!companyDoc.exists) {
      return res.status(404).json({ error: '会社が見つかりません。' });
    }

    const companyData = companyDoc.data();
    const employee = companyData.employees ? companyData.employees.find(e => e.uid === employeeUid) : null;
    if (!employee) {
      return res.status(404).json({ error: '社員が見つかりません。' });
    }

    const tokens = employee.fcmTokens || [];
    const formattedDate = formatDateString(date);
    const title = '日報提出の催促';
    const body = `${formattedDate}の日報の提出が未完了です。至急ご入力・ご提出をお願いします。`;

    // 1. FCMプッシュ送信
    if (tokens.length > 0) {
      const messages = tokens.map(token => ({
        token: token,
        notification: { title, body },
        data: { click_action: '/' }
      }));

      try {
        const response = await admin.messaging().sendEach(messages);
        console.log(`Sent remind messages: ${response.successCount}`);
        
        // 無効トークンのクリーンアップ
        const invalidTokens = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errCode = resp.error.code;
            if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
              invalidTokens.push(tokens[idx]);
            }
          }
        });

        if (invalidTokens.length > 0) {
          const updatedEmployees = companyData.employees.map(emp => {
            if (emp.uid === employeeUid) {
              return { ...emp, fcmTokens: emp.fcmTokens.filter(t => !invalidTokens.includes(t)) };
            }
            return emp;
          });
          await companyRef.update({ employees: updatedEmployees });
        }
      } catch (fcmErr) {
        console.error('FCM remind error', fcmErr);
      }
    }
    try {
      const loginUrl = `${process.env.HOST_URL || 'https://tekko-factory-app.web.app'}/app.html`;
      const mailText = `${employee.name} 様
いつもお疲れ様です。管理者より日報提出の催促通知が届いています。

対象日： ${formattedDate}

以下のログインURLよりシステムにアクセスし、至急ご提出をお願いいたします。

----------------------------------------
■ ログインURL
${loginUrl}
----------------------------------------

※すでに提出済みの場合は行き違いですのでご容赦ください。
本メールはシステムより自動送信されています。
`;

      await sendMailHelper({
        to: employee.email,
        subject: `【催促】${formattedDate}の日報提出のお願い`,
        text: mailText,
        fromName: '日報管理事務局'
      });
      console.log(`Sent remind email to ${employee.email}`);
    } catch (mailErr) {
      console.error('Email remind error', mailErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('sendRemindNotification error', err);
    res.status(500).json({ error: err.message });
  }
});


