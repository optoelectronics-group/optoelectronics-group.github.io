const API_BASE = window.LAB_BOOKING_API_BASE || "https://lab-booking-api.zhixiangren0814.workers.dev";
const LAB_ID = 1;
const TIME_START_HOUR = 8;
const TIME_END_HOUR = 22;
const HOUR_HEIGHT = 60;
const SLOT_PRESETS = [
  { label: "09:00-10:00", start: "09:00", end: "10:00" },
  { label: "09:00-11:00", start: "09:00", end: "11:00" },
  { label: "10:00-12:00", start: "10:00", end: "12:00" },
  { label: "13:00-15:00", start: "13:00", end: "15:00" },
  { label: "14:00-17:00", start: "14:00", end: "17:00" },
  { label: "18:00-21:00", start: "18:00", end: "21:00" },
  { label: "自定义时间段", start: "", end: "", custom: true },
];
const AUTO_REFRESH_MS = 15000;

const state = {
  labs: [],
  users: [],
  items: [],
  bookings: [],
  selectedUser: null,
  selectedItemFilter: "all",
  view: "day",
  anchorDate: startOfDay(new Date()),
  page: document.body.dataset.page || "booking",
  diagnostics: {
    users: { label: "用户接口", status: "loading", detail: "等待加载", meta: "" },
    items: { label: "项目接口", status: "loading", detail: "等待加载", meta: "" },
    bookings: { label: "预约接口", status: "loading", detail: "等待加载", meta: "" },
  },
};

document.addEventListener("DOMContentLoaded", () => {
  if (state.page === "admin") {
    initAdminPage();
  } else {
    initBookingPage();
  }
});

async function initBookingPage() {
  renderDiagnostics();
  renderPresetSlots();
  wireBookingEvents();
  setDateDefault();
  await Promise.all([loadLabs(), loadUsers(""), loadItems(), loadBookings()]);
  renderUserSearchResults(state.users);
  renderItemOptions();
  renderItemFilter();
  renderCalendar();
  renderBookingList();
  setupAutoRefresh();
}

async function initAdminPage() {
  renderDiagnostics();
  wireAdminEvents();
  await Promise.all([loadLabs(), loadItems()]);
  populateAdminFilters();
  await loadAdminBookings();
  setupAutoRefresh();
}

function wireBookingEvents() {
  const searchInput = $("#user-search");
  const remarkType = $("#remark-type");
  const form = $("#booking-form");

  let timer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await loadUsers(searchInput.value.trim());
      renderUserSearchResults(state.users);
    }, 250);
  });

  remarkType.addEventListener("change", () => {
    const wrap = $("#remark-detail-wrap");
    wrap.classList.toggle("hidden", remarkType.value !== "其他");
  });

  form.addEventListener("submit", handleSubmitBooking);
  $("#item-filter").addEventListener("change", (event) => {
    state.selectedItemFilter = event.target.value;
    renderCalendar();
    renderBookingList();
  });

  $("#view-switch").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    $$("#view-switch button").forEach((node) => node.classList.toggle("active", node === button));
    renderCalendar();
  });

  $("#prev-range").addEventListener("click", () => shiftRange(-1));
  $("#next-range").addEventListener("click", () => shiftRange(1));
  $("#today-range").addEventListener("click", () => {
    state.anchorDate = startOfDay(new Date());
    renderCalendar();
  });
}

function wireAdminEvents() {
  $("#admin-search").addEventListener("click", loadAdminBookings);
  $("#admin-export").addEventListener("click", exportAdminCsv);
}

function setupAutoRefresh() {
  let refreshing = false;

  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      if (state.page === "admin") {
        await loadAdminBookings({ silent: true });
      } else {
        await loadBookings();
        renderCalendar();
        renderBookingList();
      }
    } finally {
      refreshing = false;
    }
  };

  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refresh();
    }
  });
  window.setInterval(refresh, AUTO_REFRESH_MS);
}

async function loadLabs() {
  const response = await apiFetch("/api/labs");
  state.labs = response.labs || [];
}

async function loadUsers(query) {
  const encoded = encodeURIComponent(query || "");
  try {
    const response = await apiFetch(`/api/users?q=${encoded}`);
    state.users = response.users || [];
    updateDiagnostic("users", "ok", `已加载 ${state.users.length} 条用户`, query ? `关键词：${query}` : "默认加载");
  } catch (error) {
    updateDiagnostic("users", "error", error.message || "用户接口失败", query ? `关键词：${query}` : "默认加载");
    throw error;
  } finally {
    renderDiagnostics();
  }
}

