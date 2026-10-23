// ===== Облачный слой данных: Supabase (REST, без библиотек) =====
// Заменяет прежний локальный сервер. Все устройства читают и пишут
// одну и ту же базу — синхронизация получается сама собой.
'use strict';

const SUPABASE_URL = String(window.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = String(window.SUPABASE_ANON_KEY || '');

const db = {
  // конфигурация ещё не вставлена в config.js
  isConfigured() {
    return /^https?:\/\//i.test(SUPABASE_URL)
      && !/SUPABASE_URL/i.test(window.SUPABASE_URL)
      && SUPABASE_ANON_KEY.length > 30
      && !/ANON.?KEY/i.test(window.SUPABASE_ANON_KEY);
  },
};

function dbHeaders(prefer) {
  const h = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (prefer) h.Prefer = prefer;
  return h;
}

async function dbRequest(method, path, qs, body, prefer) {
  const url = SUPABASE_URL + '/rest/v1/' + path + (qs ? '?' + qs : '');
  const res = await fetch(url, {
    method,
    headers: dbHeaders(prefer),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = res.status + ' ' + res.statusText;
    try {
      const j = await res.json();
      msg = j.message || j.error_description || j.error || msg;
    } catch (e) { /* тело не JSON — оставляем как есть */ }
    throw new Error(msg);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ---------- Справочник ингредиентов (таблица foods, ключ = название) ---------- */

function foodFromRow(row) {
  const entry = {
    k: Number(row.k) || 0,
    p: Number(row.p) || 0,
    f: Number(row.f) || 0,
    c: Number(row.c) || 0,
  };
  for (const f of ['tbsp', 'tsp', 'piece', 'd']) {
    if (row[f] !== null && row[f] !== undefined) entry[f] = Number(row[f]);
  }
  return entry;
}

// Complete list: map «имя → {k,p,f,c,tbsp,tsp,piece,d}»
db.loadFoods = async function () {
  const rows = await dbRequest('GET', 'foods', 'select=*');
  const map = {};
  for (const row of rows || []) map[row.name] = foodFromRow(row);
  return map;
};

// Saving: creating (name = key) or editing is one upsert action
db.saveFood = async function (name, entry) {
  const row = { name, k: entry.k || 0, p: entry.p || 0, f: entry.f || 0, c: entry.c || 0 };
  for (const f of ['tbsp', 'tsp', 'piece', 'd']) {
    row[f] = entry[f] === undefined || entry[f] === '' ? null : Number(entry[f]);
  }
  const saved = await dbRequest('POST', 'foods', 'select=*', row,
    'resolution=merge-duplicates,return=representation');
  return foodFromRow((saved && saved[0]) || row);
};

db.deleteFood = async function (name) {
  await dbRequest('DELETE', 'foods', 'name=eq.' + encodeURIComponent(name));
};

/* ---------- Рецепты (таблица recipes) ---------- */

function recipeFromRow(row) {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    servings: Number(row.servings) || 1,
    ingredients: Array.isArray(row.ingredients) ? row.ingredients : [],
    steps: Array.isArray(row.steps) ? row.steps : [],
    createdAt: Date.parse(row.created_at) || 0,
    updatedAt: Date.parse(row.updated_at) || 0,
  };
}

db.loadRecipes = async function () {
  const rows = await dbRequest('GET', 'recipes', 'select=*&order=created_at.desc');
  return (rows || []).map(recipeFromRow);
};

db.createRecipe = async function (body) {
  const row = {
    title: body.title,
    description: body.description || '',
    servings: body.servings || 1,
    ingredients: body.ingredients || [],
    steps: body.steps || [],
  };
  const saved = await dbRequest('POST', 'recipes', 'select=*', row,
    'return=representation');
  return recipeFromRow((saved && saved[0]) || {});
};

db.updateRecipe = async function (id, body) {
  const row = {
    title: body.title,
    description: body.description || '',
    servings: body.servings || 1,
    ingredients: body.ingredients || [],
    steps: body.steps || [],
    // updated_at will update the trigger; created_at will remain as is
  };
  const saved = await dbRequest('PATCH', 'recipes', 'id=eq.' + encodeURIComponent(id) + '&select=*', row,
    'return=representation');
  if (!saved || !saved.length) throw new Error('Рецепт не найден');
  return recipeFromRow(saved[0]);
};

db.deleteRecipe = async function (id) {
  await dbRequest('DELETE', 'recipes', 'id=eq.' + encodeURIComponent(id));
};
