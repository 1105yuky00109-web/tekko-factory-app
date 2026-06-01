const admin = require('firebase-admin');

admin.initializeApp({
  projectId: "weekly-report-93e5f"
});

const auth = admin.auth();

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Usage: node change-user-password.js <email> <newPassword>");
  process.exit(1);
}

async function changePassword() {
  console.log(`Attempting to change password for ${email}...`);
  try {
    const user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, {
      password: newPassword
    });
    console.log(`Successfully updated password for user: ${email} (UID: ${user.uid})`);
  } catch (error) {
    console.error("Error updating password:", error);
  }
}

changePassword();
