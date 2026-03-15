function $(selector) {
    return document.querySelector(selector);
}

function $all(selector) {
    return Array.from(document.querySelectorAll(selector));
}

async function api(path, options = {}) {
    const res = await fetch(path, {
        headers: { "Content-Type": "application/json" },
        ...options,
    });
    if (!res.ok) {
        let msg = "请求失败";
        try {
            const data = await res.json();
            msg = data.error || msg;
        } catch (_) {
            // ignore
        }
        throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
}

// Tabs
function activateTab(tab) {
    const btn = document.querySelector(`.tab-button[data-tab="${tab}"]`);
    if (!btn) return;
    $all(".tab-button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $all(".tab-content").forEach((el) => {
        el.classList.toggle("active", el.id === `tab-${tab}`);
    });
}

$all(".tab-button").forEach((btn) => {
    btn.addEventListener("click", () => {
        activateTab(btn.dataset.tab);
    });
});

let cardsCache = [];
let todayData = null;
let studyCardsShuffled = [];
let currentStudyCard = null;
let currentStudyIndex = -1;
let editingPlan = null;

function shuffle(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function renderToday() {
    if (!todayData) return;
    $("#today-date").textContent = todayData.date;

    const total = todayData.stats.total;
    const remembered = todayData.stats.remembered;
    $("#progress-text").textContent = `进度：${remembered} / ${total}`;
    $("#progress-bar-inner").style.width = total ? `${(remembered / total) * 100}%` : "0%";

    const list = $("#study-list");
    list.innerHTML = "";

    if (!total) {
        $("#today-empty").classList.remove("hidden");
        return;
    }
    $("#today-empty").classList.add("hidden");

    studyCardsShuffled.forEach((card, index) => {
        const status = todayData.progress?.[String(card.id)];
        const cardEl = document.createElement("div");
        cardEl.className = "card";
        cardEl.innerHTML = `
            <div class="card-title">${card.title}</div>
            <div class="card-key">${card.key_points || "（无关键点）"}</div>
            <div class="card-footer">
                <span>${status === "remembered" ? "已记住" : "待记忆"}</span>
                <span class="badge ${
                    status === "remembered" ? "badge-remembered" : status ? "badge-not" : ""
                }">${status === "remembered" ? "记住了" : status ? "没记住" : ""}</span>
            </div>
        `;
        cardEl.addEventListener("click", () => openStudyModal(card, status, index));
        list.appendChild(cardEl);
    });
}

function renderCardsList() {
    const container = $("#cards-list");
    container.innerHTML = "";
    cardsCache.forEach((card) => {
        const item = document.createElement("div");
        item.className = "card";
        item.innerHTML = `
            <input type="checkbox" class="card-checkbox" data-card-id="${card.id}">
            <div class="card-title">${card.title}</div>
            <div class="card-key">${card.key_points || "（无关键点）"}</div>
            <div class="card-footer">
                <span>ID: ${card.id}</span>
                <span>点击编辑</span>
                <button type="button" class="icon-button card-delete-btn" data-card-id="${card.id}" title="删除卡片">✕</button>
            </div>
        `;
        item.addEventListener("click", (e) => {
            if (e.target.matches("input[type='checkbox']") || e.target.closest(".card-delete-btn")) return;
            openCardModal(card);
        });
        const deleteBtn = item.querySelector(".card-delete-btn");
        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`确定要删除卡片「${card.title}」吗？`)) return;
            try {
                await api(`/api/cards/${card.id}`, { method: "DELETE" });
                await loadAll();
            } catch (err) {
                alert(err.message || "删除失败");
            }
        });
        container.appendChild(item);
    });
}

