const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const files = ['app.js', 'app-v4.js', 'seed.js', 'system-admin.js', 'auth-action.html'];
const backup = {};

// 接続設定（以前正常に動作していた正しい接続情報）
const config = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0",
    measurementId: "G-WYE7P1PP8H"
};

const newConfig = `const firebaseConfig = {
    apiKey: "${config.apiKey}",
    authDomain: "${config.authDomain}",
    projectId: "${config.projectId}",
    storageBucket: "${config.storageBucket}",
    messagingSenderId: "${config.messagingSenderId}",
    appId: "${config.appId}",
    measurementId: "${config.measurementId}"
};`;

// デプロイ前に、最新の app.js と style.css を v4 用のファイル名で複製する
// ※ 現在は app-v4.js / style-v4.css を直接編集しているため、上書きを防ぐためにコメントアウトします。
/*
try {
    fs.copyFileSync(
        path.join(__dirname, 'public', 'app.js'),
        path.join(__dirname, 'public', 'app-v4.js')
    );
    fs.copyFileSync(
        path.join(__dirname, 'public', 'style.css'),
        path.join(__dirname, 'public', 'style-v4.css')
    );
    console.log("📝 複製完了: app.js -> app-v4.js, style.css -> style-v4.css");
} catch (e) {
    console.error("❌ ファイル複製エラー:", e.message);
}
*/

console.log("🔄 デプロイ準備: Firebaseの接続設定を一時的に注入します...");

// 1. バックアップを作成し、設定を注入
files.forEach(filename => {
    const filePath = path.join(__dirname, 'public', filename);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        backup[filename] = content;
        
        const injected = content.replace(
            /const firebaseConfig = \{[\s\S]*?\};/,
            newConfig
        );
        fs.writeFileSync(filePath, injected, 'utf-8');
        console.log(`✅ 注入完了: ${filename}`);
    }
});

// 2. デプロイの実行
try {
    console.log("🚀 Firebase Hosting にデプロイしています...");
    // firebase-toolsを実行。Windows環境で実行エラーを回避するためnpx.cmdを使用
    execSync('npx.cmd firebase deploy --only hosting', { stdio: 'inherit' });
    console.log("🎉 デプロイが成功しました！");
} catch (error) {
    console.error("❌ デプロイ中にエラーが発生しました:", error.message);
} finally {
    // 3. 元に戻す
    console.log("🧹 接続設定を元（空のプレースホルダー）に戻しています...");
    files.forEach(filename => {
        const filePath = path.join(__dirname, 'public', filename);
        if (backup[filename]) {
            fs.writeFileSync(filePath, backup[filename], 'utf-8');
            console.log(`✅ 復元完了: ${filename}`);
        }
    });
}
