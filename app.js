const form = document.querySelector('#generateForm');
const siteKeyInput = document.querySelector('#siteKey');
const keyStatus = document.querySelector('#keyStatus');
const modeInput = document.querySelector('#mode');
const modelChoices = document.querySelector('#modelChoices');
const modelInputs = Array.from(document.querySelectorAll('input[name="models"]'));
const modelHint = document.querySelector('#modelHint');
const sizeInput = document.querySelector('#size');
const qualityInput = document.querySelector('#quality');
const outputFormatInput = document.querySelector('#outputFormat');
const imageCountInput = document.querySelector('#imageCount');
const promptInput = document.querySelector('#prompt');
const promptTemplatePanel = document.querySelector('#promptTemplatePanel');
const promptTemplateInput = document.querySelector('#promptTemplate');
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

const MAX_TOTAL_IMAGES = 6;
const API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:5173' : '';
let currentImages = [];
let inlineEditSource = null;
let generationTimer = null;
let generationStartedAt = 0;
const savedSiteKey = localStorage.getItem('img-gener.site-key') || '';
if (savedSiteKey) siteKeyInput.value = savedSiteKey;

const modelProfiles = {
  'gpt-image-2': {
    label: 'OpenAI gpt-image-2',
    max: '3840×2160 / 2160×3840',
    sizes: ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '2048x2048', '2048x3072', '3072x2048', '3840x2160', '2160x3840'],
  },
  'gemini-3-pro-image-preview': {
    label: 'Gemini 3 Pro Image Preview',
    max: '3840×2160 / 2160×3840',
    sizes: ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '2048x2048', '2048x3072', '3072x2048', '3840x2160', '2160x3840'],
  },
  'gemini-3.1-flash-image-preview': {
    label: 'Gemini 3.1 Flash Image Preview',
    max: '3840×2160 / 2160×3840',
    sizes: ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '2048x2048', '2048x3072', '3072x2048', '3840x2160', '2160x3840'],
  },
};

updateModelProfile();
refreshKeyStatus();
updateMode();
initPromptTemplates();
applyPendingGalleryPrompt();

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
  modelInputs.forEach((input, index) => { input.checked = index === 0; });
  updateModelProfile();
  setState('等待生成');
  setPreviewEmpty();
});

modelChoices.addEventListener('change', updateModelProfile);
imageCountInput.addEventListener('change', updateModelProfile);
modeInput.addEventListener('change', updateMode);
siteKeyInput.addEventListener('change', refreshKeyStatus);
siteKeyInput.addEventListener('blur', refreshKeyStatus);
siteKeyInput.addEventListener('input', () => {
  localStorage.setItem('img-gener.site-key', siteKeyInput.value.trim());
});
sourceImageInput.addEventListener('change', () => {
  if (sourceImageInput.files?.[0]) clearInlineEditSource();
});
promptTemplateInput?.addEventListener('change', updateTemplatePreview);
useTemplateBtn?.addEventListener('click', () => applyPromptTemplate('replace'));
appendTemplateBtn?.addEventListener('click', () => applyPromptTemplate('append'));

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

    const response = await fetch(apiPath(mode === 'edit' ? '/api/edit' : '/api/generate'), {
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

function setPreviewError(message) {
  previewBox.className = 'preview-box empty';
  previewBox.innerHTML = `<div><strong>生成失败</strong><p>${escapeHtml(message)}</p></div>`;
  metaBox.classList.add('hidden');
}

function setState(text, mode = '') {
  requestState.textContent = text;
  requestState.className = `pill ${mode}`.trim();
}

function initPromptTemplates() {
  const templates = Array.isArray(window.PROMPT_TEMPLATES) ? window.PROMPT_TEMPLATES : [];
  if (!promptTemplatePanel || !promptTemplateInput || !templates.length) return;

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
      group.appendChild(option);
    }
    promptTemplateInput.appendChild(group);
  }

  promptTemplatePanel.classList.remove('hidden');
  updateTemplatePreview();
}

function updateTemplatePreview() {
  if (!templatePreview) return;
  const template = getSelectedTemplate();
  if (!template) {
    const count = Array.isArray(window.PROMPT_TEMPLATES) ? window.PROMPT_TEMPLATES.length : 0;
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
  const templates = Array.isArray(window.PROMPT_TEMPLATES) ? window.PROMPT_TEMPLATES : [];
  return templates.find((template) => template.id === promptTemplateInput?.value) || null;
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
  if (!siteKeyInfo) return;
  keyStatus.textContent = `当前 key 已用 ${siteKeyInfo.used}/${siteKeyInfo.limit} 次，剩余 ${siteKeyInfo.remaining} 次。`;
}

function updateMode() {
  const isEdit = modeInput.value === 'edit';
  imageUploadLabel.classList.toggle('hidden', !isEdit);
  sourceImageInput.required = isEdit && !inlineEditSource;
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
    keyStatus.textContent = '请输入 key。';
    return;
  }

  try {
    const response = await fetch(apiPath(`/api/key-status?siteKey=${encodeURIComponent(siteKey)}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '查询失败');
    updateKeyStatus(payload);
  } catch (error) {
    keyStatus.textContent = error.message;
  }
}

function updateModelProfile() {
  const selectedModels = getSelectedModels();
  const activeProfiles = selectedModels.map((model) => modelProfiles[model]).filter(Boolean);
  const allowedSizes = activeProfiles.length
    ? activeProfiles.reduce((sizes, profile) => sizes.filter((size) => profile.sizes.includes(size)), [...activeProfiles[0].sizes])
    : [];

  for (const option of sizeInput.options) {
    option.disabled = Boolean(allowedSizes.length) && !allowedSizes.includes(option.value);
  }

  if (allowedSizes.length && !allowedSizes.includes(sizeInput.value)) {
    sizeInput.value = allowedSizes.includes('1024x1024') ? '1024x1024' : allowedSizes[0];
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

function apiPath(path) {
  return `${API_BASE}${path}`;
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