function renderPlansList(plans) {
    const container = $("#plans-list");
    container.innerHTML = "";
    if (!plans.length) {
        container.innerHTML = `<p style="color:#6b7280;font-size:0.85rem;">暂无计划</p>`;
        return;
    }
    const cardsById = new Map(cardsCache.map((c) => [c.id, c]));
    plans.forEach((p) => {
        const item = document.createElement("div");
        item.className = "plan-item";
        const inDaily = p.include_in_daily ?? true;
        const planName = p.name || `计划 #${p.id}`;
        const cardIds = p.card_ids || [];
        const cardsHtml =
            cardIds
                .map((id) => {
                    const c = cardsById.get(id);
                    if (!c) {
                        return `<li class="plan-card-item"><span class="plan-card-title">卡片 #${id}</span></li>`;
                    }
                    return `<li class="plan-card-item"><span class="plan-card-title">${c.title}</span><span class="plan-card-key">${c.key_points || ""}</span></li>`;
                })
                .join("") || `<li class="plan-card-item plan-card-empty">该计划当前没有包含卡片</li>`;
        item.innerHTML = `
            <div class="plan-summary">
                <div>
                    <div class="plan-title">${planName}</div>
                    <div class="plan-meta">${p.start_date} ~ ${p.end_date} · ${cardIds.length} 张卡片</div>
                </div>
                <div class="plan-actions">
                    <button class="secondary plan-expand-btn" style="padding:2px 8px;font-size:0.75rem;border-radius:999px;">展开</button>
                    <button class="secondary plan-toggle-daily-btn" data-plan-id="${p.id}" data-in-daily="${inDaily ? "1" : "0"}" style="padding:2px 8px;font-size:0.75rem;border-radius:999px;">
                        ${inDaily ? "从每日移除" : "加入每日"}
                    </button>
                    <button data-plan-id="${p.id}" class="icon-button plan-delete-btn" title="删除计划">✕</button>
                </div>
            </div>
            <div class="plan-details hidden">
                <div class="plan-daily-badge ${inDaily ? "on" : "off"}">
                    每日背诵计划：${inDaily ? "已加入" : "未加入"}
                </div>
                <ul class="plan-card-list">
                    ${cardsHtml}
                </ul>
            </div>
        `;
        const expandBtn = item.querySelector(".plan-expand-btn");
        const toggleBtn = item.querySelector(".plan-toggle-daily-btn");
        const deleteBtn = item.querySelector(".plan-delete-btn");
        const details = item.querySelector(".plan-details");
        const editBtn = document.createElement("button");
        editBtn.className = "secondary";
        editBtn.style.padding = "2px 8px";
        editBtn.style.fontSize = "0.75rem";
        editBtn.style.borderRadius = "999px";
        editBtn.textContent = "编辑";
        item.querySelector(".plan-actions").insertBefore(editBtn, toggleBtn);

        expandBtn.addEventListener("click", () => {
            const hidden = details.classList.toggle("hidden");
            expandBtn.textContent = hidden ? "展开" : "收起";
        });

        editBtn.addEventListener("click", () => {
            openPlanModal(p);
        });

        toggleBtn.addEventListener("click", async () => {
            const current = toggleBtn.getAttribute("data-in-daily") === "1";
            try {
                await api(`/api/plans/${p.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ include_in_daily: !current }),
                });
                await loadAll();
            } catch (e) {
                alert(e.message);
            }
        });
        deleteBtn.addEventListener("click", async () => {
            if (!confirm("确定要删除该计划吗？")) return;
            try {
                await api(`/api/plans/${p.id}`, { method: "DELETE" });
                await loadAll();
            } catch (e) {
                alert(e.message);
            }
        });
        container.appendChild(item);
    });
}

async function loadCards() {
    cardsCache = await api("/api/cards");
    renderCardsList();
}

async function loadToday() {
    todayData = await api("/api/today-plan");
    studyCardsShuffled = shuffle(todayData.cards);
    renderToday();
}

async function loadPlans() {
    const plans = await api("/api/plans");
    renderPlansList(plans);
}

async function loadAll() {
    // 优先加载“今日进度”，让首页更快可用，再加载卡片和计划
    await loadToday();
    await loadCards();
    await loadPlans();
}

// Card modal (create/edit)
const cardModal = $("#card-modal");
let editingCard = null;

function openCardModal(card) {
    editingCard = card || null;
    $("#card-modal-title").textContent = card ? "编辑卡片" : "新建卡片";
    $("#card-title-input").value = card?.title || "";
    $("#card-key-input").value = card?.key_points || "";
    $("#card-content-input").value = card?.content || "";
    $("#card-delete-btn").style.display = card ? "inline-flex" : "none";
    cardModal.classList.remove("hidden");
}

function closeCardModal() {
    cardModal.classList.add("hidden");
}

$("#new-card-btn").addEventListener("click", () => openCardModal(null));
$("#card-modal-close").addEventListener("click", closeCardModal);
$("#card-cancel-btn").addEventListener("click", closeCardModal);
cardModal.querySelector(".modal-backdrop").addEventListener("click", closeCardModal);

$("#card-save-btn").addEventListener("click", async () => {
    const title = $("#card-title-input").value.trim();
    const key_points = $("#card-key-input").value.trim();
    const content = $("#card-content-input").value;
    if (!title) {
        alert("题目不能为空");
        return;
    }
    try {
        if (editingCard) {
            await api(`/api/cards/${editingCard.id}`, {
                method: "PUT",
                body: JSON.stringify({ title, key_points, content }),
            });
        } else {
            await api("/api/cards", {
                method: "POST",
                body: JSON.stringify({ title, key_points, content }),
            });
        }
        closeCardModal();
        await loadAll();
    } catch (e) {
        alert(e.message);
    }
});

$("#card-delete-btn").addEventListener("click", async () => {
    if (!editingCard) return;
    if (!confirm("确定要删除该卡片吗？")) return;
    try {
        await api(`/api/cards/${editingCard.id}`, { method: "DELETE" });
        closeCardModal();
        await loadAll();
    } catch (e) {
        alert(e.message);
    }
});

// Study modal
const studyModal = $("#study-modal");

function openStudyModal(card, status, index) {
    currentStudyCard = card;
    currentStudyIndex = typeof index === "number" ? index : studyCardsShuffled.findIndex((c) => c.id === card.id);
    $("#study-modal-title").textContent = card.title;
    $("#study-modal-key").textContent = card.key_points || "";
    const answer = $("#study-answer");
    // 延迟渲染 Markdown，避免每次打开卡片都解析大段文本造成卡顿
    answer.innerHTML = "";
    answer.classList.add("hidden");
    answer.dataset.cardId = String(card.id);
    $("#toggle-answer-btn").textContent = "查看答案";
    studyModal.classList.remove("hidden");
}

function closeStudyModal() {
    studyModal.classList.add("hidden");
}

$("#study-modal-close").addEventListener("click", closeStudyModal);
studyModal.querySelector(".modal-backdrop").addEventListener("click", closeStudyModal);

$("#toggle-answer-btn").addEventListener("click", () => {
    const answer = $("#study-answer");
    const hidden = answer.classList.toggle("hidden");
    if (!hidden) {
        // 仅在首次展示答案时解析 Markdown，并按卡片缓存，减少重复解析开销
        const currentId = currentStudyCard ? String(currentStudyCard.id) : "";
        if (!answer.innerHTML || answer.dataset.cardId !== currentId) {
            answer.innerHTML = marked.parse((currentStudyCard && currentStudyCard.content) || "");
            answer.dataset.cardId = currentId;
        }
    }
    $("#toggle-answer-btn").textContent = hidden ? "查看答案" : "隐藏答案";
});

$all(".status-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        if (!currentStudyCard || currentStudyIndex < 0) return;
        const status = btn.dataset.status;
        try {
            await api("/api/progress", {
                method: "POST",
                body: JSON.stringify({ card_id: currentStudyCard.id, status }),
            });

            // 本地更新进度数据与统计
            if (!todayData.progress) todayData.progress = {};
            todayData.progress[String(currentStudyCard.id)] = status;
            const total = studyCardsShuffled.length;
            const rememberedCount = studyCardsShuffled.filter(
                (c) => todayData.progress[String(c.id)] === "remembered"
            ).length;
            todayData.stats = { remembered: rememberedCount, total };

            renderToday();

            // 跳过已记住的卡片，找下一张待记忆的
            let nextIndex = currentStudyIndex + 1;
            while (nextIndex < studyCardsShuffled.length && todayData.progress?.[String(studyCardsShuffled[nextIndex].id)] === "remembered") {
                nextIndex++;
            }
            closeStudyModal();

            if (nextIndex < studyCardsShuffled.length) {
                const nextCard = studyCardsShuffled[nextIndex];
                const nextStatus = todayData.progress[String(nextCard.id)];
                openStudyModal(nextCard, nextStatus, nextIndex);
            }
        } catch (e) {
            alert(e.message);
        }
    });
});

// Shuffle
$("#shuffle-btn").addEventListener("click", () => {
    if (!todayData) return;
    studyCardsShuffled = shuffle(todayData.cards);
    currentStudyIndex = -1;
    renderToday();
});

// Manage plan (jump to plan tab)
$("#add-plan-btn").addEventListener("click", () => {
    activateTab("plans");
    const plansList = $("#plans-list");
    if (plansList) {
        plansList.scrollIntoView({ behavior: "smooth", block: "start" });
    }
});

// Clear progress: all cards become not remembered
$("#clear-progress-btn").addEventListener("click", async () => {
    if (!confirm("确定要清空全部进度吗？所有卡片将变为「未记住」状态。")) return;
    try {
        await api("/api/progress/clear", { method: "POST" });
        await loadToday();
    } catch (e) {
        alert(e.message || "清空失败");
    }
});

// Plan modal (create / edit)
const planModal = $("#plan-modal");

function buildPlanCardLists(selectedIds) {
    const selectedList = $("#plan-selected-list");
    const availableList = $("#plan-available-list");
    selectedList.innerHTML = "";
    availableList.innerHTML = "";

    if (!cardsCache.length) {
        selectedList.innerHTML = `<p style="color:#6b7280;font-size:0.85rem;margin:0;">当前没有可用卡片，请先在“卡片管理”中创建。</p>`;
        return;
    }

    cardsCache.forEach((card) => {
        const isSelected = selectedIds.has(card.id);
        const row = document.createElement("div");
        row.className = "plan-card-select-item";
        row.innerHTML = `
            <div class="plan-card-select-main">
                <span class="plan-card-select-title">${card.title}</span>
                <span class="plan-card-select-key">${card.key_points || ""}</span>
            </div>
            <button class="plan-card-select-btn" data-card-id="${card.id}">
                ${isSelected ? "-" : "+"}
            </button>
        `;
        const btn = row.querySelector(".plan-card-select-btn");
        btn.addEventListener("click", () => {
            if (selectedIds.has(card.id)) {
                selectedIds.delete(card.id);
            } else {
                selectedIds.add(card.id);
            }
            buildPlanCardLists(selectedIds);
        });
        if (isSelected) {
            selectedList.appendChild(row);
        } else {
            availableList.appendChild(row);
        }
    });
}

let currentPlanSelectedIds = new Set();

function openPlanModal(plan) {
    const today = new Date().toISOString().slice(0, 10);
    editingPlan = plan && typeof plan === "object" && plan.id != null && plan.id !== "undefined" ? plan : null;

    if (editingPlan) {
        $("#plan-modal-title").textContent = "编辑计划";
        $("#plan-name-input").value = editingPlan.name || "";
        $("#plan-start-input").value = editingPlan.start_date;
        $("#plan-end-input").value = editingPlan.end_date;
        $("#plan-include-input").checked = editingPlan.include_in_daily ?? true;
        currentPlanSelectedIds = new Set(editingPlan.card_ids || []);
    } else {
        $("#plan-modal-title").textContent = "新建计划";
        $("#plan-name-input").value = "";
        $("#plan-start-input").value = today;
        $("#plan-end-input").value = today;
        $("#plan-include-input").checked = true;
        currentPlanSelectedIds = new Set();
    }

    buildPlanCardLists(currentPlanSelectedIds);
    planModal.classList.remove("hidden");
}

function closePlanModal() {
    planModal.classList.add("hidden");
}

$("#new-plan-btn").addEventListener("click", () => openPlanModal());
$("#plan-modal-close").addEventListener("click", closePlanModal);
$("#plan-cancel-btn").addEventListener("click", closePlanModal);
planModal.querySelector(".modal-backdrop").addEventListener("click", closePlanModal);

$("#plan-save-btn").addEventListener("click", async () => {
    const name = $("#plan-name-input").value.trim();
    const start = $("#plan-start-input").value;
    const end = $("#plan-end-input").value;
    const includeDaily = $("#plan-include-input").checked;
    const checked = Array.from(currentPlanSelectedIds);

    if (!start || !end) {
        alert("请选择开始和结束日期");
        return;
    }
    if (!checked.length) {
        alert("请至少选择一张卡片");
        return;
    }

    try {
        if (editingPlan != null && editingPlan.id != null && editingPlan.id !== "undefined") {
            await api(`/api/plans/${editingPlan.id}`, {
                method: "PUT",
                body: JSON.stringify({
                    name,
                    card_ids: checked,
                    start_date: start,
                    end_date: end,
                    include_in_daily: includeDaily,
                }),
            });
        } else {
            await api("/api/plans", {
                method: "POST",
                body: JSON.stringify({
                    name,
                    card_ids: checked,
                    start_date: start,
                    end_date: end,
                    include_in_daily: includeDaily,
                }),
            });
        }
        closePlanModal();
        await loadAll();
        alert(editingPlan ? "计划已更新" : "计划已创建");
    } catch (e) {
        alert(e.message);
    }
});

// Init
document.addEventListener("DOMContentLoaded", () => {
    loadAll().catch((e) => console.error(e));
});