async function loadItems() {
  try {
    const response = await apiFetch(`/api/labs/${LAB_ID}/items`);
    state.items = response.items || [];
    updateDiagnostic("items", "ok", `已加载 ${state.items.length} 个项目`, `lab_id=${LAB_ID}`);
  } catch (error) {
    updateDiagnostic("items", "error", error.message || "项目接口失败", `lab_id=${LAB_ID}`);
    throw error;
  } finally {
    renderDiagnostics();
  }
}

async function loadBookings() {
  const start = formatDateInput(addDays(new Date(), -45));
  const end = formatDateInput(addDays(new Date(), 45));
  try {
    const response = await apiFetch(`/api/bookings?lab_id=${LAB_ID}&start=${start}&end=${end}&item_id=all`);
    state.bookings = response.bookings || [];
    updateDiagnostic("bookings", "ok", `已加载 ${state.bookings.length} 条预约`, `${start} ~ ${end}`);
  } catch (error) {
    updateDiagnostic("bookings", "error", error.message || "预约接口失败", `${start} ~ ${end}`);
    throw error;
  } finally {
    renderDiagnostics();
  }
}

function renderPresetSlots() {
  const container = $("#preset-slots");
  container.innerHTML = SLOT_PRESETS.map((slot, index) => {
    const attrs = `class="slot-btn${index === 0 ? " active" : ""}" data-start="${slot.start}" data-end="${slot.end}" data-custom="${slot.custom ? "1" : "0"}"`;
    return `<button type="button" ${attrs}>${slot.label}</button>`;
  }).join("");

  setCustomTimes(SLOT_PRESETS[0].start, SLOT_PRESETS[0].end);
  if (!container.dataset.bound) {
    container.addEventListener("click", (event) => {
      const button = event.target.closest(".slot-btn");
      if (!button) return;
      $$(".slot-btn").forEach((node) => node.classList.toggle("active", node === button));
      if (button.dataset.custom === "1") return;
      setCustomTimes(button.dataset.start, button.dataset.end);
    });
    container.dataset.bound = "1";
  }
}

function renderUserSearchResults(users) {
  const container = $("#user-results");
  if (!users.length) {
    container.innerHTML = `<div class="empty-state">没有匹配到用户</div>`;
    return;
  }
  container.innerHTML = users
    .map(
      (user) => `
        <button type="button" class="search-option" data-user-id="${user.id}">
          ${escapeHtml(user.name)}（${escapeHtml(user.student_id)}）${user.has_ding_userid ? " · 已配置提醒ID" : ""}
        </button>
      `
    )
    .join("");

  container.querySelectorAll(".search-option").forEach((button) => {
    button.addEventListener("click", () => {
      const user = users.find((entry) => String(entry.id) === button.dataset.userId);
      if (!user) return;
      state.selectedUser = user;
      $("#selected-user").classList.remove("empty");
      $("#selected-user").textContent = `已选择：${user.name}（${user.student_id}）`;
      $("#user-search").value = `${user.name}（${user.student_id}）`;
    });
  });
}

function renderItemOptions() {
  const select = $("#item-select");
  select.innerHTML = `<option value="">请选择预约项目</option>${state.items
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("")}`;
}

