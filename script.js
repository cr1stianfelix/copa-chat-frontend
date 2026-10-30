/* CopaBot · frontend em JavaScript puro (sem bibliotecas) */
(() => {
  "use strict";

  const API_URL = "https://copa-chat-backend-ms4w.onrender.com/api/chat";
  const REQUEST_TIMEOUT_MS = 40000;
  const MAX_HISTORY = 10; // mensagens anteriores enviadas ao backend como contexto

  const STARTER_QUESTIONS = [
    "Quais seleções já foram campeãs do mundo?",
    "Quem é o maior artilheiro da história das Copas?",
    "Como foi a final da Copa de 1970?",
    "Quantas Copas o Brasil já venceu?",
  ];

  const messagesEl = document.getElementById("messages");
  const form = document.getElementById("chat-form");
  const input = document.getElementById("input");
  const sendBtn = document.getElementById("send");
  const counterEl = document.getElementById("counter");
  const MAX_CHARS = input.maxLength > 0 ? input.maxLength : 500;

  /** Histórico da conversa: [{role: "user" | "assistant", content: "..."}] */
  const history = [];
  let busy = false;
  let typingEl = null;
  let welcomeChips = null;

  /* ---------- Renderização segura ----------
     SEGURANÇA: nunca usamos innerHTML com texto do modelo ou do usuário.
     Tudo é inserido com textContent/createTextNode, o que impede XSS. */

  // Converte **negrito** em <strong> dentro de um elemento.
  function appendInline(parent, text) {
    for (const part of text.split(/(\*\*[^*]+\*\*)/g)) {
      if (!part) continue;
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        const strong = document.createElement("strong");
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  // Parágrafos, quebras de linha e listas ("- item") sem HTML bruto.
  function renderRich(container, text) {
    let list = null;
    let para = null;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) { list = null; para = null; continue; }
      const bullet = line.match(/^[-*•]\s+(.*)$/);
      if (bullet) {
        if (!list) {
          list = document.createElement("ul");
          container.appendChild(list);
          para = null;
        }
        const li = document.createElement("li");
        appendInline(li, bullet[1]);
        list.appendChild(li);
      } else {
        list = null;
        if (!para) {
          para = document.createElement("p");
          container.appendChild(para);
        } else {
          para.appendChild(document.createElement("br"));
        }
        appendInline(para, line);
      }
    }
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function makeChip(text) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = text;
    chip.addEventListener("click", () => sendMessage(text));
    return chip;
  }

  /**
   * Adiciona uma mensagem à tela.
   * opts: { refused, error, suggestion, starters }
   */
  function addMessage(role, text, opts = {}) {
    const wrap = document.createElement("div");
    wrap.className = `msg msg--${role === "user" ? "user" : "bot"}`;
    if (opts.refused) wrap.classList.add("msg--refused");
    if (opts.error) wrap.classList.add("msg--error");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = role === "user" ? "EU" : "⚽";

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (role === "user") bubble.textContent = text;
    else renderRich(bubble, text);

    // Sugestão de pergunta após uma recusa de escopo
    if (opts.suggestion) {
      const chips = document.createElement("div");
      chips.className = "chips";
      chips.appendChild(makeChip(opts.suggestion));
      bubble.appendChild(chips);
    }
    // Perguntas iniciais na mensagem de boas-vindas
    if (opts.starters) {
      welcomeChips = document.createElement("div");
      welcomeChips.className = "chips";
      for (const q of opts.starters) welcomeChips.appendChild(makeChip(q));
      bubble.appendChild(welcomeChips);
    }

    wrap.append(avatar, bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
    return wrap;
  }

  /* ---------- Indicador de digitação ---------- */
  function showTyping() {
    typingEl = document.createElement("div");
    typingEl.className = "msg msg--bot typing";
    typingEl.setAttribute("aria-label", "CopaBot está digitando");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "⚽";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "dot";
      bubble.appendChild(dot);
    }
    typingEl.append(avatar, bubble);
    messagesEl.appendChild(typingEl);
    scrollToBottom();
  }

  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  /* ---------- Estado da interface ---------- */
  function setBusy(value) {
    busy = value;
    sendBtn.disabled = value;
    document.querySelectorAll(".chip").forEach((c) => { c.disabled = value; });
  }

  function updateCounter() {
    const len = input.value.length;
    counterEl.textContent = `${len}/${MAX_CHARS}`;
    counterEl.classList.toggle("warn", len > MAX_CHARS * 0.9);
  }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  /* ---------- Mensagens de erro amigáveis ---------- */
  function friendlyError(status, data) {
    // Mensagens 4xx vêm do nosso backend e são seguras para exibir.
    if (status === 429) return "Opa, muitas perguntas em sequência! Respire um instante e tente de novo. ⏱️";
    if (status >= 400 && status < 500 && data && typeof data.error === "string") return data.error;
    return "Tivemos um problema no servidor e não consegui responder agora. Tente novamente em instantes.";
  }

  /* ---------- Envio ---------- */
  async function sendMessage(rawText) {
    const text = (rawText || "").trim();
    if (busy || !text) return;

    if (welcomeChips) { welcomeChips.remove(); welcomeChips = null; }

    addMessage("user", text);
    const context = history.slice(-MAX_HISTORY); // contexto anterior (sem a mensagem atual)
    history.push({ role: "user", content: text });

    input.value = "";
    autoGrow();
    updateCounter();
    setBusy(true);
    showTyping();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: context }),
        signal: controller.signal,
      });

      let data = null;
      try { data = await res.json(); } catch { /* resposta sem JSON válido */ }

      hideTyping();

      if (!res.ok || !data || typeof data.reply !== "string") {
        history.pop(); // não guarda no contexto uma pergunta sem resposta
        addMessage("bot", friendlyError(res.status, data), { error: true });
        return;
      }

      history.push({ role: "assistant", content: data.reply });
      addMessage("bot", data.reply, {
        refused: Boolean(data.refused),
        suggestion: typeof data.suggestion === "string" ? data.suggestion : null,
      });
    } catch (err) {
      hideTyping();
      history.pop();
      const message = err && err.name === "AbortError"
        ? "A resposta demorou demais. Tente novamente em instantes."
        : "Não consegui falar com o servidor. Verifique sua conexão e tente de novo.";
      addMessage("bot", message, { error: true });
    } finally {
      clearTimeout(timer);
      setBusy(false);
      input.focus();
    }
  }

  /* ---------- Eventos ---------- */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage(input.value);
  });

  // Enter envia; Shift+Enter quebra linha.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendMessage(input.value);
    }
  });

  input.addEventListener("input", () => { autoGrow(); updateCounter(); });

  /* ---------- Boas-vindas ---------- */
  addMessage(
    "bot",
    "Olá, torcedor! Eu sou o **CopaBot**. Fale comigo sobre a história das Copas, seleções, jogadores, técnicos, estádios, resultados e recordes. Por onde começamos?",
    { starters: STARTER_QUESTIONS }
  );
  updateCounter();
  input.focus();
})();
