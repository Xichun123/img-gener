const caseGallery = document.querySelector('#caseGallery');
const caseSearch = document.querySelector('#caseSearch');
const caseCategories = document.querySelector('#caseCategories');
const caseCount = document.querySelector('#caseCount');
const caseSentinel = document.querySelector('#caseSentinel');

const PAGE_SIZE = 60;
const ALL_CATEGORIES = '__all__';

let allCases = [];
let filtered = [];
let renderedCount = 0;
let activeCategory = ALL_CATEGORIES;
let searchQuery = '';
let searchDebounce = null;

bootstrap();

async function bootstrap() {
  showStatus('正在加载效果图…');
  try {
    const response = await fetch('/prompt-cases.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    allCases = (Array.isArray(payload?.cases) ? payload.cases : []).map(normalizeCase);
  } catch (error) {
    showStatus(`加载失败：${error.message}`);
    return;
  }
  if (!allCases.length) {
    showStatus('没有可用的效果图案例。');
    return;
  }
  renderCategoryChips();
  bindEvents();
  applyFilter();
}

function normalizeCase(item) {
  const category = (item.category || item.source || '其他').trim() || '其他';
  return {
    ...item,
    category,
    haystack: `${item.title || ''}\n${item.alt || ''}\n${item.prompt || ''}\n${item.source || ''}\n${item.author || ''}`.toLowerCase(),
  };
}

function renderCategoryChips() {
  const counts = new Map();
  for (const item of allCases) {
    counts.set(item.category, (counts.get(item.category) || 0) + 1);
  }
  const chips = [[ALL_CATEGORIES, '全部', allCases.length]];
  for (const [name, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    chips.push([name, name, count]);
  }
  caseCategories.innerHTML = '';
  for (const [value, label, count] of chips) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `chip${value === activeCategory ? ' active' : ''}`;
    btn.dataset.category = value;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', value === activeCategory ? 'true' : 'false');
    btn.textContent = `${label} · ${count}`;
    caseCategories.appendChild(btn);
  }
}

function bindEvents() {
  caseSearch?.addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = caseSearch.value.trim().toLowerCase();
      applyFilter();
    }, 150);
  });

  caseCategories.addEventListener('click', (event) => {
    const target = event.target.closest('button[data-category]');
    if (!target) return;
    activeCategory = target.dataset.category;
    for (const btn of caseCategories.querySelectorAll('button')) {
      const isActive = btn.dataset.category === activeCategory;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    applyFilter();
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) renderMore();
    }, { rootMargin: '600px 0px' });
    observer.observe(caseSentinel);
  }

  caseGallery.addEventListener('click', (event) => {
    const card = event.target.closest('button.gallery-card');
    if (!card) return;
    const index = Number(card.dataset.index);
    const item = filtered[index];
    if (item) useCasePrompt(item);
  });
}

function applyFilter() {
  filtered = allCases.filter((item) => {
    if (activeCategory !== ALL_CATEGORIES && item.category !== activeCategory) return false;
    if (searchQuery && !item.haystack.includes(searchQuery)) return false;
    return true;
  });
  renderedCount = 0;
  caseGallery.innerHTML = '';
  if (!filtered.length) {
    caseGallery.innerHTML = '<p class="gallery-empty">没有匹配的效果图。</p>';
    updateCount();
    return;
  }
  renderMore();
}

function renderMore() {
  if (renderedCount >= filtered.length) return;
  const fragment = document.createDocumentFragment();
  const next = Math.min(renderedCount + PAGE_SIZE, filtered.length);
  for (let i = renderedCount; i < next; i++) {
    const item = filtered[i];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-card';
    button.dataset.index = String(i);
    button.title = `例 ${item.number}：${item.title}`;
    button.innerHTML = `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt || item.title)}" loading="lazy" decoding="async">`;
    fragment.appendChild(button);
  }
  caseGallery.appendChild(fragment);
  renderedCount = next;
  updateCount();
}

function updateCount() {
  const shown = Math.min(renderedCount, filtered.length);
  caseCount.textContent = filtered.length === allCases.length
    ? `${shown} / ${allCases.length}`
    : `${shown} / ${filtered.length}（共 ${allCases.length}）`;
}

function showStatus(message) {
  caseGallery.innerHTML = `<p class="gallery-empty">${escapeHtml(message)}</p>`;
}

function useCasePrompt(item) {
  localStorage.setItem('img-gener.pending-prompt', item.prompt);
  window.location.href = 'index.html';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
