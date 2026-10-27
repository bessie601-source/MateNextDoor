// Sends the quote form to /api/quote, which emails it to Will.
(function () {
  var form = document.getElementById("quote-form");
  if (!form) return;
  var status = form.querySelector(".form-status");
  var button = form.querySelector("button[type=submit]");

  function show(msg, kind) {
    status.textContent = msg;
    status.className = "form-status " + (kind || "");
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var data = Object.fromEntries(new FormData(form));
    if (!data.name || !data.phone || !data.suburb || !data.details) {
      show("Please fill in your name, phone, suburb and what needs doing.", "err");
      return;
    }
    button.disabled = true;
    show("Sending…");
    fetch("/api/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    })
      .then(function (res) {
        if (!res.ok) throw new Error(res.status);
        form.reset();
        show("Thanks! Will has your request and will be in touch soon.", "ok");
      })
      .catch(function () {
        show("Sorry, that didn't send. Please call or email Will directly.", "err");
      })
      .finally(function () { button.disabled = false; });
  });
})();
