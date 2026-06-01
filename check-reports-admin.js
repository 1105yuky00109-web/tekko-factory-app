const admin = require('firebase-admin');

// ADC (Application Default Credentials) が使えるか試す
try {
    admin.initializeApp({
        projectId: "weekly-report-93e5f"
    });
} catch (e) {
    console.error("Initialization error:", e);
}

const db = admin.firestore();

async function run() {
    console.log("Loading reports from Firestore using admin SDK...");
    const q = db.collection("reports");
    const snapshot = await q.get();
    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    console.log(`Found ${list.length} reports:`);
    list.forEach(r => {
        console.log(`Report ID: ${r.id}`);
        console.log(`  Author: ${r.author}`);
        console.log(`  Week: ${r.week}`);
        console.log(`  Updated At: ${r.updatedAt ? (r.updatedAt.toDate ? r.updatedAt.toDate().toISOString() : r.updatedAt) : 'N/A'}`);
        // データの概要だけ表示
        if (r.days) {
            console.log(`  Days keys: ${Object.keys(r.days).join(', ')}`);
        }
        console.log("-----------------------------------------");
    });
    process.exit(0);
}

run().catch(error => {
    console.error("Execution error:", error);
    process.exit(1);
});
