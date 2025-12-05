const API = "/api/admin";

// ---------------------------------------------------------------------
// Hilfsfunktion: Auth-Header
// ---------------------------------------------------------------------
function auth() {
  return { "authorization": "Bearer " + localStorage.getItem("token") };
}

// ---------------------------------------------------------------------
// LOGIN-Seite
// ---------------------------------------------------------------------
const loginForm = document.getElementById("loginForm");

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    try {
      const res = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (data.success && data.token) {
        localStorage.setItem("token", data.token);
        window.location.href = "/admin/dashboard.html";
      } else {
        alert("Login fehlgeschlagen!");
      }
    } catch (err) {
      console.error(err);
      alert("Fehler beim Login.");
    }
  });
}

// ---------------------------------------------------------------------
// DASHBOARD-Seite
// ---------------------------------------------------------------------
const dashboardRoot = document.getElementById("dashboard");

if (dashboardRoot) {
  // Wenn kein Token -> zurück zum Login
  if (!localStorage.getItem("token")) {
    window.location.href = "/admin/login.html";
  } else {
    initDashboard();
  }
}

async function initDashboard() {
  const logoutBtn = document.getElementById("logoutBtn");
  logoutBtn?.addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/admin/login.html";
  });

  // Events für Filter & Formulare
  document.getElementById("filterDateBtn")?.addEventListener("click", () => {
    const date = document.getElementById("filter-date").value;
    if (!date) {
      alert("Bitte ein Datum auswählen.");
      return;
    }
    loadOrders(date);
  });

  document.getElementById("showAllBtn")?.addEventListener("click", () => {
    document.getElementById("filter-date").value = "";
    loadOrders();
  });

  document.getElementById("priceForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await savePrices();
  });

  document.getElementById("deliveryMailForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await sendDeliveryMail();
  });

  // Initial laden
  await loadPrices();
  await loadOrders();
}

// ---------------------------------------------------------------------
// Preise laden / speichern
// ---------------------------------------------------------------------
async function loadPrices() {
  const msg = document.getElementById("priceMessage");
  msg.textContent = "";

  try {
    const res = await fetch(`${API}/prices`, {
      headers: auth()
    });

    if (!res.ok) {
      msg.textContent = "Fehler beim Laden der Preise.";
      return;
    }

    const prices = await res.json();
    document.getElementById("price-small").value = prices.small;
    document.getElementById("price-medium").value = prices.medium;
    document.getElementById("price-large").value = prices.large;
    document.getElementById("price-xl").value = prices.xl;

  } catch (err) {
    console.error(err);
    msg.textContent = "Fehler beim Laden der Preise.";
  }
}

async function savePrices() {
  const msg = document.getElementById("priceMessage");
  msg.textContent = "";

  const small = document.getElementById("price-small").value;
  const medium = document.getElementById("price-medium").value;
  const large = document.getElementById("price-large").value;
  const xl = document.getElementById("price-xl").value;

  try {
    const res = await fetch(`${API}/prices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth()
      },
      body: JSON.stringify({ small, medium, large, xl })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      msg.textContent = data.error || "Fehler beim Speichern.";
      return;
    }

    msg.textContent = "Preise erfolgreich gespeichert.";

  } catch (err) {
    console.error(err);
    msg.textContent = "Fehler beim Speichern der Preise.";
  }
}

// ---------------------------------------------------------------------
// Bestellungen laden
// date (optional, 'YYYY-MM-DD') -> dann /deliveries/:date
// ---------------------------------------------------------------------
async function loadOrders(date) {
  const msg = document.getElementById("ordersMessage");
  const tbody = document.getElementById("ordersBody");
  msg.textContent = "";
  tbody.innerHTML = "<tr><td colspan='9'>Lade...</td></tr>";

  let url = `${API}/orders`;
  if (date) {
    url = `${API}/deliveries/${encodeURIComponent(date)}`;
  }

  try {
    const res = await fetch(url, {
      headers: auth()
    });

    if (!res.ok) {
      tbody.innerHTML = "";
      msg.textContent = "Fehler beim Laden der Bestellungen.";
      return;
    }

    const list = await res.json();

    if (!list.length) {
      tbody.innerHTML = "<tr><td colspan='9'>Keine Bestellungen gefunden.</td></tr>";
      return;
    }

    tbody.innerHTML = "";

    list.forEach(order => {
      const tr = document.createElement("tr");
      const created = order.createdAt ? new Date(order.createdAt) : null;

      tr.innerHTML = `
        <td>${order.customerId || ""}</td>
        <td>${order.name || ""}</td>
        <td>${order.email || ""}</td>
        <td>${order.size || ""}</td>
        <td>${order.date || ""}</td>
        <td>${order.status || ""}</td>
        <td>${order.street || ""}, ${order.zip || ""} ${order.city || ""}</td>
        <td>${order.specialRequests || ""}</td>
        <td>
          <select class="status-select">
            <option value="">Status wählen</option>
            <option value="offen">offen</option>
            <option value="in Bearbeitung">in Bearbeitung</option>
            <option value="Lieferung heute geplant">Lieferung heute geplant</option>
            <option value="abgeschlossen">abgeschlossen</option>
            <option value="storniert">storniert</option>
          </select>
          <button type="button" class="status-btn">Speichern</button>
        </td>
      `;

      const select = tr.querySelector(".status-select");
      const btn = tr.querySelector(".status-btn");

      btn.addEventListener("click", async () => {
        const newStatus = select.value;
        if (!newStatus) {
          alert("Bitte einen Status auswählen.");
          return;
        }
        await updateStatus(order.customerId, newStatus);
        await loadOrders(date); // Liste neu laden
      });

      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
    tbody.innerHTML = "";
    msg.textContent = "Fehler beim Laden der Bestellungen.";
  }
}

// ---------------------------------------------------------------------
// Status ändern
// ---------------------------------------------------------------------
async function updateStatus(customerId, status) {
  try {
    const res = await fetch(`${API}/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth()
      },
      body: JSON.stringify({ customerId, status })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(data.error || "Fehler beim Aktualisieren des Status.");
      return;
    }

    alert("Status aktualisiert.");
  } catch (err) {
    console.error(err);
    alert("Fehler beim Aktualisieren des Status.");
  }
}

// ---------------------------------------------------------------------
// Lieferzeit-E-Mail senden
// ---------------------------------------------------------------------
async function sendDeliveryMail() {
  const msg = document.getElementById("deliveryMessage");
  msg.textContent = "";

  const customerId = document.getElementById("deliveryCustomerId").value.trim();
  const fromTime = document.getElementById("deliveryFrom").value;
  const toTime = document.getElementById("deliveryTo").value;

  if (!customerId || !fromTime || !toTime) {
    msg.textContent = "Bitte alle Felder ausfüllen.";
    return;
  }

  try {
    const res = await fetch(`${API}/delivery-mail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...auth()
      },
      body: JSON.stringify({ customerId, fromTime, toTime })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      msg.textContent = data.error || "Fehler beim Senden der E-Mail.";
      return;
    }

    msg.textContent = "E-Mail gesendet und Status aktualisiert.";

  } catch (err) {
    console.error(err);
    msg.textContent = "Fehler beim Senden der E-Mail.";
  }
}
