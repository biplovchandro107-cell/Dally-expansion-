// /api/create-user.js
// Vercel Serverless Function — Firebase Admin SDK দিয়ে server-side এ
// আসল লগইন-যোগ্য Firebase Auth ইউজার তৈরি করে। এটা ক্লায়েন্ট সাইড থেকে
// করা যায় না কারণ createUserWithEmailAndPassword() ব্রাউজারে চালালে
// বর্তমান অ্যাডমিনের সেশন প্রতিস্থাপিত হয়ে যায়।

const admin = require('firebase-admin');

// একাধিক ফাংশন কল / cold start-এ যেন বারবার initializeApp() না হয়
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

module.exports = async function handler(req, res) {
  // শুধু POST মেথড গ্রহণযোগ্য
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      name, employeeId, email, phone, designation,
      department, role, factory, status, tempPassword,
    } = req.body || {};

    // ---- ভ্যালিডেশন ----
    if (!name || !employeeId || !email) {
      return res.status(400).json({ error: 'নাম, Employee ID ও Email আবশ্যক' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'সঠিক Email দিন' });
    }
    const password = (tempPassword && String(tempPassword).trim()) || Math.random().toString(36).slice(-8);
    if (password.length < 6) {
      return res.status(400).json({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে (Firebase-এর নিয়ম)' });
    }

    // ---- ধাপ ১: Firebase Auth-এ আসল লগইন-যোগ্য অ্যাকাউন্ট তৈরি ----
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
      disabled: status === 'Inactive' || status === 'Locked',
    });

    // ---- ধাপ ২: Firestore-এ প্রোফাইল তথ্য সংরক্ষণ ----
    // (আগের মতোই 'users' কালেকশনে, কিন্তু এবার Auth UID-কে ডকুমেন্ট আইডি হিসেবে ব্যবহার করছি)
    const db = admin.firestore();
    await db.collection('users').doc(userRecord.uid).set({
      uid: userRecord.uid,
      name, employeeId, email, phone: phone || '',
      designation: designation || '', department: department || '',
      role: role || '', factory: factory || '', status: status || 'Active',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      uid: userRecord.uid,
      tempPassword: password,
    });

  } catch (err) {
    console.error('create-user error:', err);
    // Firebase Admin SDK-এর কমন এরর কোডগুলো বাংলায় অনুবাদ করে দেওয়া
    let message = err.message || 'অজানা সমস্যা';
    if (err.code === 'auth/email-already-exists') {
      message = 'এই Email দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে';
    } else if (err.code === 'auth/invalid-password') {
      message = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে';
    }
    return res.status(500).json({ error: message });
  }
};
