const form = document.querySelector('#generateForm');
const siteKeyInput = document.querySelector('#siteKey');
const quotaStatus = document.querySelector('#quotaStatus');
const modeInput = document.querySelector('#mode');
const modelChoices = document.querySelector('#modelChoices');
const modelHint = document.querySelector('#modelHint');
const sizeInput = document.querySelector('#size');
const qualityInput = document.querySelector('#quality');
const outputFormatInput = document.querySelector('#outputFormat');
const imageCountInput = document.querySelector('#imageCount');
const promptInput = document.querySelector('#prompt');
const promptTemplatePanel = document.querySelector('#promptTemplatePanel');
const promptTemplateInput = document.querySelector('#promptTemplate');
const promptTemplateFilter = document.querySelector('#promptTemplateFilter');
const templatePreview = document.querySelector('#templatePreview');
const useTemplateBtn = document.querySelector('#useTemplateBtn');
const appendTemplateBtn = document.querySelector('#appendTemplateBtn');
const sourceImageInput = document.querySelector('#sourceImage');
const imageUploadLabel = document.querySelector('#imageUploadLabel');
const editSourceInfo = document.querySelector('#editSourceInfo');
const generateBtn = document.querySelector('#generateBtn');
const resetBtn = document.querySelector('#resetBtn');
const requestState = document.querySelector('#requestState');
const previewBox = document.querySelector('#previewBox');
const metaBox = document.querySelector('#metaBox');
const downloadBtn = document.querySelector('#downloadBtn');
const historyPanel = document.querySelector('#historyPanel');
const historyList = document.querySelector('#historyList');
const historyMeta = document.querySelector('#historyMeta');
const historyClearBtn = document.querySelector('#historyClearBtn');
const modeTabs = Array.from(document.querySelectorAll('input[name="modeTabs"]'));
const imageLightbox = document.querySelector('#imageLightbox');
const lightboxImage = document.querySelector('#lightboxImage');
const lightboxCaption = document.querySelector('#lightboxCaption');
const lightboxDownload = document.querySelector('#lightboxDownload');
const lightboxClose = document.querySelector('.lightbox-close');

const MAX_TOTAL_IMAGES = 6;
const HISTORY_KEY = 'img-gener.history';
const HISTORY_MAX = 20;
const HISTORY_THUMB = 192;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
let currentImages = [];
let promptTemplates = [];
let inlineEditSource = null;
let generationTimer = null;
let generationStartedAt = 0;
let keyStatusTimer = null;
let modelInputs = [];
let modelProfiles = {};
const savedSiteKey = localStorage.getItem('img-gener.site-key') || '';
if (savedSiteKey) siteKeyInput.value = savedSiteKey;

loadModels();
refreshKeyStatus();
updateMode();
loadPromptTemplates();
applyPendingGalleryPrompt();
renderHistory(loadHistory());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await generateImage();
});

resetBtn.addEventListener('click', () => {
  promptInput.value = '';
  sizeInput.value = '1024x1024';
  qualityInput.value = 'low';
  outputFormatInput.value = 'png';
  imageCountInput.value = '1';
  clearInlineEditSource();
  modelInputs.forEach((input) => { input.checked = false; });
  updateModelProfile();
  setState('等待生成');
  setPreviewEmpty();
});

modelChoices.addEventListener('change', updateModelProfile);
imageCountInput.addEventListener('change', updateModelProfile);
modeInput.addEventListener('change', updateMode);
modeTabs.forEach((input) => {
  input.addEventListener('change', () => {
    if (!input.checked) return;
    modeInput.value = input.value;
    updateMode();
  });
});
siteKeyInput.addEventListener('change', refreshKeyStatus);
siteKeyInput.addEventListener('blur', refreshKeyStatus);
siteKeyInput.addEventListener('input', () => {
  localStorage.setItem('img-gener.site-key', siteKeyInput.value.trim());
  scheduleKeyStatusRefresh();
});
sourceImageInput.addEventListener('change', () => {
  if (sourceImageInput.files?.[0]) clearInlineEditSource();
});
promptTemplateInput?.addEventListener('change', updateTemplatePreview);
promptTemplateFilter?.addEventListener('input', filterPromptTemplates);
useTemplateBtn?.addEventListener('click', () => applyPromptTemplate('replace'));
appendTemplateBtn?.addEventListener('click', () => applyPromptTemplate('append'));

