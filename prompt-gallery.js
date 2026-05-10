const caseGallery = document.querySelector('#caseGallery');
const cases = Array.isArray(window.PROMPT_CASES) ? window.PROMPT_CASES : [];

renderGallery();

function renderGallery() {
  if (!caseGallery) return;
  if (!cases.length) {
    caseGallery.innerHTML = '<p class="gallery-empty">没有可用的效果图案例。</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const item of cases) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'gallery-card';
    button.title = `例 ${item.number}：${item.title}`;
    button.innerHTML = `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.alt || item.title)}" loading="lazy">`;
    button.addEventListener('click', () => useCasePrompt(item));
    fragment.appendChild(button);
  }
  caseGallery.appendChild(fragment);
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
