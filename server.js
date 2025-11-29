import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import sgMail from "@sendgrid/mail";

dotenv.config();

// --- SendGrid aktivieren ---
sgMail.setApiKey(process.env.SENDGRID_KEY);

const app = express();
app.use(express.json());
app.use(cors());

// ------- MongoDB Connection -------
const client = new MongoClient(process.env.MONGO_URL);
await client.connect();
const db = client.db("treedelivery");
const orders = db.collection("orders");

// ------- Allowed ZIPs -------
const allowedZips = [
  "57072", "57074", "57076", "57078", "57080",
  "57223", "57234", "57250", "57258", "57271",
  "57290", "57299",
  "57319", "57334", "57339",
  "35708", "35683", "35684", "35685",
  "35745", "57555", "57399", "57610"
];

// ------- Kunden-ID Generator -------
function generateId() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ------- Bestellung speichern -------
app.post("/order", async (req, res) => {
  try {
    const data = req.body;

    // PLZ check
    if (!allowedZips.includes(data.zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets" });
    }

    // E-Mail check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: "Ungültige E-Mail" });
    }

    const customerId = generateId();

    const order = {
      ...data,
      customerId,
      createdAt: new Date()
    };

    await orders.insertOne(order);

    // --- Bestellbestätigung senden (SendGrid) ---
    try {
      await sgMail.send({
        to: data.email,
        from: process.env.EMAIL_FROM, // MUSS in Render gesetzt werden!
        subject: "Ihre TreeDelivery-Bestellung 🎄",
        text: `
Hallo ${data.street || "Kunde"},

vielen Dank für Ihre Bestellung bei TreeDelivery!

Ihre Bestelldaten:
- Baumgröße: ${data.size}
- Straße & Hausnummer: ${data.street}
- PLZ / Ort: ${data.zip} ${data.city}
- Wunschtermin: ${data.date || "Kein spezieller Termin gewählt"}
- Kunden-ID: ${customerId}

Frohe Weihnachten!
Ihr TreeDelivery-Team
        `.trim()
      });

    } catch (mailErr) {
      console.error("Fehler beim Mailversand:", mailErr);

      return res.json({
        success: true,
        customerId,
        mailWarning: "Bestellung gespeichert, aber SendGrid konnte die E-Mail nicht senden."
      });
    }

    res.json({ success: true, customerId });

  } catch (err) {
    console.error("Fehler in /order:", err);
    res.status(500).json({ error: "Serverfehler bei der Bestellung" });
  }
});

// ------- Bestellung abrufen -------
app.post("/lookup", async (req, res) => {
  try {
    const { email, customerId } = req.body;

    const result = await orders.findOne({ email, customerId });

    if (!result) {
      return res.status(404).json({ error: "Keine Bestellung gefunden" });
    }

    res.json(result);
  } catch (err) {
    console.error("Fehler in /lookup:", err);
    res.status(500).json({ error: "Serverfehler bei der Suche" });
  }
});

// ------- Health-Check -------
app.get("/", (req, res) => {
  res.send("TreeDelivery Backend läuft ✅");
});

// ------- Start Server -------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("Server läuft auf Port", port);
});