function renderItemFilter() {
  $("#item-filter").innerHTML = [
    `<option value="all">全部项目</option>`,
    ...state.items.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`),
  ].join("");
}

function renderCalendar() {
  const root = $("#calendar-root");
  const bookings = getFilteredBookings();
  const days = getVisibleDays();
  $("#range-label").textContent = getRangeLabel(days);

  if (state.view === "month") {
    root.innerHTML = renderMonthGrid(bookings, state.anchorDate);
    bindBookingDetailTriggers(root);
    return;
  }

  root.innerHTML = renderTimeline(bookings, days);
  bindBookingDetailTriggers(root);
}

function renderTimeline(bookings, days) {
  const perDay = days.map((day) => {
    const dayBookings = bookings
      .filter((booking) => isSameDay(new Date(booking.start_time), day))
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return assignColumns(dayBookings);
  });

  const header = `
    <div class="timeline-header" style="--days:${days.length}">
      <div></div>
      ${days
        .map(
          (day) => `
            <div class="day-title">${formatDayLabel(day)}</div>
          `
        )
        .join("")}
    </div>
  `;

  const timeLabels = Array.from({ length: TIME_END_HOUR - TIME_START_HOUR + 1 }, (_, index) => {
    const hour = TIME_START_HOUR + index;
    const top = (index * HOUR_HEIGHT);
    return `<span style="top:${top}px">${String(hour).padStart(2, "0")}:00</span>`;
  }).join("");

  const body = `
    <div class="timeline-body" style="--days:${days.length}">
      <div class="time-labels">${timeLabels}</div>
      ${perDay
        .map((dayBookings, index) => {
          const maxColumns = Math.max(1, ...dayBookings.map((entry) => entry._columnCount || 1));
          const cards = dayBookings.map((booking) => renderTimelineCard(booking, maxColumns)).join("");
          return `<div class="day-column" data-day="${formatDateInput(days[index])}">${cards}</div>`;
        })
        .join("")}
    </div>
  `;

  return `<div class="timeline-grid">${header}${body}</div>`;
}

function renderTimelineCard(booking, totalColumns) {
  const start = new Date(booking.start_time);
  const end = new Date(booking.end_time);
  const top = ((start.getHours() + start.getMinutes() / 60 - TIME_START_HOUR) * HOUR_HEIGHT);
  const height = Math.max(44, ((end - start) / 3600000) * HOUR_HEIGHT);
  const width = `calc(${100 / totalColumns}% - 8px)`;
  const left = `calc(${(booking._columnIndex / totalColumns) * 100}% + 4px)`;
  const remark = getRemarkLabel(booking);
  return `
    <div
      class="booking-card"
      data-booking-id="${booking.id}"
      style="top:${top}px;height:${height}px;width:${width};left:${left};"
      title="点击查看详情"
    >
      <p>${formatTimeRange(start, end)}</p>
      <strong>${escapeHtml(booking.item_name)}</strong>
      <small>${escapeHtml(booking.user_name)}（${escapeHtml(booking.student_id)}）</small>
      ${remark ? `<small>备注：${escapeHtml(remark)}</small>` : ""}
    </div>
  `;
}

function renderMonthGrid(bookings, anchorDate) {
  const first = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() + 6) % 7));
  const cells = [];
  for (let index = 0; index < 42; index += 1) {
    const day = addDays(gridStart, index);
    const dayBookings = bookings.filter((booking) => isSameDay(new Date(booking.start_time), day));
    cells.push(`
      <div class="month-cell ${day.getMonth() !== anchorDate.getMonth() ? "is-faded" : ""}">
        <div class="date-label">${day.getMonth() + 1}/${day.getDate()}</div>
        ${dayBookings.length
          ? dayBookings
              .slice(0, 4)
              .map(
                (booking) => `
                  <div class="month-item" data-booking-id="${booking.id}">
                    ${formatTime(new Date(booking.start_time))} ${escapeHtml(booking.item_name)}
                  </div>
                `
              )
              .join("")
          : `<div class="empty-state">无预约</div>`}
      </div>
    `);
  }
  return `<div class="month-grid">${cells.join("")}</div>`;
}

function renderBookingList() {
  const list = $("#booking-list");
  const bookings = getFilteredBookings()
    .filter((booking) => new Date(booking.end_time) >= new Date())
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

  if (!bookings.length) {
    list.innerHTML = `<div class="empty-state">当前没有符合条件的当前或未来预约。</div>`;
    return;
  }

  list.innerHTML = bookings
    .map((booking) => {
      const remark = getRemarkLabel(booking);
      return `
        <article class="list-item">
          <h4>${escapeHtml(booking.item_name)}</h4>
          <p>${formatDateTimeRange(new Date(booking.start_time), new Date(booking.end_time))}</p>
          <p>预约人：${escapeHtml(booking.user_name)}（${escapeHtml(booking.student_id)}）</p>
          ${remark ? `<p>备注：${escapeHtml(remark)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

async function handleSubmitBooking(event) {
  event.preventDefault();
  const message = $("#form-message");
  message.className = "message";
  message.textContent = "";

  if (!state.selectedUser) {
    setMessage(message, "请先选择预约人。", true);
    return;
  }

  const itemId = $("#item-select").value;
  const bookingDate = $("#booking-date").value;
  const startTime = $("#custom-start").value;
  const endTime = $("#custom-end").value;
  const remarkType = $("#remark-type").value;
  const remarkDetail = $("#remark-detail").value.trim();

  if (!itemId || !bookingDate || !startTime || !endTime) {
    setMessage(message, "请完整填写预约项目、日期和时间。", true);
    return;
  }

  if (remarkType === "其他" && !remarkDetail) {
    setMessage(message, "选择“其他”时请填写补充说明。", true);
    return;
  }

  const payload = {
    lab_id: LAB_ID,
    user_id: state.selectedUser.id,
    item_id: Number(itemId),
    start_time: buildIsoWithTimezone(bookingDate, startTime),
    end_time: buildIsoWithTimezone(bookingDate, endTime),
    remark_type: remarkType || "",
    remark_detail: remarkDetail,
  };

  try {
    await apiFetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setMessage(message, "预约成功。当前为纯链接版 MVP；如后续配置钉钉密钥，可开启预约前 30 分钟提醒。");
    event.target.reset();
    state.selectedUser = null;
    $("#selected-user").className = "selected-chip empty";
    $("#selected-user").textContent = "尚未选择预约人";
    $("#remark-detail-wrap").classList.add("hidden");
    setDateDefault();
    renderPresetSlots();
    await loadBookings();
    renderCalendar();
    renderBookingList();
  } catch (error) {
    if (error.status === 409 && error.data?.conflict) {
      const conflict = error.data.conflict;
      setMessage(
        message,
        `预约冲突：${conflict.item_name} ${formatDateTimeRange(new Date(conflict.start_time), new Date(conflict.end_time))}，预约人 ${conflict.user_name}（${conflict.student_id}）。`,
        true
      );
      return;
    }
    setMessage(message, error.message || "提交预约失败。", true);
  }
}

async function loadAdminBookings(options = {}) {
  const { silent = false } = options;
  const query = new URLSearchParams();
  const values = {
    lab_id: $("#admin-lab-id").value,
    item_id: $("#admin-item-id").value,
    q: $("#admin-q").value.trim(),
    start: $("#admin-start").value,
    end: $("#admin-end").value,
    remark_type: $("#admin-remark-type").value,
    status: $("#admin-status").value,
  };

  Object.entries(values).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });

  const message = $("#admin-message");
  if (!silent) {
    message.className = "message";
    message.textContent = "正在加载...";
  }

  try {
    const response = await apiFetch(`/api/admin/bookings?${query.toString()}`);
    renderAdminTable(response.bookings || []);
    updateDiagnostic("bookings", "ok", `管理员页已加载 ${response.bookings?.length || 0} 条记录`, query.toString() || "无筛选");
    if (!silent) {
      setMessage(message, `已加载 ${response.bookings?.length || 0} 条记录。`);
    }
  } catch (error) {
    renderAdminTable([]);
    updateDiagnostic("bookings", "error", error.message || "管理员预约接口失败", query.toString() || "无筛选");
    if (!silent) {
      setMessage(message, error.message || "加载失败。", true);
    }
  } finally {
    renderDiagnostics();
  }
}

function renderAdminTable(bookings) {
  const tbody = $("#admin-table-body");
  if (!bookings.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">没有符合条件的预约记录。</td></tr>`;
    return;
  }
  tbody.innerHTML = bookings
    .map((booking) => {
      const remark = getRemarkLabel(booking) || "-";
      return `
        <tr>
          <td>${escapeHtml(formatDateTimeRange(new Date(booking.start_time), new Date(booking.end_time)))}</td>
          <td>${escapeHtml(booking.lab_name)}</td>
          <td>${escapeHtml(booking.item_name)}</td>
          <td>${escapeHtml(booking.user_name)}</td>
          <td>${escapeHtml(booking.student_id)}</td>
          <td>${escapeHtml(remark)}</td>
          <td>${escapeHtml(booking.status)}</td>
          <td>${booking.remind_sent ? "已提醒" : "未提醒"}</td>
          <td>${escapeHtml(formatDateTime(new Date(booking.created_at)))}</td>
        </tr>
      `;
    })
    .join("");
}

function populateAdminFilters() {
  const labSelect = $("#admin-lab-id");
  const itemSelect = $("#admin-item-id");

  labSelect.innerHTML = `<option value="">全部实验室</option>${state.labs
    .map((lab) => `<option value="${lab.id}">${escapeHtml(lab.name)}</option>`)
    .join("")}`;

  itemSelect.innerHTML = `<option value="">全部项目</option>${state.items
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
    .join("")}`;
}

function exportAdminCsv() {
  const query = new URLSearchParams();
  [
    ["lab_id", $("#admin-lab-id").value],
    ["item_id", $("#admin-item-id").value],
    ["q", $("#admin-q").value.trim()],
    ["start", $("#admin-start").value],
    ["end", $("#admin-end").value],
    ["remark_type", $("#admin-remark-type").value],
    ["status", $("#admin-status").value],
  ].forEach(([key, value]) => {
    if (value) query.set(key, value);
  });

  const url = `${API_BASE}/api/admin/bookings.csv?${query.toString()}`;
  window.open(url, "_blank", "noopener");
}

function bindBookingDetailTriggers(root) {
  root.querySelectorAll("[data-booking-id]").forEach((node) => {
    node.addEventListener("click", () => openBookingDetail(Number(node.dataset.bookingId)));
  });
}

function openBookingDetail(bookingId) {
  const booking = state.bookings.find((entry) => entry.id === bookingId);
  if (!booking) return;
  const remark = getRemarkLabel(booking);
  $("#detail-body").innerHTML = `
    <h3>${escapeHtml(booking.item_name)}</h3>
    <p>实验室：${escapeHtml(booking.lab_name)}</p>
    <p>预约人：${escapeHtml(booking.user_name)}（${escapeHtml(booking.student_id)}）</p>
    <p>时间：${escapeHtml(formatDateTimeRange(new Date(booking.start_time), new Date(booking.end_time)))}</p>
    ${remark ? `<p>备注：${escapeHtml(remark)}</p>` : `<p>备注：无</p>`}
    <p>状态：${escapeHtml(booking.status)}</p>
  `;
  $("#booking-detail-dialog").showModal();
}

function getFilteredBookings() {
  return state.bookings.filter((booking) => {
    if (state.selectedItemFilter !== "all" && String(booking.item_id) !== String(state.selectedItemFilter)) {
      return false;
    }
    return true;
  });
}

function getVisibleDays() {
  const span = state.view === "day" ? 1 : state.view === "three" ? 3 : state.view === "week" ? 7 : 30;
  return Array.from({ length: span }, (_, index) => addDays(state.anchorDate, index));
}

function shiftRange(direction) {
  const step = state.view === "day" ? 1 : state.view === "three" ? 3 : state.view === "week" ? 7 : 30;
  state.anchorDate = addDays(state.anchorDate, direction * step);
  renderCalendar();
}

function assignColumns(bookings) {
  const active = [];
  let max = 0;
  bookings.forEach((booking) => {
    const start = new Date(booking.start_time).getTime();
    for (let index = active.length - 1; index >= 0; index -= 1) {
      if (active[index].end <= start) active.splice(index, 1);
    }
    const used = new Set(active.map((entry) => entry.column));
    let column = 0;
    while (used.has(column)) column += 1;
    active.push({ end: new Date(booking.end_time).getTime(), column });
    max = Math.max(max, active.length);
    booking._columnIndex = column;
    booking._columnCount = max;
  });

  bookings.forEach((booking) => {
    booking._columnCount = max;
  });
  return bookings;
}

function buildIsoWithTimezone(dateText, timeText) {
  return `${dateText}T${timeText}:00+08:00`;
}

function setDateDefault() {
  $("#booking-date").value = formatDateInput(new Date());
}

function setCustomTimes(start, end) {
  $("#custom-start").value = start;
  $("#custom-end").value = end;
}

function setMessage(node, text, isError = false) {
  node.textContent = text;
  node.className = `message ${isError ? "error" : "success"}`;
}

function updateDiagnostic(key, status, detail, meta = "") {
  if (!state.diagnostics[key]) return;
  state.diagnostics[key] = {
    ...state.diagnostics[key],
    status,
    detail,
    meta,
  };
}

function renderDiagnostics() {
  const grid = $("#diagnostics-grid");
  if (!grid) return;
  grid.innerHTML = Object.values(state.diagnostics)
    .map(
      (item) => `
        <article class="diagnostic-card ${item.status}">
          <h4>${escapeHtml(item.label)}</h4>
          <p class="diagnostic-status">${escapeHtml(item.detail)}</p>
          <p class="diagnostic-meta">${escapeHtml(item.meta || "")}</p>
        </article>
      `
    )
    .join("");
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    cache: "no-store",
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || "请求失败");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function getRemarkLabel(booking) {
  if (!booking.remark_type) return "";
  if (booking.remark_type === "其他" && booking.remark_detail) {
    return `其他 - ${booking.remark_detail}`;
  }
  return booking.remark_detail && booking.remark_type !== "其他"
    ? `${booking.remark_type}：${booking.remark_detail}`
    : booking.remark_type;
}

function getRangeLabel(days) {
  if (!days.length) return "";
  return `${formatDateDisplay(days[0])} - ${formatDateDisplay(days[days.length - 1])}`;
}

function formatDayLabel(date) {
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${date.getMonth() + 1}/${date.getDate()} ${weekdays[date.getDay()]}`;
}

function formatDateDisplay(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(date) {
  return `${formatDateDisplay(date)} ${formatTime(date)}`;
}

function formatTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatTimeRange(start, end) {
  return `${formatTime(start)}-${formatTime(end)}`;
}

function formatDateTimeRange(start, end) {
  return `${formatDateDisplay(start)} ${formatTime(start)}-${formatTime(end)}`;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}
