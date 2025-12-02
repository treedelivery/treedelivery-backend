import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import sgMail from "@sendgrid/mail";

dotenv.config();

// ---- SendGrid initialisieren ----
if (!process.env.SENDGRID_KEY) {
  console.error("WARNUNG: SENDGRID_KEY ist nicht gesetzt!");
} else {
  sgMail.setApiKey(process.env.SENDGRID_KEY);
}

const app = express();
app.use(express.json());
app.use(cors());

// ------- MongoDB Connection -------
if (!process.env.MONGO_URL) {
  console.error("FEHLER: MONGO_URL ist nicht gesetzt!");
  process.exit(1);
}

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
    console.log("Neue Bestellung:", data);

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

    // Bestätigungsmail an Kunden schicken
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      await sgMail.send({
        to: data.email,
        from: fromAddress,
        subject: "Deine TreeDelivery-Bestellung 🎄",
        text: `
Hallo ${data.street || "Kunde"},

vielen Dank für deine Bestellung bei TreeDelivery!

Deine Bestelldaten:
- Baumgröße: ${data.size}
- Straße & Hausnummer: ${data.street}
- PLZ / Ort: ${data.zip} ${data.city}
- Wunschtermin: ${data.date || "Kein spezieller Termin gewählt"}
- Kunden-ID: ${customerId}

Mit deiner Kunden-ID kannst du deine Bestellung später auf unserer Website unter "Meine Bestellung" aufrufen.

Die Bezahlung erfolgt bar bei Lieferung.

Frohe Weihnachten!
Dein TreeDelivery-Team
        `.trim()
      });

      // Optional: Kopie an Admin
      if (process.env.ADMIN_EMAIL) {
        await sgMail.send({
          to: process.env.ADMIN_EMAIL,
          from: fromAddress,
          subject: `Neue TreeDelivery-Bestellung – ${customerId}`,
          text: `Neue Bestellung:\n\n${JSON.stringify(order, null, 2)}`
        });
      }

    } catch (mailErr) {
      console.error("Fehler beim Mailversand via SendGrid:", mailErr);
      return res.json({
        success: true,
        customerId,
        mailWarning: "Bestellung gespeichert, aber E-Mail konnte nicht gesendet werden."
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

// ------- Bestellung aktualisieren -------
app.post("/update", async (req, res) => {
  try {
    const { email, customerId, size, street, zip, city, date } = req.body;

    // Pflichtfelder prüfen
    if (!email || !customerId || !size || !street || !zip || !city) {
      return res.status(400).json({ error: "Fehlende Pflichtfelder" });
    }

    // E-Mail Format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Ungültige E-Mail" });
    }

    // PLZ im Liefergebiet
    if (!allowedZips.includes(zip)) {
      return res.status(400).json({ error: "PLZ außerhalb des Liefergebiets" });
    }

    // Logging für Debug
    console.log("Update-Request:", { email, customerId, size, street, zip, city });

    // Robuste findOneAndUpdate mit Fallback für verschiedene Treiber-Versionen
    const result = await orders.findOneAndUpdate(
      { email, customerId },
      {
        $set: {
          size,
          street,
          zip,
          city,
          date: date || null
        }
      },
      {
        // Für MongoDB Driver v4+: returnDocument: "after"
        // Für MongoDB Driver v3.x: returnOriginal: false
        // Beide zusammen für maximale Kompatibilität
        returnDocument: "after",
        returnOriginal: false
      }
    );

    console.log("Update-Result:", result);

    // Prüfen, ob Update erfolgreich war (mehrere Wege je nach Treiber)
    let updatedOrder = null;
    let updateSuccessful = false;

    if (result.value) {
      // Erfolgreich: aktualisiertes Dokument vorhanden
      updatedOrder = result.value;
      updateSuccessful = true;
    } else if (result.matchedCount && result.matchedCount > 0) {
      // Fallback: Dokument gefunden und aktualisiert, aber value ist null (älterer Treiber)
      // Hole das aktualisierte Dokument nochmal
      updatedOrder = await orders.findOne({ email, customerId });
      updateSuccessful = !!updatedOrder;
      console.log("Fallback: Dokument nach Update geholt:", updatedOrder);
    } else {
      // Kein Dokument gefunden
      return res.status(404).json({ error: "Keine Bestellung gefunden" });
    }

    if (!updateSuccessful) {
      return res.status(404).json({ error: "Keine Bestellung gefunden" });
    }

    // Bestätigungsmail für Update
    try {
      const fromAddress = process.env.EMAIL_FROM || "bestellung@treedelivery.de";

      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: "Deine TreeDelivery-Bestellung wurde aktualisiert 🎄",
        text: `
Hallo ${street || "Kunde"},

deine TreeDelivery-Bestellung wurde soeben aktualisiert.

Aktuelle Bestelldaten:
- Kunden-ID: ${customerId}
- Baumgröße: ${size}
- Adresse: ${street}, ${zip} ${city}
- Lieferdatum: ${date || "Kein spezieller Termin gewählt"}

Die Bezahlung erfolgt weiterhin bar bei Lieferung.

Frohe Weihnachten!
Dein TreeDelivery-Team
        `.trim()
      });

      if (process.env.ADMIN_EMAIL) {
        await sgMail.send({
          to: process.env.ADMIN_EMAIL,
          from: fromAddress,
          subject: `TreeDelivery – Bestellung aktualisiert – ${customerId}`,
          text: `Aktualisierte Bestellung:\n\n${JSON.stringify(updatedOrder, null, 2)}`
        });
      }
    } catch (mailErr) {
      console.error("Fehler beim Mailversand (Update):", mailErr);
      return res.json({
        success: true,
        order: updatedOrder,
        mailWarning: "Bestellung aktualisiert, aber E-Mail konnte nicht gesendet werden."
      });
    }

    res.json({ success: true, order: updatedOrder });

  } catch (err) {
    console.error("Fehler in /update:", err);
    res.status(500).json({ error: "Serverfehler bei der Aktualisierung" });
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