promptInput.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!generateBtn.disabled) form.requestSubmit();
  }
});

document.addEventListener('paste', (event) => {
  if (event.target?.tagName === 'INPUT' && event.target.type !== 'file') return;
  const file = pickImageFromTransfer(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  ingestImageFile(file, '已从剪贴板载入图片，已切换到图生图。');
});

['dragenter', 'dragover'].forEach((evt) => {
  form.addEventListener(evt, (event) => {
    if (!event.dataTransfer?.types?.includes('Files')) return;
    event.preventDefault();
    form.classList.add('dragover');
  });
});
['dragleave', 'dragend', 'drop'].forEach((evt) => {
  form.addEventListener(evt, () => form.classList.remove('dragover'));
});
form.addEventListener('drop', (event) => {
  const file = pickImageFromTransfer(event.dataTransfer);
  if (!file) return;
  event.preventDefault();
  ingestImageFile(file, '已载入拖入的图片，已切换到图生图。');
});

historyClearBtn?.addEventListener('click', () => {
  if (!loadHistory().length) return;
  if (!confirm('清空生成历史？此操作不可撤销。')) return;
  saveHistory([]);
  renderHistory([]);
});

historyList?.addEventListener('click', (event) => {
  const previewImage = event.target.closest('img[data-preview-src]');
  if (previewImage) {
    openImageLightbox(previewImage.dataset.previewSrc, previewImage.dataset.previewCaption || previewImage.alt || '图片预览', previewImage.dataset.previewDownload || 'image.png');
    return;
  }
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const card = button.closest('article[data-id]');
  if (!card) return;
  const id = card.dataset.id;
  const action = button.dataset.action;
  if (action === 'delete') return deleteHistoryEntry(id);
  if (action === 'fill') return fillFromHistory(id);
  if (action === 'edit') return useHistoryAsEdit(id);
});

imageLightbox?.addEventListener('click', (event) => {
  if (event.target === imageLightbox) closeImageLightbox();
});
lightboxClose?.addEventListener('click', closeImageLightbox);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && imageLightbox && !imageLightbox.hidden) closeImageLightbox();
});

async function loadModels() {
  try {
    const response = await fetch('/api/models');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    const models = Array.isArray(payload?.models) ? payload.models : [];
    renderModelChoices(models);
  } catch (error) {
    modelChoices.innerHTML = `<span class="field-note danger-text">模型加载失败：${escapeHtml(error.message)}</span>`;
    modelProfiles = {};
    modelInputs = [];
    updateModelProfile();
  }
}

function renderModelChoices(models) {
  modelProfiles = {};
  modelChoices.innerHTML = '';
  if (!models.length) {
    modelChoices.innerHTML = '<span class="field-note danger-text">没有可用模型，请检查后台模型路由配置。</span>';
    modelInputs = [];
    updateModelProfile();
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const model of models) {
    const id = String(model.id || '').trim();
    if (!id) continue;
    modelProfiles[id] = {
      label: model.label || id,
      sizes: Array.isArray(model.sizes) ? model.sizes : [],
      qualities: Array.isArray(model.qualities) ? model.qualities : [],
      formats: Array.isArray(model.formats) ? model.formats : [],
      supportsEdit: Boolean(model.supports_edit),
    };
    const label = document.createElement('label');
    label.className = 'check-card';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'models';
    input.value = id;
    const span = document.createElement('span');
    span.textContent = model.label || id;
    label.append(input, span);
    fragment.append(label);
  }
  modelChoices.append(fragment);
  modelInputs = Array.from(document.querySelectorAll('input[name="models"]'));
  updateModelProfile();
  updateMode();
}

