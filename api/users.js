// /api/users.js
// একটাই Vercel Serverless Function — Firebase Admin SDK দিয়ে ইউজার তৈরি, আপডেট ও ডিলিট,
// তিনটাই এই একই ফাইল থেকে হয়। req.body.action দিয়ে বোঝা যায় কোন কাজ করতে হবে:
//   action: 'create' | 'update' | 'delete'
// এই তিনটা কাজ ক্লায়েন্ট সাইড থেকে করা যায় না, কারণ createUserWithEmailAndPassword() /
// deleteUser() / updateUser() ব্রাউজারে চালালে বর্তমান অ্যাডমিনের সেশন প্রতিস্থাপিত হয়ে যায়
// অথবা অন্য ইউজারের Auth অ্যাকাউন্ট ছোঁয়ার অনুমতিই থাকে না — তাই Admin SDK দিয়ে সার্ভার-সাইডে করা হয়।

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function createUser(body, res) {
  const {
    name, employeeId, email, phone, designation,
    department, role, factory, status, tempPassword,
  } = body;

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

  // ধাপ ১: Firebase Auth-এ আসল লগইন-যোগ্য অ্যাকাউন্ট তৈরি
  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName: name,
    disabled: status === 'Inactive' || status === 'Locked',
  });

  // ধাপ ২: Firestore-এ প্রোফাইল তথ্য সংরক্ষণ — Auth UID-কে ডকুমেন্ট আইডি হিসেবে ব্যবহার করা হয়,
  // যাতে Edit/Delete User টেবিল ও sidebar-এর department filter দুটোই এই একই রেকর্ড পড়তে পারে
  const db = admin.firestore();
  await db.collection('users').doc(userRecord.uid).set({
    uid: userRecord.uid,
    name, employeeId, email, phone: phone || '',
    designation: designation || '', department: department || '',
    role: role || '', factory: factory || '', status: status || 'Active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.status(200).json({ success: true, uid: userRecord.uid, tempPassword: password });
}

async function updateUser(body, res) {
  const { uid, name, employeeId, phone, designation, department, role, factory, status } = body;

  if (!uid) return res.status(400).json({ error: 'uid আবশ্যক' });
  if (!name || !employeeId) return res.status(400).json({ error: 'নাম ও Employee ID আবশ্যক' });

  // Status বদলালে Firebase Auth-এর disabled ফ্ল্যাগও সিঙ্ক করা হয় (Active <-> Inactive/Locked)
  const disabled = status === 'Inactive' || status === 'Locked';
  await admin.auth().updateUser(uid, { displayName: name, disabled });

  const db = admin.firestore();
  await db.collection('users').doc(uid).update({
    name, employeeId, phone: phone || '',
    designation: designation || '', department: department || '',
    role: role || '', factory: factory || '', status: status || 'Active',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.status(200).json({ success: true, uid });
}

async function deleteUser(body, res) {
  const { uid } = body;
  if (!uid) return res.status(400).json({ error: 'uid আবশ্যক' });

  // Auth থেকে অ্যাকাউন্ট মুছে দেওয়া (সাথে সাথে লগইন অ্যাক্সেস বন্ধ হয়ে যায়)
  try {
    await admin.auth().deleteUser(uid);
  } catch (err) {
    // ইতিমধ্যে না থাকলে সমস্যা ধরা হচ্ছে না, যাতে Firestore-এর পুরনো প্রোফাইল আটকে না থাকে
    if (err.code !== 'auth/user-not-found') throw err;
  }

  const db = admin.firestore();
  await db.collection('users').doc(uid).delete();

  return res.status(200).json({ success: true, uid });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const action = body.action;

    if (action === 'create') return await createUser(body, res);
    if (action === 'update') return await updateUser(body, res);
    if (action === 'delete') return await deleteUser(body, res);

    return res.status(400).json({ error: 'অজানা action — create, update বা delete হতে হবে' });

  } catch (err) {
    console.error('users API error:', err);
    // Firebase Admin SDK-এর কমন এরর কোডগুলো বাংলায় অনুবাদ করে দেওয়া
    let message = err.message || 'অজানা সমস্যা';
    if (err.code === 'auth/email-already-exists') {
      message = 'এই Email দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট আছে';
    } else if (err.code === 'auth/invalid-password') {
      message = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে';
    } else if (err.code === 'auth/user-not-found') {
      message = 'এই ইউজার Firebase Auth-এ খুঁজে পাওয়া যায়নি';
    }
    return res.status(500).json({ error: message });
  }
};
