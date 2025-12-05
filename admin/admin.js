const API = "/api/admin";

// LOGIN
const loginForm = document.getElementById("loginForm");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value;
    const password = document.getElementById("password").value;

    const res = await fetch(API + "/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, password})
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem("token", data.token);
      window.location.href = "/admin/dashboard.html";
    } else {
      document.getElementById("error").innerText = "Login fehlgeschlagen.";
    }
  });
}

// AUTH HEADER
function auth() {
  return {"authorization": "Bearer " + localStorage.getItem("token")};
}