async function generateImage() {
  const siteKey = siteKeyInput.value.trim();
  const prompt = promptInput.value.trim();
  const mode = modeInput.value;
  const models = getSelectedModels();
  const count = Number(imageCountInput.value || 1);
  const totalRequested = models.length * count;

  if (!siteKey || !prompt) {
    setState('请补全信息', 'error');
    return;
  }

  if (!models.length) {
    setState('请选择模型', 'error');
    return;
  }

  if (totalRequested > MAX_TOTAL_IMAGES) {
    setState(`单次最多 ${MAX_TOTAL_IMAGES} 张`, 'error');
    return;
  }

  if (mode === 'edit' && !hasEditSource()) {
    setState('请先上传图片', 'error');
    return;
  }

  setState('生成中…', 'loading');
  startGenerationTimer();
  setControls(false);
  generateBtn.disabled = true;
  previewBox.className = 'preview-box empty';
  previewBox.innerHTML = `<div><strong>正在生成 ${totalRequested} 张</strong><p>请稍等，完成后会自动显示结果。</p></div>`;
  metaBox.classList.add('hidden');

  const requestBody = {
    siteKey,
    mode,
    models,
    model: models[0],
    prompt,
    n: count,
    size: sizeInput.value,
    quality: qualityInput.value,
    output_format: outputFormatInput.value,
  };

  try {
    if (mode === 'edit') {
      const imagePayload = await getEditSourcePayload();
      requestBody.image = imagePayload;
    }

    const response = await fetch(mode === 'edit' ? '/api/edit' : '/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    const text = await response.text();
    const payload = parseJson(text);

    if (!response.ok) {
      throw new Error(extractError(payload) || `请求失败：HTTP ${response.status}`);
    }

    const items = Array.isArray(payload?.data) ? payload.data : [];
    const outputFormat = payload.output_format || requestBody.output_format;
    const mime = `image/${outputFormat || 'png'}`;
    currentImages = items.map((imageItem, index) => {
      const b64 = imageItem?.b64_json;
      const url = imageItem?.url;
      const imageData = b64 ? `data:${mime};base64,${b64}` : url;
      return {
        id: crypto.randomUUID(),
        index: index + 1,
        imageData,
        prompt,
        revisedPrompt: imageItem?.revised_prompt || '',
        model: imageItem?.model || requestBody.model,
        size: payload.size || requestBody.size,
        requestedSize: requestBody.size,
        quality: payload.quality || requestBody.quality,
        requestedQuality: requestBody.quality,
        outputFormat,
        mode,
        createdAt: new Date().toISOString(),
      };
    }).filter((item) => item.imageData);

    if (!currentImages.length) throw new Error('接口没有返回图片数据。');

    renderImages(currentImages, payload.errors || []);
    updateKeyStatus(payload.siteKey);
    const failedText = payload.errors?.length ? `，失败 ${payload.errors.length} 个模型` : '';
    setState(`完成 ${currentImages.length} 张${failedText} · 用时 ${formatElapsed(Date.now() - generationStartedAt)}`, payload.errors?.length ? 'error' : 'ok');
    setControls(true);
    addHistoryEntries(currentImages).catch((err) => console.warn('history save failed', err));
  } catch (error) {
    currentImages = [];
    setPreviewError(error.message);
    setState(`生成失败 · 用时 ${formatElapsed(Date.now() - generationStartedAt)}`, 'error');
    setControls(false);
  } finally {
    stopGenerationTimer();
    generateBtn.disabled = false;
  }
}

function renderImages(items, errors = []) {
  previewBox.className = 'preview-box result-grid';
  previewBox.innerHTML = '';

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'image-card';

    const image = document.createElement('img');
    image.src = item.imageData;
    image.alt = item.prompt;
    image.className = 'preview-image';
    image.title = '点击查看大图';
    image.addEventListener('click', () => openImageLightbox(item.imageData, `${item.model} · ${item.size || ''}`, buildFileName(item)));
    card.appendChild(image);

    const footer = document.createElement('div');
    footer.className = 'image-card-footer';
    footer.innerHTML = `
      <span>${escapeHtml(item.model)}</span>
      <div class="image-card-actions">
        <button type="button" class="mini-btn edit-btn">编辑</button>
        <a href="${item.imageData}" download="${buildFileName(item)}">下载</a>
      </div>
    `;
    footer.querySelector('.edit-btn')?.addEventListener('click', () => useImageForEdit(item));
    card.appendChild(footer);
    previewBox.appendChild(card);
  }

  const first = items[0];
  downloadBtn.href = first.imageData;
  downloadBtn.download = buildFileName(first);
  downloadBtn.classList.remove('disabled');

  const requestedModels = new Set(items.map((item) => item.model)).size;
  const errorText = errors.length
    ? `<br><span class="danger-text">失败：${errors.map((item) => `${escapeHtml(item.model)}：${escapeHtml(item.error)}`).join('；')}</span>`
    : '';
  metaBox.classList.remove('hidden');
  metaBox.innerHTML = `
    <strong>${items.length} 张图片</strong> · ${requestedModels} 个模型 · ${escapeHtml(first.size)} · ${escapeHtml(first.quality)} · ${escapeHtml(first.outputFormat)}${errorText}<br>
    <span>按成功返回图片数扣次数。</span>
  `;
}

