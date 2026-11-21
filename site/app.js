(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const navToggle = $("[data-nav-toggle]");
  const nav = $("[data-nav]");
  if (navToggle && nav) {
    const setOpen = (open) => {
      nav.classList.toggle("is-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
    };
    navToggle.addEventListener("click", () => setOpen(!nav.classList.contains("is-open")));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        navToggle.focus();
      }
    });
    nav.addEventListener("click", (event) => {
      if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) setOpen(false);
    });
  }

  const header = $(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  const copyText = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("copy failed");
  };

  $$("[data-copy]").forEach((button) => {
    button.addEventListener("click", async () => {
      const target = document.getElementById(button.getAttribute("data-copy") || "");
      if (!target) return;
      const label = button.textContent;
      try {
        await copyText(target.textContent.trim());
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        button.textContent = label;
      }, 1500);
    });
  });

  const year = $("[data-year]");
  if (year) year.textContent = String(new Date().getFullYear());

  const versionPill = $("[data-version]");
  const releaseList = $("[data-releases]");
  if (releaseList) {
    const cacheKey = "tawassul-releases-v1";
    const fallback = () => {
      releaseList.hidden = false;
      const note = $("[data-releases-note]");
      if (note) note.hidden = false;
    };
    const readCache = () => {
      try {
        const raw = sessionStorage.getItem(cacheKey);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || typeof cached.at !== "number" || Date.now() - cached.at > 600000) return null;
        return cached.items;
      } catch {
        return null;
      }
    };
    const render = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        fallback();
        return;
      }
      releaseList.textContent = "";
      for (const item of items) {
        const article = document.createElement("article");
        article.className = "release";
        const body = document.createElement("div");
        const name = document.createElement("p");
        name.className = "release-name";
        name.textContent = item.name || item.tag_name || "Release";
        if (item.tag_name) {
          const tag = document.createElement("span");
          tag.className = "pill pill--version";
          tag.textContent = item.tag_name;
          name.append(" ", tag);
        }
        if (item.prerelease) {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = "prerelease";
          name.append(" ", badge);
        }
        const meta = document.createElement("p");
        meta.className = "release-meta";
        const date = item.published_at ? new Date(item.published_at) : null;
        const when = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "undated";
        const assets = Array.isArray(item.assets) ? item.assets.length : 0;
        meta.textContent = `${when} · ${assets} asset${assets === 1 ? "" : "s"}`;
        body.append(name, meta);
        const link = document.createElement("a");
        link.className = "btn btn--ghost btn--small";
        link.href = item.html_url || "https://github.com/HtoZ27/Tawassul-V2/releases";
        link.textContent = "Open";
        article.append(body, link);
        releaseList.append(article);
      }
      releaseList.hidden = false;
      const note = $("[data-releases-note]");
      if (note) note.hidden = true;
      if (versionPill) {
        const first = items.find((item) => item && item.tag_name);
        if (first) versionPill.textContent = first.tag_name;
      }
    };
    const cached = readCache();
    if (cached) {
      render(cached);
    } else {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      fetch("https://api.github.com/repos/HtoZ27/Tawassul-V2/releases?per_page=6", {
        headers: { Accept: "application/vnd.github+json" },
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        })
        .then((items) => {
          render(items);
          try {
            sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), items }));
          } catch {
            void 0;
          }
        })
        .catch(() => fallback())
        .finally(() => window.clearTimeout(timer));
    }
  }

  const search = $("[data-docs-search]");
  if (search) {
    const cards = $$("[data-doc-card]");
    const groups = $$("[data-doc-group]");
    const count = $("[data-docs-count]");
    const empty = $("[data-no-match]");
    const apply = () => {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      for (const card of cards) {
        const haystack = `${card.textContent} ${card.getAttribute("data-keywords") || ""}`.toLowerCase();
        const match = query.length === 0 || haystack.includes(query);
        card.hidden = !match;
        if (match) shown += 1;
      }
      for (const group of groups) {
        const visible = $$("[data-doc-card]", group).some((card) => !card.hidden);
        group.hidden = !visible;
      }
      if (count) count.textContent = `${shown} of ${cards.length} pages`;
      if (empty) empty.classList.toggle("is-visible", shown === 0);
    };
    search.addEventListener("input", apply);
    apply();
  }

  const lightboxLinks = $$("[data-lightbox]");
  if (lightboxLinks.length > 0) {
    const dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Enlarged replay image");
    const image = document.createElement("img");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    dialog.append(image, close);
    document.body.append(dialog);
    let opener = null;
    const open = (href, alt, trigger) => {
      opener = trigger;
      image.src = href;
      image.alt = alt;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      close.focus();
    };
    const shut = () => {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      if (opener) opener.focus();
    };
    for (const link of lightboxLinks) {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const img = $("img", link);
        if (!img) return;
        event.preventDefault();
        open(link.href, img.alt, link);
      });
    }
    close.addEventListener("click", shut);
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) shut();
    });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      shut();
    });
  }
})();
