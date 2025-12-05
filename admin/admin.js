//-----------------------------------------------------
// Token aus LocalStorage holen
//-----------------------------------------------------
const token = localStorage.getItem("token");

if (!token) {
    window.location.href = "/admin/login.html";
}

// Gemeinsame Header
const authHeader = {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + token
};

//-----------------------------------------------------
// PREISE LADEN
//-----------------------------------------------------
async function loadPrices() {
    const res = await fetch("/api/admin/prices", {
        headers: authHeader
    });

    if (!res.ok) {
        document.getElementById("priceMessage").textContent =
            "Fehler beim Laden der Preise.";
        return;
    }

    const prices = await res.json();

    document.getElementById("price-small").value = prices.small;
    document.getElementById("price-medium").value = prices.medium;
    document.getElementById("price-large").value = prices.large;
    document.getElementById("price-xl").value = prices.xl;
}

document.getElementById("priceForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const body = {
        small: document.getElementById("price-small").value,
        medium: document.getElementById("price-medium").value,
        large: document.getElementById("price-large").value,
        xl: document.getElementById("price-xl").value
    };

    const res = await fetch("/api/admin/prices", {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify(body)
    });

    const data = await res.json();

    document.getElementById("priceMessage").textContent =
        data.success ? "Preise gespeichert." : "Fehler beim Speichern.";
});

//-----------------------------------------------------
// BESTELLUNGEN LADEN
//-----------------------------------------------------
async function loadOrders() {
    const res = await fetch("/api/admin/orders", {
        headers: authHeader
    });

    const body = document.getElementById("ordersBody");
    body.innerHTML = "";

    if (!res.ok) {
        body.innerHTML = "<tr><td colspan='9'>Fehler beim Laden.</td></tr>";
        return;
    }

    const orders = await res.json();

    if (orders.length === 0) {
        body.innerHTML = "<tr><td colspan='9'>Keine Bestellungen vorhanden.</td></tr>";
        return;
    }

    for (const o of orders) {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${o.customerId}</td>
            <td>${o.name}</td>
            <td>${o.email}</td>
            <td>${o.size.toUpperCase()}</td>
            <td>${o.date || "-"}</td>
            <td>${o.status || "Offen"}</td>
            <td>${o.street}, ${o.zip} ${o.city}</td>
            <td>${o.specialRequests || "-"}</td>
            <td>
                <select data-id="${o.customerId}" class="statusSelect">
                    <option value="Offen" ${o.status === "Offen" ? "selected" : ""}>Offen</option>
                    <option value="Geplant" ${o.status === "Geplant" ? "selected" : ""}>Geplant</option>
                    <option value="Lieferung heute geplant" ${o.status === "Lieferung heute geplant" ? "selected" : ""}>Lieferung heute</option>
                    <option value="Abgeschlossen" ${o.status === "Abgeschlossen" ? "selected" : ""}>Abgeschlossen</option>
                </select>
            </td>
        `;

        body.appendChild(tr);
    }

    // Event Listener für Statusänderungen
    document.querySelectorAll(".statusSelect").forEach(select => {
        select.addEventListener("change", updateStatus);
    });
}

//-----------------------------------------------------
// STATUS ÄNDERN
//-----------------------------------------------------
async function updateStatus(e) {
    const customerId = e.target.getAttribute("data-id");
    const status = e.target.value;

    await fetch("/api/admin/status", {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({ customerId, status })
    });

    document.getElementById("ordersMessage").textContent =
        "Status aktualisiert.";
}

//-----------------------------------------------------
// LIEFERUNGS-DATUM FILTER
//-----------------------------------------------------
document.getElementById("filterDateBtn").addEventListener("click", async () => {
    const date = document.getElementById("filter-date").value;

    if (!date) return loadOrders();

    const res = await fetch(`/api/admin/deliveries/${date}`, {
        headers: authHeader
    });

    const data = await res.json();

    const body = document.getElementById("ordersBody");
    body.innerHTML = "";

    if (data.length === 0) {
        body.innerHTML = "<tr><td colspan='9'>Keine Lieferungen an diesem Datum.</td></tr>";
        return;
    }

    for (const o of data) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${o.customerId}</td>
            <td>${o.name}</td>
            <td>${o.email}</td>
            <td>${o.size}</td>
            <td>${o.date}</td>
            <td>${o.status || "-"}</td>
            <td>${o.street}, ${o.zip} ${o.city}</td>
            <td>${o.specialRequests || "-"}</td>
            <td>–</td>
        `;
        body.appendChild(tr);
    }
});

document.getElementById("showAllBtn").addEventListener("click", loadOrders);

//-----------------------------------------------------
// LIEFERZEIT - MAIL
//-----------------------------------------------------
document.getElementById("deliveryMailForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const body = {
        customerId: document.getElementById("deliveryCustomerId").value,
        fromTime: document.getElementById("deliveryFrom").value,
        toTime: document.getElementById("deliveryTo").value
    };

    const res = await fetch("/api/admin/delivery-mail", {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify(body)
    });

    const data = await res.json();

    document.getElementById("deliveryMessage").textContent =
        data.success ? "Lieferzeit-E-Mail gesendet." : "Fehler beim Versenden.";
});

//-----------------------------------------------------
// LOGOUT
//-----------------------------------------------------
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "/admin/login.html";
});

//-----------------------------------------------------
// INITIAL LOAD
//-----------------------------------------------------
loadPrices();
loadOrders();