function setControls(enabled) {
  if (!enabled) {
    downloadBtn.classList.add('disabled');
    downloadBtn.removeAttribute('href');
  }
}

function setPreviewEmpty() {
  currentImages = [];
  setControls(false);
  previewBox.className = 'preview-box empty';
  previewBox.innerHTML = '<div><strong>还没有图片</strong><p>填写提示词后点击“开始生成”。</p></div>';
  metaBox.classList.add('hidden');
}

function openImageLightbox(src, caption, fileName) {
  if (!imageLightbox || !lightboxImage || !lightboxDownload) return;
  lightboxImage.src = src;
  lightboxImage.alt = caption || '图片预览';
  lightboxCaption.textContent = caption || '';
  lightboxDownload.href = src;
  lightboxDownload.download = fileName || 'image.png';
  imageLightbox.hidden = false;
  document.body.classList.add('lightbox-open');
}

function closeImageLightbox() {
  if (!imageLightbox || !lightboxImage) return;
  imageLightbox.hidden = true;
  lightboxImage.removeAttribute('src');
  document.body.classList.remove('lightbox-open');
}

function setPreviewError(message) {
  previewBox.className = 'preview-box empty';
  previewBox.innerHTML = `<div><strong>生成失败</strong><p>${escapeHtml(message)}</p></div>`;
  metaBox.classList.add('hidden');
}

function setState(text, mode = '') {
  requestState.textContent = text;
  requestState.className = `pill ${mode}`.trim();
}

