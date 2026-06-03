// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// 注意: この設定値は build-inject.js によって置換注入されます
const firebaseConfig = {
    apiKey: "AIzaSyATXg0kIf7_iYDcRslbH-C0zyCC_dtFmI4",
    authDomain: "tekko-factory-app.firebaseapp.com",
    projectId: "tekko-factory-app",
    storageBucket: "tekko-factory-app.firebasestorage.app",
    messagingSenderId: "354843914657",
    appId: "1:354843914657:web:fbed32a7bae1c74af35be0"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// バックグラウンド通知を受信したときの処理
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    
    const notificationTitle = payload.notification.title || '週報システムからの通知';
    const notificationOptions = {
        body: payload.notification.body || '',
        icon: 'icon-192.png',
        badge: 'icon-192.png',
        data: payload.data || {}
    };

    // デスクトップアイコン等の通知バッジを表示 (Badging API)
    if ('setAppBadge' in navigator) {
        navigator.setAppBadge(1).catch(err => console.error('Error setting app badge:', err));
    }

    return self.registration.showNotification(notificationTitle, notificationOptions);
});

// 通知をクリックしたときの処理
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const urlToOpen = new URL('./index.html', self.location.origin).href;

    const promiseChain = clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    }).then((windowClients) => {
        let matchingClient = null;

        for (let i = 0; i < windowClients.length; i++) {
            const windowClient = windowClients[i];
            if (windowClient.url === urlToOpen) {
                matchingClient = windowClient;
                break;
            }
        }

        if (matchingClient) {
            return matchingClient.focus();
        } else {
            return clients.openWindow(urlToOpen);
        }
    });

    // バッジをクリアする
    if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(err => console.error('Error clearing app badge:', err));
    }

    event.waitUntil(promiseChain);
});
