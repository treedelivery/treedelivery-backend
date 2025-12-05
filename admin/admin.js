const API = "/api/admin";

// LOGIN
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

// AUTH HEADER
function auth() {
  return {"authorization": "Bearer " + localStorage.getItem("token")};
}