async function loadPromptTemplates() {
  if (!promptTemplatePanel || !promptTemplateInput) return;
  try {
    const response = await fetch('/prompt-templates.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    promptTemplates = Array.isArray(payload?.templates) ? payload.templates : [];
  } catch (error) {
    promptTemplates = [];
    if (templatePreview) templatePreview.textContent = `提示词模板加载失败：${error.message}`;
    return;
  }
  renderPromptTemplateOptions(promptTemplates);
  promptTemplatePanel.classList.remove('hidden');
  updateTemplatePreview();
}

function renderPromptTemplateOptions(templates) {
  while (promptTemplateInput.options.length > 1) {
    promptTemplateInput.remove(1);
  }
  const categories = new Map();
  for (const template of templates) {
    const category = template.category || '其他';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(template);
  }
  for (const [category, items] of categories) {
    const group = document.createElement('optgroup');
    group.label = category;
    for (const template of items) {
      const option = document.createElement('option');
      option.value = template.id;
      option.textContent = `${template.title}${template.kind === 'json' ? ' · JSON' : ''}`;
      option.dataset.haystack = `${template.title}\n${template.category || ''}\n${template.prompt}`.toLowerCase();
      group.appendChild(option);
    }
    promptTemplateInput.appendChild(group);
  }
}

function filterPromptTemplates() {
  const query = (promptTemplateFilter?.value || '').trim().toLowerCase();
  const groups = promptTemplateInput.querySelectorAll('optgroup');
  let firstVisibleId = '';
  for (const group of groups) {
    let groupVisible = false;
    for (const option of group.children) {
      const matches = !query || (option.dataset.haystack || '').includes(query);
      option.hidden = !matches;
      option.disabled = !matches;
      if (matches) {
        groupVisible = true;
        if (!firstVisibleId) firstVisibleId = option.value;
      }
    }
    group.hidden = !groupVisible;
  }
  const current = promptTemplateInput.value;
  const currentVisible = current && Array.from(promptTemplateInput.options).some((opt) => opt.value === current && !opt.hidden);
  if (!currentVisible) {
    promptTemplateInput.value = query ? firstVisibleId : '';
    updateTemplatePreview();
  }
}

function updateTemplatePreview() {
  if (!templatePreview) return;
  const template = getSelectedTemplate();
  if (!template) {
    const count = promptTemplates.length;
    templatePreview.textContent = count ? `内置 ${count} 个提示词模板，可直接填入后修改方括号内容。` : '';
    return;
  }
  const firstLine = template.prompt.split('\n').find((line) => line.trim()) || '';
  templatePreview.textContent = `${template.category} · ${template.title}：${firstLine.slice(0, 80)}`;
}

function applyPromptTemplate(mode) {
  const template = getSelectedTemplate();
  if (!template) {
    promptTemplateInput?.focus();
    return;
  }

  if (mode === 'append' && promptInput.value.trim()) {
    promptInput.value = `${promptInput.value.trim()}\n\n${template.prompt}`;
  } else {
    promptInput.value = template.prompt;
  }
  promptInput.focus();
}

function getSelectedTemplate() {
  return promptTemplates.find((template) => template.id === promptTemplateInput?.value) || null;
}

function applyPendingGalleryPrompt() {
  const pending = localStorage.getItem('img-gener.pending-prompt');
  if (!pending) return;
  localStorage.removeItem('img-gener.pending-prompt');
  promptInput.value = pending;
  promptInput.focus();
}

function startGenerationTimer() {
  stopGenerationTimer();
  generationStartedAt = Date.now();
  generationTimer = setInterval(() => {
    setState(`生成中 · ${formatElapsed(Date.now() - generationStartedAt)}`, 'loading');
  }, 1000);
}

function stopGenerationTimer() {
  if (!generationTimer) return;
  clearInterval(generationTimer);
  generationTimer = null;
}

function formatElapsed(ms) {
  const totalSeconds = Math.max(Math.floor(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds} 秒`;
  return `${minutes} 分 ${String(seconds).padStart(2, '0')} 秒`;
}

function updateKeyStatus(siteKeyInfo) {
  if (!siteKeyInfo || !quotaStatus) return;
  const remaining = Number(siteKeyInfo.remaining);
  const limit = Number(siteKeyInfo.limit);
  const used = Number(siteKeyInfo.used);
  if (!Number.isFinite(remaining) || !Number.isFinite(limit)) {
    clearKeyStatus();
    return;
  }
  quotaStatus.textContent = `剩余 ${remaining} / ${limit}`;
  quotaStatus.hidden = false;
  quotaStatus.classList.toggle('is-empty', remaining <= 0);
  quotaStatus.title = Number.isFinite(used) ? `已用 ${used}，总额度 ${limit}` : `总额度 ${limit}`;
}

function clearKeyStatus() {
  if (!quotaStatus) return;
  quotaStatus.textContent = '';
  quotaStatus.hidden = true;
  quotaStatus.classList.remove('is-empty');
  quotaStatus.removeAttribute('title');
}

function scheduleKeyStatusRefresh() {
  if (keyStatusTimer) clearTimeout(keyStatusTimer);
  if (!siteKeyInput.value.trim()) {
    clearKeyStatus();
    return;
  }
  keyStatusTimer = setTimeout(refreshKeyStatus, 500);
}

function updateMode() {
  const isEdit = modeInput.value === 'edit';
  for (const tab of modeTabs) {
    tab.checked = tab.value === modeInput.value;
  }
  imageUploadLabel.classList.toggle('hidden', !isEdit);
  sourceImageInput.required = isEdit && !inlineEditSource;
  for (const input of modelInputs) {
    const profile = modelProfiles[input.value];
    input.disabled = isEdit && profile && !profile.supportsEdit;
    if (input.disabled) input.checked = false;
  }
  if (editSourceInfo) {
    editSourceInfo.classList.toggle('hidden', !(isEdit && inlineEditSource));
    editSourceInfo.textContent = inlineEditSource
      ? `已使用生成结果作为编辑源：${inlineEditSource.label}`
      : '';
  }
  promptInput.placeholder = isEdit
    ? '描述你想如何修改上传的图片，例如：改成赛博朋克风格，保留主体。'
    : '描述你想生成的图片，例如：赛博朋克风格的猫，站在雨夜霓虹街道上。';
  generateBtn.textContent = isEdit ? '开始编辑' : '开始生成';
  updateModelProfile();
}

function fileToPayload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const [, base64 = ''] = dataUrl.split(',');
      resolve({ name: file.name, type: file.type || 'application/octet-stream', data: base64 });
    };
    reader.onerror = () => reject(new Error('图片读取失败。'));
    reader.readAsDataURL(file);
  });
}

function dataUrlToPayload(dataUrl, name) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('图片格式不正确。');
  return { name, type: match[1], data: match[2] };
}

function setInlineEditSource(dataUrl, label) {
  inlineEditSource = {
    ...dataUrlToPayload(dataUrl, label || 'generated-image.png'),
    label: label || '生成结果',
  };
  sourceImageInput.value = '';
  updateMode();
}

function clearInlineEditSource() {
  inlineEditSource = null;
  if (editSourceInfo) {
    editSourceInfo.classList.add('hidden');
    editSourceInfo.textContent = '';
  }
  updateMode();
}

function getEditSourcePayload() {
  if (sourceImageInput.files?.[0]) {
    return fileToPayload(sourceImageInput.files[0]);
  }
  return inlineEditSource;
}

function hasEditSource() {
  return Boolean(sourceImageInput.files?.[0] || inlineEditSource);
}

function useImageForEdit(item) {
  if (!item?.imageData) return;
  setInlineEditSource(item.imageData, `${item.model || 'image'}-${item.index || 1}.png`);
  modeInput.value = 'edit';
  updateMode();
  promptInput.focus();
  setState('已切换到图生图，修改提示词后直接开始编辑。', 'ok');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refreshKeyStatus() {
  const siteKey = siteKeyInput.value.trim();
  if (!siteKey) {
    clearKeyStatus();
    return;
  }

  try {
    const response = await fetch('/api/key-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteKey }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '查询失败');
    updateKeyStatus(payload);
  } catch (error) {
    clearKeyStatus();
    console.warn('key status check failed', error);
  }
}

function updateModelProfile() {
  const selectedModels = getSelectedModels();
  const activeProfiles = selectedModels.map((model) => modelProfiles[model]).filter(Boolean);
  const allowedSizes = activeProfiles.length
    ? activeProfiles.reduce((sizes, profile) => sizes.filter((size) => profile.sizes.includes(size)), [...activeProfiles[0].sizes])
    : [];
  const allowedQualities = activeProfiles.length
    ? activeProfiles.reduce((items, profile) => items.filter((item) => profile.qualities.includes(item)), [...activeProfiles[0].qualities])
    : [];
  const allowedFormats = activeProfiles.length
    ? activeProfiles.reduce((items, profile) => items.filter((item) => profile.formats.includes(item)), [...activeProfiles[0].formats])
    : [];

  for (const option of sizeInput.options) {
    option.disabled = Boolean(allowedSizes.length) && !allowedSizes.includes(option.value);
  }
  for (const option of qualityInput.options) {
    option.disabled = Boolean(allowedQualities.length) && !allowedQualities.includes(option.value);
  }
  for (const option of outputFormatInput.options) {
    option.disabled = Boolean(allowedFormats.length) && !allowedFormats.includes(option.value);
  }

  if (allowedSizes.length && !allowedSizes.includes(sizeInput.value)) {
    sizeInput.value = allowedSizes.includes('1024x1024') ? '1024x1024' : allowedSizes[0];
  }
  if (allowedQualities.length && !allowedQualities.includes(qualityInput.value)) {
    qualityInput.value = allowedQualities.includes('low') ? 'low' : allowedQualities[0];
  }
  if (allowedFormats.length && !allowedFormats.includes(outputFormatInput.value)) {
    outputFormatInput.value = allowedFormats.includes('png') ? 'png' : allowedFormats[0];
  }

  updateCountOptions(selectedModels.length || 1);
  const total = selectedModels.length * Number(imageCountInput.value || 1);
  modelHint.textContent = selectedModels.length
    ? `已选择 ${selectedModels.length} 个模型，本次会生成 ${total} 张；单次最多 ${MAX_TOTAL_IMAGES} 张。`
    : '请选择至少一个模型。';
}

function updateCountOptions(modelCount) {
  for (const option of imageCountInput.options) {
    option.disabled = Number(option.value) * modelCount > MAX_TOTAL_IMAGES;
  }
  if (Number(imageCountInput.value) * modelCount > MAX_TOTAL_IMAGES) {
    const available = Array.from(imageCountInput.options).filter((option) => !option.disabled);
    imageCountInput.value = available.at(-1)?.value || '1';
  }
}

function getSelectedModels() {
  return modelInputs.filter((input) => input.checked).map((input) => input.value);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function extractError(payload) {
  return payload?.error?.message || payload?.error || payload?.message || payload?.raw;
}

function buildFileName(item) {
  const safeSize = String(item.size || item.requestedSize || 'image').replace(/[^a-z0-9x-]/gi, '-');
  const safeModel = String(item.model || 'model').replace(/[^a-z0-9.-]/gi, '-');
  return `generated-${safeModel}-${safeSize}-${Date.now()}.${item.outputFormat || 'png'}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function pickImageFromTransfer(transfer) {
  if (!transfer) return null;
  for (const file of transfer.files || []) {
    if (file && ALLOWED_IMAGE_TYPES.has(file.type)) return file;
  }
  for (const item of transfer.items || []) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && ALLOWED_IMAGE_TYPES.has(file.type)) return file;
    }
  }
  return null;
}

