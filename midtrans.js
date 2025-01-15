const express = require("express");
const cors = require("cors");
const midtransClient = require("midtrans-client");
const admin = require("firebase-admin");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Firebase Admin SDK
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Inisialisasi Midtrans Snap
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Endpoint untuk membuat transaksi
app.post("/create-transaction", async (req, res) => {
  const { email, amount } = req.body;

  try {
    // Cari pengguna di Firebase
    const userQuery = await db
      .collection("customers")
      .where("email", "==", email)
      .get();
    if (userQuery.empty) {
      return res.status(404).json({ error: "User not found" });
    }

    const userDoc = userQuery.docs[0];
    const userData = userDoc.data();

    // Buat transaksi Midtrans
    const parameter = {
      transaction_details: {
        order_id: `ORDER-${Date.now()}`,
        gross_amount: amount,
      },
      customer_details: {
        email: userData.email,
        first_name: userData.username,
      },
    };

    const transaction = await snap.createTransaction(parameter);
    res.json({ token: transaction.token });
  } catch (error) {
    console.error("Error creating transaction:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint untuk menangani notifikasi dari Midtrans
app.post("/midtrans-notification", async (req, res) => {
  const notification = req.body;

  try {
    // Verifikasi notifikasi dari Midtrans
    const statusResponse = await snap.transaction.notification(notification);
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;
    const grossAmount = statusResponse.gross_amount;

    console.log(`Transaction status: ${transactionStatus}`);
    console.log(`Fraud status: ${fraudStatus}`);

    // Jika pembayaran berhasil
    if (transactionStatus === "capture" && fraudStatus === "accept") {
      const email = statusResponse.customer_details.email;

      // Dapatkan data pengguna dari Firebase
      const userQuery = await db
        .collection("customers")
        .where("email", "==", email)
        .get();
      if (userQuery.empty) {
        return res.status(404).json({ error: "User not found" });
      }

      const userDoc = userQuery.docs[0];
      const userData = userDoc.data();
      const currentBalance = parseFloat(userData.balance) || 0;
      const newBalance = currentBalance + parseFloat(grossAmount);

      // Perbarui saldo pengguna di Firebase
      await db.collection("customers").doc(userDoc.id).update({
        balance: newBalance,
      });

      console.log(`Saldo pengguna ${email} diperbarui menjadi: ${newBalance}`);
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Error handling Midtrans notification:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
