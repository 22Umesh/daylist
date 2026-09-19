/* Daylist — a task list that tracks how many minutes today is actually carrying.
   State lives in one array; every mutation goes through save() -> render(). */

(function () {
  "use strict";

  var STORE_KEY = "daylist.v1";
  var BUCKETS = { today: "Today", next: "Next up", someday: "Someday" };

  var seedTasks = [
    { title: "Write the sprint recap for Thursday's review", mins: 45, bucket: "today", done: false },
    { title: "Reply to the vendor contract thread", mins: 15, bucket: "today", done: false },
    { title: "Pair with Rosa on the export timeout", mins: 90, bucket: "today", done: false },
    { title: "Book the dentist appointment", mins: 10, bucket: "today", done: true },
    { title: "Draft Q3 hiring plan outline", mins: 60, bucket: "next", done: false },
    { title: "Clean up the staging database snapshots", mins: 30, bucket: "next", done: false },
    { title: "Learn enough Rust to read the parser", mins: 240, bucket: "someday", done: false }
  ];

  var state = load();
  var filters = { bucket: "today", status: "all", query: "" };
  var pendingUndo = null;
  var toastTimer = null;
  var dragId = null;

  /* ---------- storage ---------- */

  function blankState() {
    return {
      capacity: 300,
      seeded: true,
      theme: "system",
      tasks: seedTasks.map(function (t, i) {
        return {
          id: "seed-" + i,
          title: t.title,
          mins: t.mins,
          bucket: t.bucket,
          done: t.done,
          created: Date.now() - (seedTasks.length - i) * 60000
        };
      })
    };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.tasks)) {
          parsed.capacity = Number(parsed.capacity) || 300;
          parsed.theme = parsed.theme || "system";
          return parsed;
        }
      }
    } catch (err) {
      /* private mode, blocked site data — fall through to a fresh list */
    }
    return blankState();
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      /* nothing to do; the page still works for this session */
    }
  }

  /* ---------- helpers ---------- */

  function $(sel) { return document.querySelector(sel); }

  function newId() {
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function findIndex(id) {
    for (var i = 0; i < state.tasks.length; i++) {
      if (state.tasks[i].id === id) return i;
    }
    return -1;
  }

  function formatMins(m) {
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    var r = m % 60;
    return r ? h + "h " + r + "m" : h + "h";
  }

  function visibleTasks() {
    var q = filters.query.trim().toLowerCase();
    return state.tasks.filter(function (t) {
      if (filters.bucket !== "all" && t.bucket !== filters.bucket) return false;
      if (filters.status === "open" && t.done) return false;
      if (filters.status === "done" && !t.done) return false;
      if (q && t.title.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function svgIcon(paths) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + "</svg>";
  }

  /* ---------- rendering ---------- */

  function render() {
    renderLoad();
    renderCounts();
    renderList();
    $("#example-banner").hidden = !state.seeded;
    save();
  }

  function renderLoad() {
    var open = state.tasks.filter(function (t) { return t.bucket === "today" && !t.done; });
    var total = open.reduce(function (sum, t) { return sum + t.mins; }, 0);
    var cap = state.capacity;
    var scale = Math.max(total, cap) || 1;

    $("#load-total").textContent = total;
    $("#load-cap").textContent = "/ " + cap + " min";

    var meter = $("#meter");
    meter.innerHTML = "";
    var running = 0;
    open.forEach(function (t) {
      var seg = document.createElement("div");
      seg.className = "meter-seg" + (running >= cap ? " over" : "");
      seg.style.width = (t.mins / scale) * 100 + "%";
      seg.title = t.title + " — " + formatMins(t.mins);
      running += t.mins;
      meter.appendChild(seg);
    });

    if (total > cap) {
      var mark = document.createElement("div");
      mark.className = "meter-mark";
      mark.style.left = (cap / scale) * 100 + "%";
      mark.title = "Capacity: " + cap + " min";
      meter.appendChild(mark);
    }

    var note = $("#load-note");
    if (!open.length) {
      note.textContent = "Nothing scheduled for today yet.";
      note.className = "load-note";
    } else if (total > cap) {
      note.textContent = formatMins(total - cap) + " over capacity — move something to Next up.";
      note.className = "load-note over";
    } else {
      note.textContent = formatMins(cap - total) + " left across " + open.length +
        (open.length === 1 ? " task." : " tasks.");
      note.className = "load-note";
    }

    var doneToday = state.tasks.filter(function (t) { return t.bucket === "today" && t.done; });
    $("#stat-open").textContent = open.length;
    $("#stat-done").textContent = doneToday.length;
    $("#stat-banked").textContent = formatMins(doneToday.reduce(function (s, t) { return s + t.mins; }, 0));
    $("#clear-done").disabled = !state.tasks.some(function (t) { return t.done; });
  }

  function renderCounts() {
    Object.keys(BUCKETS).concat("all").forEach(function (key) {
      var el = document.querySelector('[data-count="' + key + '"]');
      if (!el) return;
      el.textContent = state.tasks.filter(function (t) {
        return !t.done && (key === "all" || t.bucket === key);
      }).length;
    });
  }

  function renderList() {
    var list = $("#list");
    var tasks = visibleTasks();
    list.innerHTML = "";

    $("#empty").hidden = tasks.length > 0;
    if (!tasks.length) {
      $("#empty-line").textContent = filters.query
        ? 'No task matches "' + filters.query + '".'
        : filters.status === "done"
          ? "Nothing finished in this list yet."
          : "This list is clear.";
      return;
    }

    tasks.forEach(function (task) {
      list.appendChild(taskRow(task));
    });
  }

  function taskRow(task) {
    var li = document.createElement("li");
    li.className = "task" + (task.done ? " done" : "");
    li.dataset.id = task.id;
    li.dataset.bucket = task.bucket;
    li.draggable = true;

    var handle = document.createElement("button");
    handle.className = "handle";
    handle.type = "button";
    handle.setAttribute("aria-label", "Reorder " + task.title + ". Use Alt with arrow keys.");
    handle.innerHTML = svgIcon(
      '<circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/>' +
      '<circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/>' +
      '<circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/>'
    );

    var check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.checked = task.done;
    check.id = "check-" + task.id;
    check.setAttribute("aria-label", task.done ? "Mark " + task.title + " unfinished" : "Finish " + task.title);

    var main = document.createElement("div");
    main.className = "task-main";

    var title = document.createElement("button");
    title.className = "task-title";
    title.type = "button";
    title.textContent = task.title;
    title.title = "Click to rename";

    var mins = document.createElement("span");
    mins.className = "chip mins";
    mins.textContent = formatMins(task.mins);

    var bucket = document.createElement("span");
    bucket.className = "chip";
    bucket.textContent = BUCKETS[task.bucket];

    main.appendChild(title);
    main.appendChild(mins);
    if (filters.bucket === "all") main.appendChild(bucket);

    var actions = document.createElement("div");
    actions.className = "task-actions";

    var move = document.createElement("button");
    move.className = "btn-icon edit";
    move.type = "button";
    move.dataset.act = "move";
    move.title = "Move to " + BUCKETS[nextBucket(task.bucket)];
    move.setAttribute("aria-label", "Move " + task.title + " to " + BUCKETS[nextBucket(task.bucket)]);
    move.innerHTML = svgIcon('<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>');

    var del = document.createElement("button");
    del.className = "btn-icon";
    del.type = "button";
    del.dataset.act = "delete";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete " + task.title);
    del.innerHTML = svgIcon('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/>');

    actions.appendChild(move);
    actions.appendChild(del);

    li.appendChild(handle);
    li.appendChild(check);
    li.appendChild(main);
    li.appendChild(actions);
    return li;
  }

  function nextBucket(current) {
    var order = ["today", "next", "someday"];
    return order[(order.indexOf(current) + 1) % order.length];
  }

  /* ---------- mutations ---------- */

  function addTask(title, mins, bucket) {
    state.tasks.unshift({
      id: newId(),
      title: title,
      mins: mins,
      bucket: bucket,
      done: false,
      created: Date.now()
    });
    state.seeded = false;
    render();
  }

  function startEdit(li, task) {
    var titleBtn = li.querySelector(".task-title");
    var input = document.createElement("input");
    input.type = "text";
    input.className = "task-edit";
    input.id = "edit-" + task.id;
    input.value = task.title;
    input.setAttribute("aria-label", "Rename task");
    li.draggable = false;
    titleBtn.replaceWith(input);
    input.focus();
    input.select();

    var closed = false;
    function commit(keep) {
      if (closed) return;
      closed = true;
      var idx = findIndex(task.id);
      var value = input.value.trim();
      if (keep && value && idx > -1) state.tasks[idx].title = value;
      render();
    }

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", function () { commit(true); });
  }

  function deleteTask(id) {
    var idx = findIndex(id);
    if (idx < 0) return;
    var removed = state.tasks.splice(idx, 1)[0];
    pendingUndo = { task: removed, index: idx };
    render();
    showToast('Deleted "' + truncate(removed.title, 32) + '"', true);
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
  }

  function moveBy(id, delta) {
    var shown = visibleTasks();
    var pos = shown.findIndex(function (t) { return t.id === id; });
    var target = shown[pos + delta];
    if (!target) return false;
    var from = findIndex(id);
    var to = findIndex(target.id);
    var moved = state.tasks.splice(from, 1)[0];
    state.tasks.splice(to, 0, moved);
    render();
    var handle = document.querySelector('.task[data-id="' + id + '"] .handle');
    if (handle) handle.focus();
    return true;
  }

  function reorderTo(sourceId, targetId, after) {
    if (sourceId === targetId) return;
    var from = findIndex(sourceId);
    if (from < 0) return;
    var moved = state.tasks.splice(from, 1)[0];
    var to = findIndex(targetId);
    if (to < 0) { state.tasks.splice(from, 0, moved); return; }
    state.tasks.splice(after ? to + 1 : to, 0, moved);
    render();
  }

  /* ---------- toast ---------- */

  function showToast(message, undoable) {
    var toast = $("#toast");
    $("#toast-text").textContent = message;
    $("#toast-undo").hidden = !undoable;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toast.classList.remove("show");
      pendingUndo = null;
    }, 6000);
  }

  /* ---------- theme ---------- */

  function applyTheme() {
    var root = document.documentElement;
    if (state.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", state.theme);
    var btn = $("#theme-toggle");
    var label = state.theme === "dark" ? "Dark" : state.theme === "light" ? "Light" : "System";
    btn.title = "Theme: " + label + " — click to change";
    btn.setAttribute("aria-label", "Theme: " + label + ". Click to change.");
  }

  function cycleTheme() {
    var order = ["system", "light", "dark"];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    applyTheme();
    save();
    showToast("Theme: " + state.theme, false);
  }

  /* ---------- wiring ---------- */

  function init() {
    var d = new Date();
    $("#today-date").textContent = d.toLocaleDateString(undefined, {
      weekday: "long", month: "short", day: "numeric"
    });

    $("#capacity").value = state.capacity;
    applyTheme();
    render();

    $("#composer").addEventListener("submit", function (e) {
      e.preventDefault();
      var titleField = $("#new-title");
      var title = titleField.value.trim();
      if (!title) { titleField.focus(); return; }
      var mins = Math.max(1, Math.min(600, parseInt($("#new-mins").value, 10) || 15));
      var bucket = $("#new-bucket").value;
      addTask(title, mins, bucket);
      titleField.value = "";
      $("#new-mins").value = 15;
      titleField.focus();
      if (filters.bucket !== "all" && filters.bucket !== bucket) {
        setFilter("bucket", bucket);
      }
    });

    $("#capacity").addEventListener("change", function () {
      state.capacity = Math.max(15, Math.min(1440, parseInt(this.value, 10) || 300));
      this.value = state.capacity;
      render();
    });

    document.querySelectorAll("[data-filter]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setFilter(btn.dataset.filter, btn.dataset.value);
      });
    });

    $("#search").addEventListener("input", function () {
      filters.query = this.value;
      renderList();
    });

    $("#clear-done").addEventListener("click", function () {
      var count = state.tasks.filter(function (t) { return t.done; }).length;
      if (!count) return;
      state.tasks = state.tasks.filter(function (t) { return !t.done; });
      render();
      showToast("Cleared " + count + " finished " + (count === 1 ? "task" : "tasks"), false);
    });

    $("#clear-examples").addEventListener("click", function () {
      state.tasks = state.tasks.filter(function (t) { return t.id.indexOf("seed-") !== 0; });
      state.seeded = false;
      render();
      $("#new-title").focus();
    });

    $("#theme-toggle").addEventListener("click", cycleTheme);

    $("#toast-undo").addEventListener("click", function () {
      if (!pendingUndo) return;
      state.tasks.splice(pendingUndo.index, 0, pendingUndo.task);
      pendingUndo = null;
      $("#toast").classList.remove("show");
      render();
    });

    wireList();

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) {
        e.preventDefault();
        $("#search").focus();
      }
    });
  }

  function setFilter(kind, value) {
    filters[kind] = value;
    document.querySelectorAll('[data-filter="' + kind + '"]').forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.value === value));
    });
    renderList();
  }

  function wireList() {
    var list = $("#list");

    list.addEventListener("click", function (e) {
      var li = e.target.closest(".task");
      if (!li) return;
      var task = state.tasks[findIndex(li.dataset.id)];
      if (!task) return;

      if (e.target.closest(".task-title")) { startEdit(li, task); return; }

      var act = e.target.closest("[data-act]");
      if (!act) return;
      if (act.dataset.act === "delete") deleteTask(task.id);
      if (act.dataset.act === "move") {
        task.bucket = nextBucket(task.bucket);
        render();
        showToast('"' + truncate(task.title, 28) + '" → ' + BUCKETS[task.bucket], false);
      }
    });

    list.addEventListener("change", function (e) {
      if (!e.target.classList.contains("check")) return;
      var li = e.target.closest(".task");
      var task = state.tasks[findIndex(li.dataset.id)];
      if (!task) return;
      task.done = e.target.checked;
      render();
    });

    list.addEventListener("keydown", function (e) {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      var li = e.target.closest(".task");
      if (!li) return;
      e.preventDefault();
      moveBy(li.dataset.id, e.key === "ArrowUp" ? -1 : 1);
    });

    list.addEventListener("dragstart", function (e) {
      var li = e.target.closest(".task");
      if (!li) return;
      dragId = li.dataset.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragId); } catch (err) { /* IE-era guard */ }
    });

    list.addEventListener("dragover", function (e) {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var li = e.target.closest(".task");
      list.querySelectorAll(".drop-target").forEach(function (el) { el.classList.remove("drop-target"); });
      if (li && li.dataset.id !== dragId) li.classList.add("drop-target");
    });

    list.addEventListener("drop", function (e) {
      if (!dragId) return;
      e.preventDefault();
      var li = e.target.closest(".task");
      if (li && li.dataset.id !== dragId) {
        var box = li.getBoundingClientRect();
        reorderTo(dragId, li.dataset.id, e.clientY > box.top + box.height / 2);
      }
      dragId = null;
    });

    list.addEventListener("dragend", function () {
      dragId = null;
      list.querySelectorAll(".dragging, .drop-target").forEach(function (el) {
        el.classList.remove("dragging", "drop-target");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