function ingestImageFile(file, message) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    setState('图片格式不支持，仅支持 PNG / JPEG / WebP', 'error');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    setState('图片超过 20MB，请压缩后再上传', 'error');
    return;
  }
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    sourceImageInput.files = dt.files;
  } catch {
    setState('当前浏览器不支持代码上传文件', 'error');
    return;
  }
  inlineEditSource = null;
  modeInput.value = 'edit';
  updateMode();
  setState(message || '已载入图片，已切换到图生图。', 'ok');
}

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  let toStore = items.slice(0, HISTORY_MAX);
  while (toStore.length) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(toStore));
      return;
    } catch {
      toStore = toStore.slice(0, Math.max(0, toStore.length - 3));
    }
  }
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

async function addHistoryEntries(images) {
  if (!images?.length) return;
  const entries = await Promise.all(images.map(async (item) => ({
    id: item.id || crypto.randomUUID(),
    prompt: item.prompt,
    model: item.model,
    size: item.size,
    quality: item.quality,
    outputFormat: item.outputFormat,
    mode: item.mode,
    createdAt: item.createdAt,
    thumb: await makeThumb(item.imageData, HISTORY_THUMB),
  })));
  const next = [...entries, ...loadHistory()].slice(0, HISTORY_MAX);
  saveHistory(next);
  renderHistory(next);
}

