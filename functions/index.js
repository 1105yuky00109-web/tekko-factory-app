// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
require('dotenv').config();

admin.initializeApp();
const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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

exports.api = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  const {
    companyName,
    plan, // stripe price id
    adminName,
    adminEmail,
    password,
  } = req.body;
  if (!companyName || !plan || !adminEmail || !adminName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let companyId;
  try {
    companyId = await generateUniqueCompanyId(db);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  // Create Stripe Checkout Session
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: plan, quantity: 1 }],
      customer_email: adminEmail,
      metadata: {
        companyName,
        companyId,
        adminName,
        adminEmail,
        password,
        plan,
      },
      success_url: `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/onboarding-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/onboarding.html`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error('Stripe error', e);
    res.status(500).json({ error: e.message });
  }
});

// ------------------------------------------------------------
// 2. Stripe webhook handler
// ------------------------------------------------------------
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET; // set in .env
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  // Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const {
      companyName,
      companyId,
      adminName,
      adminEmail,
      password,
    } = session.metadata;
    // Retrieve planId from display_items or line_items or fallback
    const planId = (session.line_items && session.line_items.data && session.line_items.data[0] && session.line_items.data[0].price && session.line_items.data[0].price.id) ||
                   (session.display_items && session.display_items[0] && session.display_items[0].price && session.display_items[0].price.id) ||
                   session.metadata.plan ||
                   '';
    // Create Firebase Auth user for admin
    let adminUid;
    try {
      const userRecord = await admin.auth().createUser({
        email: adminEmail,
        password: password || undefined,
        displayName: adminName,
      });
      adminUid = userRecord.uid;
    } catch (e) {
      console.error('Auth user creation failed', e);
      // If user already exists, fetch uid
      const userRecord = await admin.auth().getUserByEmail(adminEmail);
      adminUid = userRecord.uid;
    }
    // Create company document
    const companyRef = db.collection('companies').doc(companyId);
    const planMap = {
      'price_1TaP0sJdCQkwItViebEBEhJa': { name: 'スタータープラン', maxUsers: 20 },
      'price_1TaP6jJdCQkwItViM7RoBetq': { name: 'スタンダードプラン', maxUsers: 100 },
    };
    const planInfo = planMap[planId] || {};
    await companyRef.set({
      companyId,
      companyName,
      planId,
      planName: planInfo.name || 'カスタム',
      maxUsers: planInfo.maxUsers,
      ownerUid: adminUid,
      adminEmails: [adminEmail],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
    });
    // Store subscription info
    const subId = session.subscription || 'sub_default';
    await companyRef.collection('subscriptions').doc(subId).set({
      subscriptionId: session.subscription || null,
      status: session.payment_status || null,
      currentPeriodEnd: session.current_period_end || null,
    });
    console.log(`Company ${companyId} created for ${adminEmail}`);

    // Gmailによる登録完了メール送信処理
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;

      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `日報アプリ管理部 <${smtpUser}>`,
        to: adminEmail,
        subject: `【重要】${companyName}様 アカウント登録完了のお知らせ`,
        text: `${adminName} 様

この度はシステムをご契約いただき、誠にありがとうございます。
管理者様のアカウントおよび会社データのセットアップが完了いたしました。

以下のログイン情報にてシステムをご利用いただけます。

----------------------------------------
■ ログインURL
${loginUrl}

■ 管理者ログイン用メールアドレス
${adminEmail}
----------------------------------------
※ パスワードは登録時にご自身で設定された任意のパスワードとなります。

ログイン後、管理者メニューよりユーザー（社員）の追加や予定表の設定を行ってください。

本メールはシステムより自動送信されています。
`,
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        await transporter.sendMail(mailOptions);
        console.log(`[Email] 登録完了メールを ${adminEmail} 宛に送信しました。`);
      } else {
        console.log('--- [SMTP_PASSが未設定のためメール送信をシミュレートしました] ---');
        console.log('宛先:', adminEmail);
        console.log('件名:', mailOptions.subject);
        console.log('本文:\n', mailOptions.text);
        console.log('------------------------------------------------------------------');
      }
    } catch (mailErr) {
      console.error('メール送信処理中にエラーが発生しました:', mailErr);
    }
  }
  res.json({ received: true });
});

// ------------------------------------------------------------
// 3. addEmployee (管理者による社員追加API)
// ------------------------------------------------------------
exports.addEmployee = functions.https.onRequest(async (req, res) => {
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
        displayName: employeeName
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

    // 5. 社員宛ての登録案内メール自動送信
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;
      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `週次日報アプリ管理部 <${smtpUser}>`,
        to: employeeEmail,
        subject: '【重要】週次日報＆予定管理システム アカウント登録完了のお知らせ',
        text: `${employeeName} 様

いつもシステムをご利用いただき、ありがとうございます。
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
`,
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });
        await transporter.sendMail(mailOptions);
        console.log(`[Email] 社員宛て登録案内メールを ${employeeEmail} 宛に送信しました。`);
      } else {
        console.log('--- [SMTP_PASSが未設定のため社員宛てメール送信をシミュレートしました] ---');
        console.log('宛先:', employeeEmail);
        console.log('件名:', mailOptions.subject);
        console.log('本文:\n', mailOptions.text);
        console.log('------------------------------------------------------------------');
      }
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
exports.checkEmailRegistered = functions.https.onRequest(async (req, res) => {
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

// onReportWrite トリガーは承認フロー廃止に伴い不要となったため削除

// ------------------------------------------------------------
// 6. sendRemindNotification (管理者からの日報催促通知API)
// ------------------------------------------------------------
exports.sendRemindNotification = functions.https.onRequest(async (req, res) => {
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

    // 2. メールでの催促送信
    try {
      const nodemailer = require('nodemailer');
      const smtpUser = 'areva.noreply@gmail.com';
      const smtpPass = process.env.SMTP_PASS;
      const loginUrl = `${process.env.HOST_URL || 'https://weekly-report-93e5f.web.app'}/index.html`;

      const mailOptions = {
        from: `鉄骨日報管理システム <${smtpUser}>`,
        to: employee.email,
        subject: `【催促】${formattedDate}の日報提出のお願い`,
        text: `${employee.name} 様
いつもお疲れ様です。管理者より日報提出の催促通知が届いています。

対象日： ${formattedDate}

以下のログインURLよりシステムにアクセスし、至急ご提出をお願いいたします。

----------------------------------------
■ ログインURL
${loginUrl}
----------------------------------------

※すでに提出済みの場合は行き違いですのでご容赦ください。
本メールはシステムより自動送信されています。
`
      };

      if (smtpPass) {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: smtpUser,
            pass: smtpPass
          }
        });
        await transporter.sendMail(mailOptions);
        console.log(`Sent remind email to ${employee.email}`);
      }
    } catch (mailErr) {
      console.error('Email remind error', mailErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('sendRemindNotification error', err);
    res.status(500).json({ error: err.message });
  }
});

