const API = "/api/admin";

// ---------------------------------------------------------
// 🔐 Redirect, wenn kein Token vorhanden ist
// ---------------------------------------------------------
if (!localStorage.getItem("token")) {
    if (!window.location.pathname.endsWith("login.html")) {
        window.location.href = "/admin/login.html";
    }
}

// ---------------------------------------------------------
// 🔑 Authorization Header
// ---------------------------------------------------------
function auth() {
    return { "authorization": "Bearer " + localStorage.getItem("token") };
}

// ---------------------------------------------------------
// 📦 Bestellungen laden (für Dashboard)
// ---------------------------------------------------------
async function loadOrders() {
    const res = await fetch("/api/admin/orders", {
        headers: auth()
    });
    const data = await res.json();
    console.log(data);
}

// ---------------------------------------------------------
// 🔓 LOGIN
// ---------------------------------------------------------
document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (data.success) {
        localStorage.setItem("token", data.token);
        window.location.href = "/admin/dashboard.html";
    } else {
        alert("Login fehlgeschlagen!");
    }
});