function makeThumb(dataUrl, size) {
  return new Promise((resolve) => {
    if (!dataUrl) return resolve('');
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, size / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * ratio));
      const h = Math.max(1, Math.round(img.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      try {
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.7));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

function renderHistory(items) {
  if (!historyPanel || !historyList) return;
  if (!items.length) {
    historyPanel.classList.add('hidden');
    historyList.innerHTML = '';
    if (historyMeta) historyMeta.textContent = '';
    return;
  }
  historyPanel.classList.remove('hidden');
  if (historyMeta) historyMeta.textContent = `${items.length} / ${HISTORY_MAX}（仅本机本浏览器）`;
  const fragment = document.createDocumentFragment();
  for (const entry of items) {
    const card = document.createElement('article');
    card.className = 'history-card';
    card.dataset.id = entry.id;
    const time = formatHistoryDate(entry.createdAt);
    card.innerHTML = `
      <div class="history-card-thumb">
        ${entry.thumb ? `<img src="${escapeHtml(entry.thumb)}" alt="${escapeHtml(entry.prompt || '')}" loading="lazy" data-preview-src="${escapeHtml(entry.thumb)}" data-preview-caption="${escapeHtml(entry.model || '历史图片')}" data-preview-download="history-${escapeHtml(entry.id.slice(0, 8))}.webp">` : ''}
        <button type="button" class="history-card-delete" data-action="delete" aria-label="删除这一条">×</button>
      </div>
      <div class="history-card-body">
        <div class="history-meta">
          <span>${escapeHtml(entry.model || 'model')}</span>
          <span>${escapeHtml(time)}</span>
        </div>
        <div class="history-prompt" title="${escapeHtml(entry.prompt || '')}">${escapeHtml(entry.prompt || '')}</div>
      </div>
      <div class="history-card-actions">
        <button type="button" data-action="fill">填入提示词</button>
        <button type="button" data-action="edit">作为编辑源</button>
      </div>
    `;
    fragment.appendChild(card);
  }
  historyList.innerHTML = '';
  historyList.appendChild(fragment);
}

function deleteHistoryEntry(id) {
  const next = loadHistory().filter((entry) => entry.id !== id);
  saveHistory(next);
  renderHistory(next);
}

function fillFromHistory(id) {
  const entry = loadHistory().find((item) => item.id === id);
  if (!entry) return;
  promptInput.value = entry.prompt || '';
  promptInput.focus();
  setState('已填入历史提示词。', 'ok');
}

function useHistoryAsEdit(id) {
  const entry = loadHistory().find((item) => item.id === id);
  if (!entry?.thumb) {
    setState('该历史条目没有可用的预览。', 'error');
    return;
  }
  setInlineEditSource(entry.thumb, `history-${entry.id.slice(0, 8)}.webp`);
  modeInput.value = 'edit';
  promptInput.value = entry.prompt || '';
  updateMode();
  promptInput.focus();
  setState('已用历史预览作为编辑源（缩略图，分辨率较小）。', 'ok');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function formatHistoryDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
