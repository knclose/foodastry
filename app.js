// ===== Кулинарная книга — логика приложения =====
'use strict';

/* ---------- Утилиты ---------- */
const $ = sel => document.querySelector(sel);

const UNITS = [
  { v: 'г',   label: 'граммы',        title: 'г' },
  { v: 'мл',  label: 'миллилитры',    title: 'мл' },
  { v: 'ст.л.', label: 'столовые ложки', title: 'ст. ложка' },
  { v: 'ч.л.',  label: 'чайные ложки',   title: 'ч. ложка' },
  { v: 'шт',    label: 'штуки',          title: 'шт' },
];
const unitLabel = v => (UNITS.find(u => u.v === v) || {}).title || v;

function norm(s) {
  return String(s || '').toLowerCase().trim().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const fmt0 = n => Math.round(n).toLocaleString('ru-RU');

/* ---------- Справочник продуктов ---------- */
function findFood(name) {
  const q = norm(name);
  if (!q) return null;
  if (ALL_FOODS[q]) return q;
  // частичное совпадение: сначала «запрос начинается с ключа», потом «ключ начинается с запроса», потом «вхождение»
  const keys = Object.keys(ALL_FOODS);
  let best = null;
  for (const k of keys) if (k.startsWith(q) && (best === null || k.length < best.length)) best = k;
  if (best) return best;
  for (const k of keys) if (q.startsWith(k) && (best === null || k.length > best.length)) best = k;
  if (best) return best;
  for (const k of keys) if (k.includes(q) && (best === null || k.length < best.length)) best = k;
  if (best) return best;
  // мягкий запасной вариант: часто последняя буква слова — падежное окончание
  // («муки» → «мук» совпадёт с «мука пшеничная»)
  if (q.length > 4) {
    const q2 = q.slice(0, -1);
    for (const k of keys) if (k.includes(q2)) return k;
  }
  return null;
}

// Заполнение ingr данными из справочника
function applyFood(ing, foodKey, force) {
  const f = foodKey ? ALL_FOODS[foodKey] : null;
  if (!f) return false;
  const set = (field, val) => { if (force || ing[field] === undefined || ing[field] === null || ing[field] === '') ing[field] = val; };
  set('k', f.k); set('p', f.p); set('f', f.f); set('c', f.c);
  if (f.tbsp !== undefined) set('tbsp', f.tbsp);
  if (f.tsp  !== undefined) set('tsp',  f.tsp);
  if (f.piece !== undefined) set('piece', f.piece);
  if (f.d    !== undefined) set('d',    f.d);
  ing.food = foodKey;
  ing.source = 'auto';
  return true;
}

/* ---------- Расчёты ---------- */
// Справочник продукта для ингредиента (явные значения > автоподстановка)
function foodFor(ing) {
  return ALL_FOODS[ing.food] || ALL_FOODS[findFood(ing.name)] || null;
}

function unitGrams(ing) {
  const amount = Number(ing.amount) || 0;
  const f = foodFor(ing) || {};
  switch (ing.unit) {
    case 'г':   return amount;
    case 'мл':  return amount * (Number(ing.d) || 1);
    case 'ст.л.': return amount * (Number(ing.tbsp) || f.tbsp || 18);
    case 'ч.л.':  return amount * (Number(ing.tsp)  || f.tsp  || 6);
    case 'шт':    return amount * (Number(ing.piece) || f.piece || 50);
    default: return amount;
  }
}

function ingKbju(ing, grams) {
  const g = grams !== undefined ? grams : unitGrams(ing);
  const f = foodFor(ing) || {};
  return {
    k: (Number(ing.k !== undefined ? ing.k : f.k) || 0) * g / 100,
    p: (Number(ing.p !== undefined ? ing.p : f.p) || 0) * g / 100,
    f: (Number(ing.f !== undefined ? ing.f : f.f) || 0) * g / 100,
    c: (Number(ing.c !== undefined ? ing.c : f.c) || 0) * g / 100,
  };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function recipeTotals(r) {
  let g = 0, k = 0, p = 0, f = 0, c = 0;
  for (const ing of r.ingredients || []) {
    const grams = unitGrams(ing);
    const n = ingKbju(ing, grams);
    g += grams; k += n.k; p += n.p; f += n.f; c += n.c;
  }
  const servings = Number(r.servings) || 1;
  return {
    grams: g, k: k, p: p, f: f, c: c,
    perServing: { k: k / servings, p: p / servings, f: f / servings, c: c / servings },
    per100: g > 0 ? { k: k * 100 / g, p: p * 100 / g, f: f * 100 / g, c: c * 100 / g } : { k: 0, p: 0, f: 0, c: 0 },
  };
}

/* ---------- Состояние ---------- */
let recipes = [];
let currentView = 'list';
let editingId = null;      // null => новый рецепт
let currentRecipeId = null;
let searchMode = 'name';
let debounceTimer = null;
let recipesLoaded = false;

// --- Справочник ингредиентов ---
// Живёт в облаке Supabase (таблица foods): добавили на компьютере —
// сразу видно на телефоне.
let ALL_FOODS = {};            // карта «имя → {k,p,f,c,tbsp,tsp,piece,d}»
let pendingFoodName = null;    // имя, с которого открыли форму из редактора
let foodsReturnToEditor = false;
let foodsReturnId = null;      // id рецепта, из редактора которого ушли
let foodFormKey = null;        // ключ редактируемого ингредиента (null = новый)

async function loadCustomFoods() {
  ALL_FOODS = await db.loadFoods();
}

/* ---------- Маршруты (интеграция с историей браузера) ----------
   Каждый экран получает свой адрес и попадает в историю:
     #/             — список рецептов
     #/recipe/<id>  — просмотр рецепта
     #/edit/<id>    — редактирование рецепта
     #/new          — новый рецепт
   Кнопка «Назад» в браузере возвращает по шагам, а не «выбрасывает»
   на стартовую страницу.                                                */
function routeHash(kind, id) {
  if (kind === 'home') return '#/';
  if (kind === 'list') return '#/recipes';
  if (kind === 'foods') return '#/foods';
  if (kind === 'new')  return '#/new';
  if (kind === 'edit')   return '#/edit/' + id;
  return '#/recipe/' + id;
}

function navigate(hash, replace) {
  if (location.hash === hash) { applyRoute(); return; }
  if (replace) location.replace(hash);
  else location.hash = hash;
}

// открыть экран по текущему хешу; при проблемах — мягкий откат на список
function applyRoute() {
  if (!recipesLoaded) return; // маршрутизатор запустится после загрузки данных
  const h = location.hash;
  const mRecipe = h.match(/^#\/recipe\/([^/]+)$/);
  const mEdit = h.match(/^#\/edit\/([^/]+)$/);

  if (mRecipe) {
    const r = recipes.find(x => x.id === mRecipe[1]);
    if (r) { currentRecipeId = r.id; showView('recipe'); renderRecipeView(r); return; }
  } else if (mEdit) {
    const r = recipes.find(x => x.id === mEdit[1]);
    if (r) { openEditor(r); return; }
  } else if (h === '#/new') {
    openEditor(null); return;
  } else if (h === '#/foods') {
    showView('foods'); renderFoods();
    if (pendingFoodName) { openFoodForm(null, pendingFoodName); pendingFoodName = null; }
    return;
  } else if (h === '#/recipes' || h === '#/list') {
    showView('list'); renderList(); return;
  } else if (h === '#/dashboard') {
    showView('dashboard'); renderDashboard(); return;
  } else if (h === '#/' || h === '' || h === '#') {
    showView('dashboard'); renderDashboard(); return;
  }
  // неизвестный маршрут/рецепт удалён — тихо заменяем адрес на дашборд
  location.replace('#/');
  showView('dashboard'); renderDashboard();
}

/* ---------- Переключение видов ---------- */
// каскадное появление: всем элементам по селектору назначаем задержку --i
function animateIn(root, selector) {
  if (!root) return;
  [...root.querySelectorAll(selector)].forEach((el, i) => {
    el.style.setProperty('--i', i);
    el.classList.add('view-in');
  });
}
function showView(view) {
  currentView = view;
  $('#viewDashboard').hidden = view !== 'dashboard';
  $('#viewList').hidden = view !== 'list';
  $('#viewFoods').hidden = view !== 'foods';
  $('#viewEditor').hidden = view !== 'editor';
  $('#viewRecipe').hidden = view !== 'recipe';
  $('#navList').classList.toggle('active', view === 'list');
  $('#navFoods').classList.toggle('active', view === 'foods');
  $('#navNew').classList.toggle('active', view === 'editor');

  // мягкий «въезд» нового экрана (перезапускаем анимацию при повторном открытии)
  const secMap = { dashboard: '#viewDashboard', list: '#viewList', foods: '#viewFoods',
                   editor: '#viewEditor', recipe: '#viewRecipe' };
  const sec = $(secMap[view]);
  if (sec) {
    sec.classList.remove('view-enter');
    void sec.offsetWidth; // сброс, чтобы анимация проигралась заново
    sec.classList.add('view-enter');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- Дашборд (главная) ---------- */
function plural(n, one, few, many) {
  const m = Math.abs(Math.floor(n % 100));
  const d = n % 10;
  if (m >= 11 && m <= 14) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

function renderDashboard() {
  const sec = $('#viewDashboard');

  const now = new Date();
  const dateStr = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  const nRecipes = recipes.length;
  const nFoods = Object.keys(ALL_FOODS).length;
  const servings = recipes.reduce((s, r) => s + (Number(r.servings) || 1), 0);
  let avgKcal = 0;
  if (nRecipes) {
    avgKcal = recipes.reduce((s, r) => s + recipeTotals(r).perServing.k, 0) / nRecipes;
  }

  // «Рецепт дня» — выбирается по дате: меняется сам раз в сутки
  let dayRecipe = null;
  if (nRecipes) {
    const sorted = [...recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    dayRecipe = sorted[Math.floor(Date.now() / 86400000) % sorted.length];
  }
  const dayTotals = dayRecipe ? recipeTotals(dayRecipe) : null;

  const recent = [...recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);

  const greet = now.getHours() < 12 ? 'Доброе утро' : now.getHours() < 18 ? 'Добрый день' : 'Добрый вечер';

  const stat = (label, value, icon) => `
    <div class="dash-stat">
      <div class="st-top"><span class="st-icon">${icon}</span><span class="st-label">${label}</span></div>
      <div class="st-value">${value}</div>
    </div>`;

  sec.innerHTML = `
    <div class="dash-hero">
      <div>
        <h2 class="dash-title">${greet} ✿</h2>
        <p class="dash-sub">${escHtml(dateStr)}${nRecipes
          ? ` · в книге ${nRecipes} ${plural(nRecipes, 'рецепт', 'рецепта', 'рецептов')}`
          : ' · книга ещё пустая — всё впереди'}</p>
      </div>
      <button class="btn primary" id="dashNew">＋ Новый рецепт</button>
    </div>

    <div class="dash-stats">
      ${stat('Рецептов', fmt0(nRecipes), '📖')}
      ${stat('Ингредиентов', fmt0(nFoods), '🌿')}
      ${stat('Порций', fmt0(servings), '🍽')}
      ${stat('Ккал на порцию', nRecipes ? '≈ ' + fmt0(avgKcal) : '—', '🔥')}
    </div>

    <div class="dash-cols">
      <div class="card dash-day">
        <h3 class="sub-title dash-t">Рецепт дня</h3>
        ${dayRecipe ? `
          <div class="dash-day-recipe" id="dashOpenDay" role="button" tabindex="0">
            <h4>${escHtml(dayRecipe.title)}</h4>
            <p class="dash-day-kcal">
              <b>${fmt0(dayTotals.perServing.k)} ккал</b> на порцию ·
              Б ${fmt1(dayTotals.perServing.p)} · Ж ${fmt1(dayTotals.perServing.f)} · У ${fmt1(dayTotals.perServing.c)}
            </p>
            ${dayRecipe.description ? `<p class="dash-day-desc">${escHtml(dayRecipe.description)}</p>` : ''}
            <span class="dash-day-hint">нажмите, чтобы открыть →</span>
          </div>` : `
          <p class="dash-empty-line">Ингредиентов ещё нет, рецептов тоже —<br>добавьте первый, и здесь появится мотивация на день ✦</p>
          <button class="btn ghost small" id="dashGoFoods">🌿 Наполнить базу ингредиентов</button>`}
        <div class="dash-panel-foot"><a href="#/recipes" id="dashAllLink">Все рецепты →</a></div>
      </div>

      <div class="card dash-recent">
        <h3 class="sub-title dash-t">Недавно менялось</h3>
        ${recent.length ? recent.map(r => {
          const t = recipeTotals(r);
          return `<div class="dash-recent-row" data-rid="${r.id}" role="button" tabindex="0">
            <span class="dr-name">${escHtml(r.title)}</span>
            <span class="dr-kcal">${fmt0(t.perServing.k)} ккал</span>
          </div>`;
        }).join('') : '<p class="dash-empty-line">Сюда встанут ваши свежие рецепты.</p>'}
      </div>
    </div>`;

  animateIn(sec, '.dash-stat');
  animateIn(sec, '.dash-day-recipe');
  animateIn(sec, '.dash-recent-row');

  const openRecipe = id => navigate(routeHash('recipe', id));
  $('#dashNew').addEventListener('click', () => navigate(routeHash('new')));
  $('#dashAllLink').addEventListener('click', e => { e.preventDefault(); navigate(routeHash('list')); });

  if (dayRecipe) {
    const el = $('#dashOpenDay');
    el.addEventListener('click', () => openRecipe(dayRecipe.id));
    el.addEventListener('keydown', e => { if (e.key === 'Enter') openRecipe(dayRecipe.id); });
  } else {
    $('#dashGoFoods').addEventListener('click', () => navigate(routeHash('foods')));
  }

  for (const row of sec.querySelectorAll('.dash-recent-row')) {
    row.addEventListener('click', () => openRecipe(row.dataset.rid));
    row.addEventListener('keydown', e => { if (e.key === 'Enter') openRecipe(row.dataset.rid); });
  }
}

/* ---------- Список рецептов и поиск ---------- */
function renderList() {
  const q = norm($('#searchInput').value);
  const grid = $('#recipeGrid');
  let items = [...recipes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  let hint = '';
  let ingTerms = [];

  if (q) {
    if (searchMode === 'name') {
      items = items.filter(r =>
        norm(r.title).includes(q) || norm(r.description || '').includes(q));
      hint = `Найдено рецептов: ${items.length}`;
    } else {
      ingTerms = q.split(',').map(t => t.trim()).filter(Boolean);
      if (!ingTerms.length) {
        hint = 'Перечислите ингредиенты через запятую: творог, мука, яйцо';
        items = [];
      } else {
        items = items.filter(r => {
          const names = (r.ingredients || []).map(i => norm(i.name));
          const hit = ingTerms.map(t =>
            names.some(n => n.includes(t) || t.includes(n)));
          r._hitFlags = hit;
          const count = hit.filter(Boolean).length;
          r._hitCount = count;
          return count > 0;
        });
        items.sort((a, b) => b._hitCount - a._hitCount || (b.updatedAt || 0) - (a.updatedAt || 0));
        hint = 'Ищем рецепты с любым из ингредиентов — совпавшие подсвечены на карточках.';
      }
    }
  }
  $('#searchHint').textContent = hint;
  $('#searchHint').hidden = !hint;
  $('#searchInput').placeholder = searchMode === 'name'
    ? 'Например: кекс'
    : 'Ингредиенты через запятую: творог, мука, яйцо';

  $('#emptyState').hidden = items.length > 0;
  grid.innerHTML = '';
  for (const r of items) grid.appendChild(recipeCard(r, ingTerms));
  animateIn(grid, '.recipe-card');
}

function recipeCard(r, ingTerms) {
  const t = recipeTotals(r);
  const el = document.createElement('div');
  el.className = 'recipe-card';
  el.innerHTML = `
    <h3></h3>
    ${r.description ? '<div class="recipe-desc"></div>' : ''}
    <span class="kbju-chip">${fmt0(t.perServing.k)} ккал · Б ${fmt0(t.perServing.p)} / Ж ${fmt0(t.perServing.f)} / У ${fmt0(t.perServing.c)} на порцию</span>
    <div class="chips"></div>`;
  el.querySelector('h3').textContent = r.title;
  if (r.description) el.querySelector('.recipe-desc').textContent = r.description;
  const chips = el.querySelector('.chips');
  for (const ing of (r.ingredients || []).slice(0, 6)) {
    const chipEl = document.createElement('span');
    chipEl.className = 'chip';
    if (ingTerms && ingTerms.some(t => {
      const n = norm(ing.name);
      return n.includes(t) || t.includes(n);
    })) chipEl.classList.add('chip-hit');
    chipEl.textContent = ing.name;
    chips.appendChild(chipEl);
  }
  if ((r.ingredients || []).length > 6) {
    const more = document.createElement('span');
    more.className = 'chip';
    more.textContent = `+${r.ingredients.length - 6}`;
    chips.appendChild(more);
  }
  el.addEventListener('click', () => navigate(routeHash('recipe', r.id)));
  return el;
}

/* ---------- Просмотр рецепта ---------- */
function renderRecipeView(r) {
  currentRecipeId = r.id;
  const t = recipeTotals(r);

  const rows = (r.ingredients || []).map(ing => {
    const g = unitGrams(ing);
    const n = ingKbju(ing, g);
    const amountTxt = `${fmt1(Number(ing.amount) || 0)} ${unitLabel(ing.unit)}`;
    return `<tr>
      <td class="cell-name">${escHtml(ing.name)}</td>
      <td class="num">${amountTxt}</td>
      <td class="num">${fmt1(g)} г</td>
      <td class="cell-nut">${fmt0(n.k)} ккал · Б ${fmt1(n.p)} / Ж ${fmt1(n.f)} / У ${fmt1(n.c)}</td>
    </tr>`;
  });

  const sec = $('#viewRecipe');
  sec.innerHTML = `
    <div class="recipe-view">
      <div class="recipe-back"><button class="btn ghost small" id="btnBackToList">← ко всем рецептам</button></div>
      <div class="card">
        <h2></h2>
        <div class="recipe-meta"></div>
        ${r.description ? '<p class="desc"></p>' : ''}

        <div class="kbju-panels">
          <div class="kbju-box">
            <h4>НА ПОРЦИЮ</h4>
            <div class="kcal">${fmt0(t.perServing.k)} ккал</div>
            <div class="kpfc">Белки ${fmt1(t.perServing.p)} г · Жиры ${fmt1(t.perServing.f)} г · Углеводы ${fmt1(t.perServing.c)} г</div>
          </div>
          <div class="kbju-box">
            <h4>НА 100 Г БЛЮДА</h4>
            <div class="kcal">${fmt0(t.per100.k)} ккал</div>
            <div class="kpfc">Белки ${fmt1(t.per100.p)} г · Жиры ${fmt1(t.per100.f)} г · Углеводы ${fmt1(t.per100.c)} г</div>
          </div>
          <div class="kbju-box rose">
            <h4>ВСЁ БЛЮДО</h4>
            <div class="kcal">${fmt0(t.k)} ккал</div>
            <div class="kpfc">Общий вес ≈ ${fmt0(t.grams)} г · Белки ${fmt0(t.p)} · Жиры ${fmt0(t.f)} · Углеводы ${fmt0(t.c)} г</div>
          </div>
        </div>

        <h3 class="sub-title">Ингредиенты</h3>
        <table class="rv-table">
          <thead><tr>
            <th class="cell-name">Название</th><th>Кол-во</th><th>Вес</th><th>КБЖУ</th>
          </tr></thead>
          <tbody id="rvTbody"></tbody>
        </table>

        ${(r.steps && r.steps.length) ? `
          <h3 class="sub-title">Приготовление</h3>
          <ol class="steps">${r.steps.map(s => `<li></li>`).join('')}</ol>` : ''}

        <div class="rv-actions">
          <button class="btn" id="btnEditRecipe">Изменить</button>
          <button class="btn danger" id="btnDeleteRecipe">Удалить</button>
          <button class="btn ghost" id="btnPrint">Печать</button>
        </div>
      </div>
    </div>`;

  sec.querySelector('h2').textContent = r.title;
  const servings = Number(r.servings) || 1;
  sec.querySelector('.recipe-meta').textContent =
    `Порций: ${fmt1(servings)} · Ингредиентов: ${(r.ingredients || []).length}`;
  if (r.description) sec.querySelector('.desc').textContent = r.description;

  const tbody = sec.querySelector('#rvTbody');
  tbody.innerHTML = rows.join('');

  const stepsEl = sec.querySelectorAll('.steps li');
  if (sec.querySelector('.steps')) {
    (r.steps || []).forEach((s, i) => stepsEl[i].textContent = s);
  }

  sec.querySelector('#btnBackToList').addEventListener('click', () => navigate(routeHash('list')));
  sec.querySelector('#btnEditRecipe').addEventListener('click', () => navigate(routeHash('edit', r.id)));
  sec.querySelector('#btnDeleteRecipe').addEventListener('click', async () => {
    if (!confirm(`Удалить рецепт «${r.title}»?`)) return;
    try { await db.deleteRecipe(r.id); } catch (e) { alert('Не удалось удалить: ' + e.message); return; }
    await loadRecipes();
    // заменяем запись истории адресом списка, чтобы «Назад» не вернуло к удалённому рецепту
    navigate(routeHash('list'), true);
  });
  sec.querySelector('#btnPrint').addEventListener('click', () => window.print());

  showView('recipe');
}

/* ---------- Редактор ---------- */
let editRows = []; // { ing, els }
let newDraftActive = false; // новый рецепт начат, но не сохранён — черновик переживает уход во вкладку «Ингредиенты»
function blankIng() {
  return { name: '', amount: '', unit: 'г', source: 'empty' };
}

function ingsFromRecipe(r) {
  return (r.ingredients || []).map(src => {
    const ing = { ...blankIng(), ...src, amount: src.amount, unit: src.unit || 'мл' };
    ing.unit = src.unit || 'г';
    // если КБЖУ не сохранены в рецепте — подставим из справочника
    if (ing.k === undefined && ing.name) applyFood(ing, findFood(ing.name), true);
    return ing;
  });
}

function openEditor(r) {
  // начатый новый черновик не пересоздаём: так можно уйти с него во вкладку
  // «Ингредиенты» (например, добавить отсутствующий продукт) и вернуться,
  // ничего не потеряв. Сброс: «Отмена» или сохранение.
  if (!r && newDraftActive) { showView('editor'); return; }
  editingId = r ? r.id : null;
  currentRecipeId = r ? r.id : null;
  $('#rTitle').value = r ? r.title : '';
  $('#rDesc').value = r ? (r.description || '') : '';
  $('#rSteps').value = r && r.steps ? r.steps.join('\n') : '';
  $('#rServings').value = r ? (Number(r.servings) || 1) : 1;
  $('#saveError').hidden = true;

  const rowsWrap = $('#ingRows');
  rowsWrap.innerHTML = '';
  editRows = [];
  const ings = r ? ingsFromRecipe(r) : [blankIng(), blankIng(), blankIng()];
  for (const ing of ings) addIngRow(ing);

  newDraftActive = !r;
  showView('editor');
}

function addIngRow(ing) {
  const wrap = document.createElement('div');
  wrap.className = 'ing-row';
  const options = UNITS.map(u =>
    `<option value="${u.v}" ${u.v === ing.unit ? 'selected' : ''}>${u.title}</option>`).join('');
  wrap.innerHTML = `
    <div class="ing-line">
      <div class="i-name" style="position:relative">
        <input type="text" class="i-name-input" placeholder="Название ингредиента" value="">
      </div>
      <input class="i-amount" type="number" min="0" step="any" placeholder="0" value="">
      <select class="i-unit">${options}</select>
      <span class="i-sum ing-sum"></span>
      <span class="i-actions ing-remove" style="text-align:right">
        <button type="button" class="ing-remove i-del" title="Удалить строку" style="display:inline-block">✕</button>
      </span>
    </div>`;

  const els = {
    name: wrap.querySelector('.i-name-input'), amount: wrap.querySelector('.i-amount'),
    unit: wrap.querySelector('.i-unit'), sum: wrap.querySelector('.i-sum'),
  };

  const row = { ing, els, wrap };
  editRows.push(row);
  $('#ingRows').appendChild(wrap);

  // -- значение полей
  els.name.value = ing.name || '';
  els.amount.value = ing.amount !== '' ? ing.amount : '';

  // -- подсказки по названию
  setupSuggest(row);

  // -- события
  els.name.addEventListener('input', () => {
    ing.name = els.name.value;
    updateIngFromName(row);
    renderSum(row);
  });
  els.amount.addEventListener('input', () => { ing.amount = els.amount.value; renderSum(row); });
  els.unit.addEventListener('change', () => { ing.unit = els.unit.value; renderSum(row); });
  wrap.querySelector('.i-del').addEventListener('click', () => {
    editRows = editRows.filter(x => x !== row);
    wrap.remove();
  });

  renderSum(row);
}

/**
 * При вводе/изменении названия подставляет КБЖУ и весовые коэффициенты
 * из справочника (встроенного и пользовательского).
 */
function updateIngFromName(row) {
  const { ing } = row;
  const key = findFood(ing.name);
  if (key) applyFood(ing, key, true);
}

function renderSum(row) {
  const { ing, els } = row;
  const g = unitGrams(ing);
  const n = ingKbju(ing, g);
  const named = (ing.name || '').trim();
  els.sum.innerHTML = named
    ? `<b>≈ ${fmt1(g)} г</b> · ${fmt0(n.k)} ккал`
    : '';
  els.sum.title = named
    ? `Белки ${fmt1(n.p)} · Жиры ${fmt1(n.f)} · Углеводы ${fmt1(n.c)}`
    : '';
}

/* --- Подсказки при вводе названия ингредиента --- */
function setupSuggest(row) {
  const { els } = row;
  let listEl = null, hl = -1, items = [];

  function close() { if (listEl) { listEl.remove(); listEl = null; hl = -1; } }

  function open() {
    const q = norm(els.name.value);
    if (!q) { close(); return; }
    const keys = Object.keys(ALL_FOODS);
    const starts = keys.filter(k => k.startsWith(q) && k !== q);
    const mid = keys.filter(k => !k.startsWith(q) && k.includes(q) && k !== q);
    const reverse = keys.filter(k => !k.includes(q) && q.includes(k) && k !== q);
    items = [...starts, ...mid, ...reverse].slice(0, 8);
    items = items.map(k => ({ key: k }));
    if (!listEl) {
      listEl = document.createElement('div');
      listEl.className = 'suggest-list';
      els.name.parentElement.appendChild(listEl);
    }
    if (!items.length) {
      // нет в справочнике — предлагаем создать во вкладке «Ингредиенты»
      const raw = els.name.value.trim();
      if (!raw) { close(); return; }
      listEl.innerHTML = `<div class="suggest-item sug-add">＋ нет в справочнике — добавить «${escHtml(raw)}»</div>`;
      listEl.firstElementChild.addEventListener('mousedown', e => {
        e.preventDefault();
        close();
        addNewFood(raw);
      });
      return;
    }
    listEl.innerHTML = items.map((it, i) =>
      `<div class="suggest-item${i === hl ? ' hl' : ''}" data-i="${i}">${it.key}</div>`).join('');
    [...listEl.children].forEach(itemEl => {
      itemEl.addEventListener('mousedown', e => {
        e.preventDefault();
        pick(items[+itemEl.dataset.i].key);
      });
    });
  }

  function pick(key) {
    close();
    els.name.value = key;
    row.ing.name = key;
    row.ing.source = 'empty';
    updateIngFromName(row);
    renderSum(row);
  }

  els.name.addEventListener('input', () => { hl = -1; open(); });
  els.name.addEventListener('blur', () => setTimeout(close, 120));
  els.name.addEventListener('keydown', e => {
    if (!listEl) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); hl = Math.min(hl + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(hl - 1, 0); }
    else if (e.key === 'Enter') { if (hl >= 0) { e.preventDefault(); pick(items[hl].key); } return; }
    else if (e.key === 'Escape') { close(); return; }
    else return;
    [...listEl.children].forEach((el, i) => el.classList.toggle('hl', i === hl));
  });
}

/* --- Сохранение --- */
async function saveRecipe() {
  const err = $('#saveError');
  err.hidden = true;
  const title = $('#rTitle').value.trim();
  if (!title) { err.textContent = 'Укажите название блюда.'; err.hidden = false; return; }

  const ingredients = [];
  for (const row of editRows) {
    const name = row.els.name.value.trim();
    if (!name) continue;
    const ing = { name, amount: Number(row.els.amount.value) || 0, unit: row.els.unit.value };
    applyFood(ing, findFood(name), true); // КБЖУ всегда из справочника
    ingredients.push(ing);
  }
  if (!ingredients.length) { err.textContent = 'Добавьте хотя бы один ингредиент с названием.'; err.hidden = false; return; }

  const steps = $('#rSteps').value.split('\n').map(s => s.trim()).filter(Boolean);
  const body = {
    title,
    description: $('#rDesc').value.trim(),
    servings: Number($('#rServings').value) || 1,
    ingredients,
    steps,
  };

  let saved;
  try {
    saved = editingId ? await db.updateRecipe(editingId, body) : await db.createRecipe(body);
  } catch (e) {
    err.textContent = 'Не удалось сохранить: ' + e.message;
    err.hidden = false; return;
  }
  await loadRecipes();
  newDraftActive = false;
  // заменяем запись истории редактора адресом готового рецепта
  navigate(routeHash('recipe', saved.id), true);
}

/* ---------- Загрузка данных ---------- */
async function loadRecipes() {
  recipes = await db.loadRecipes();
  recipesLoaded = true;
}

/* ---------- Справочник ингредиентов ---------- */
function refreshEditorRows() {
  // после добавления/правки ингредиента пересчитываем открытые строки редактора
  if (!$('#viewEditor').hidden) {
    for (const row of editRows) {
      if (!row.ing.name) continue;
      updateIngFromName(row);
      renderSum(row);
    }
  }
}

// из редактора: предлагаемое создание отсутствующего ингредиента
function addNewFood(name) {
  if (editingId &&
      !confirm('Продолжить? Несохранённые правки рецепта будут потеряны. ' +
        'Чтобы не потерять их — сохраните рецепт и добавьте ингредиент потом.')) return;
  pendingFoodName = name;
  foodsReturnToEditor = true;
  foodsReturnId = editingId;
  navigate(routeHash('foods'));
}

function renderFoods() {
  const q = norm($('#foodSearch').value);
  const keys = Object.keys(ALL_FOODS)
    .sort((a, b) => a.localeCompare(b, 'ru'));
  const items = q ? keys.filter(k => norm(k).includes(q)) : keys;
  const activeCount = Object.keys(ALL_FOODS).length;
  $('#foodHint').textContent = `Ингредиентов в справочнике: ${activeCount}` +
    (q ? ` · найдено: ${items.length}` : ' · КБЖУ на 100 г, вес мер подставляется в рецепты сам');
  const grid = $('#foodGrid');
  grid.innerHTML = '';
  $('#foodEmpty').hidden = items.length > 0;
  for (const key of items) grid.appendChild(foodCard(key));
  animateIn(grid, '.food-item');
}

function foodCard(key) {
  const el = document.createElement('div');
  el.className = 'food-item';
  const f = ALL_FOODS[key] || {};
  el.innerHTML = `
    <div class="fi-name"></div>
    <div class="fi-kbju">${fmt0(f.k || 0)} ккал · Б ${fmt1(f.p || 0)} / Ж ${fmt1(f.f || 0)} / У ${fmt1(f.c || 0)}</div>
    <div class="fi-actions">
      <button type="button" class="btn small ghost" data-act="edit" title="Изменить">✎</button>
      <button type="button" class="btn small ghost" data-act="del" title="Удалить">🗑</button>
    </div>`;
  el.querySelector('.fi-name').innerHTML = escHtml(key);

  const delBtn = el.querySelector('[data-act="del"]');
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Удалить «${key}» из справочника?`)) return;
    try { await db.deleteFood(key); } catch (e) { alert('Не удалось удалить: ' + e.message); return; }
    delete ALL_FOODS[key];
    renderFoods();
    refreshEditorRows();
  });

  el.querySelector('[data-act="edit"]').addEventListener('click', () => openFoodForm(key));
  return el;
}

function openFoodForm(key, prefill) {
  foodFormKey = key || null;
  $('#foodFormTitle').textContent = key ? `Изменить: «${key}»` : 'Новый ингредиент';
  $('#fName').value = key ? key : (prefill || '');
  $('#fName').disabled = !!key; // переименование не поддерживается: ключ записи — её название
  const f = key ? (ALL_FOODS[key] || {}) : {};
  $('#fK').value = f.k ?? '';    $('#fP').value = f.p ?? '';
  $('#fF').value = f.f ?? '';    $('#fC').value = f.c ?? '';
  $('#fTbsp').value = f.tbsp ?? ''; $('#fTsp').value = f.tsp ?? '';
  $('#fPiece').value = f.piece ?? ''; $('#fD').value = f.d ?? '';
  $('#foodError').hidden = true;
  $('#foodForm').hidden = false;
  $(key ? '#fK' : '#fName').focus();
}

function closeFoodForm() {
  $('#foodForm').hidden = true;
  foodFormKey = null;
}

async function saveFoodForm() {
  const err = $('#foodError');
  err.hidden = true;
  const name = $('#fName').value.trim();
  if (!foodFormKey && !name) {
    err.textContent = 'Укажите название ингредиента.';
    err.hidden = false;
    return;
  }
  const entry = {
    k: Number($('#fK').value) || 0,
    p: Number($('#fP').value) || 0,
    f: Number($('#fF').value) || 0,
    c: Number($('#fC').value) || 0,
  };
  for (const [id, f] of [['fTbsp', 'tbsp'], ['fTsp', 'tsp'], ['fPiece', 'piece'], ['fD', 'd']]) {
    const v = $('#' + id).value;
    if (v !== '' && !isNaN(Number(v))) entry[f] = Number(v);
  }
  let saved;
  try {
    saved = await db.saveFood(foodFormKey || name, entry);
  } catch (e) {
    err.textContent = 'Не удалось сохранить: ' + e.message;
    err.hidden = false;
    return;
  }

  const appliedKey = foodFormKey || name;
  ALL_FOODS[appliedKey] = saved;
  closeFoodForm();
  renderFoods();
  refreshEditorRows();

  if (foodsReturnToEditor) {
    foodsReturnToEditor = false;
    const backTo = foodsReturnId ? routeHash('edit', foodsReturnId) : routeHash('new');
    foodsReturnId = null;
    navigate(backTo);            // возвращаемся: черновик нового рецепта сохранён
    setTimeout(refreshEditorRows, 50);
  }
}

/* ---------- Инициализация ---------- */
async function init() {
  // история браузера: «Назад»/«Вперёд» переключают экраны приложения
  window.addEventListener('hashchange', applyRoute);

  // навигация
  $('#navHome').addEventListener('click', () => navigate(routeHash('home')));
  $('#navList').addEventListener('click', () => navigate(routeHash('list')));
  $('#navFoods').addEventListener('click', () => navigate(routeHash('foods')));
  $('#navNew').addEventListener('click', () => navigate(routeHash('new')));

  // поиск
  const modeBtns = document.querySelectorAll('#modeSwitch .mode-btn');
  modeBtns.forEach(b => b.addEventListener('click', () => {
    modeBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    searchMode = b.dataset.mode;
    $('#searchInput').value = '';
    renderList();
    $('#searchInput').focus();
  }));
  $('#searchInput').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderList, 160);
  });


  // редактор
  $('#addIng').addEventListener('click', () => addIngRow(blankIng()));
  $('#saveRecipe').addEventListener('click', saveRecipe);
  $('#cancelEdit').addEventListener('click', () => {
    newDraftActive = false;
    // возвращаемся туда, откуда открыли редактор
    if (currentRecipeId) navigate(routeHash('recipe', currentRecipeId));
    else navigate(routeHash('list'));
  });

  // справочник ингредиентов
  $('#foodAdd').addEventListener('click', () => { foodsReturnToEditor = false; openFoodForm(null); });
  $('#foodSave').addEventListener('click', saveFoodForm);
  $('#foodCancel').addEventListener('click', () => {
    closeFoodForm();
    if (foodsReturnToEditor) {
      foodsReturnToEditor = false;
      pendingFoodName = null;
      const backTo = foodsReturnId ? routeHash('edit', foodsReturnId) : routeHash('new');
      foodsReturnId = null;
      navigate(backTo);
    }
  });
  $('#foodSearch').addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderFoods, 160);
  });

  // облако ещё не подключено (config.js не заполнен) — показываем инструкцию
  if (!db.isConfigured()) {
    for (const id of ['#viewDashboard', '#viewList', '#viewFoods', '#viewEditor', '#viewRecipe']) {
      $(id).hidden = true;
    }
    document.getElementById('setupOverlay').hidden = false;
    document.querySelectorAll('.nav-btn, .brand').forEach(b => b.disabled = true);
    return;
  }

  await loadCustomFoods();
  loadRecipes().then(applyRoute).catch(e => {
    const hint = $('#dbError');
    if (hint) { hint.textContent = 'Облако недоступно: ' + e.message; hint.hidden = false; }
  });
}

init();
