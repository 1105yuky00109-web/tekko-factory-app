const admin = require('firebase-admin');

admin.initializeApp({
  projectId: "weekly-report-93e5f"
});

const db = admin.firestore();

async function checkCompanies() {
  console.log("Firestore 'companies' collection checking...");
  try {
    const snapshot = await db.collection('companies').get();
    if (snapshot.empty) {
      console.log("No companies found.");
      return;
    }
    snapshot.forEach(doc => {
      console.log(`Document ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
      console.log("--------------------");
    });
  } catch (error) {
    console.error("Error reading Firestore:", error);
  }
}

checkCompanies();
