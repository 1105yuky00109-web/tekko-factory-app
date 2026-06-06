// Netlifyビルド時に環境変数をapp.jsおよびseed.jsに注入するスクリプト
// node build-inject.js で実行

const fs = require('fs');
const path = require('path');

// .envファイルから環境変数をロード（ローカルビルド用）
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split('=');
            if (parts.length >= 2) {
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                process.env[key] = value;
            }
        }
    });
}

// 環境変数からFirebase設定を取得
const config = {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
};

// firebaseConfigブロックを環境変数の値で置き換える
const newConfig = `const firebaseConfig = {
    apiKey: "${config.apiKey}",
    authDomain: "${config.authDomain}",
    projectId: "${config.projectId}",
    storageBucket: "${config.storageBucket}",
    messagingSenderId: "${config.messagingSenderId}",
    appId: "${config.appId}"
};`;

const injectTo = (filename) => {
    const filePath = path.join(__dirname, 'public', filename);
    if (!fs.existsSync(filePath)) {
        console.log(`⚠️ ファイルが見つかりません: ${filename}`);
        return;
    }
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // 既存のfirebaseConfigブロックを正規表現で置換
    content = content.replace(
        /const firebaseConfig = \{[\s\S]*?\};/,
        newConfig
    );
    
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`✅ Firebase設定の注入が完了しました: ${filename}`);
};

injectTo('app.js');
injectTo('app-v4.js');
injectTo('seed.js');
injectTo('system-admin.js');
injectTo('firebase-messaging-sw.js');
injectTo('auth-action.html');
injectTo('invoice.html');
injectTo('change-plan.html');
injectTo('onboarding.html');
injectTo('onboarding-success.html');

