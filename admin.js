const loginGate = document.querySelector('#loginGate');
const loginForm = document.querySelector('#loginForm');
const loginTokenInput = document.querySelector('#loginToken');
const loginError = document.querySelector('#loginError');
const adminContent = document.querySelector('#adminContent');
const logoutBtn = document.querySelector('#logoutBtn');
const refreshRoutesBtn = document.querySelector('#refreshRoutesBtn');
const saveRoutesBtn = document.querySelector('#saveRoutesBtn');
const resetHealthBtn = document.querySelector('#resetHealthBtn');
const addModelBtn = document.querySelector('#addModelBtn');
const expandAllBtn = document.querySelector('#expandAllBtn');
const collapseAllBtn = document.querySelector('#collapseAllBtn');
const modelCount = document.querySelector('#modelCount');
const modelsList = document.querySelector('#modelsList');
const adminState = document.querySelector('#adminState');
const routesEditor = document.querySelector('#routesEditor');
const applyRawBtn = document.querySelector('#applyRawBtn');
const formatRawBtn = document.querySelector('#formatRawBtn');
const testPanel = document.querySelector('#testPanel');
const testResult = document.querySelector('#testResult');
const testMeta = document.querySelector('#testMeta');
const closeTestBtn = document.querySelector('#closeTestBtn');
const modelCardTemplate = document.querySelector('#modelCardTemplate');
const providerCardTemplate = document.querySelector('#providerCardTemplate');
const toastHost = document.querySelector('#toastHost');

const ADMIN_SESSION_KEY = 'img-gener.admin-session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROTOCOLS = ['openai_images', 'gemini_native', 'openai_responses_image'];
const HEADER_PRESETS = ['', 'browser'];

let routes = { models: [] };
let loaded = false;
let sessionToken = '';
const expandedModels = new Set();

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await attemptLogin(loginTokenInput.value.trim());
});
logoutBtn.addEventListener('click', () => {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
  sessionToken = '';
  loaded = false;
  routes = { models: [] };
  expandedModels.clear();
  showGate();
  loginTokenInput.value = '';
  toast('已退出登录', 'ok');
});
refreshRoutesBtn.addEventListener('click', loadRoutes);
saveRoutesBtn.addEventListener('click', saveRoutes);
resetHealthBtn.addEventListener('click', resetHealth);
addModelBtn.addEventListener('click', () => {
  const fresh = newModel();
  fresh.id = nextAvailableId(routes.models.map((m) => m.id), 'new-model');
  routes.models.push(fresh);
  expandedModels.clear();
  expandedModels.add(fresh.id);
  renderAll();
  toast(`已新增模型 "${fresh.id}"，记得修改字段后点"保存配置"`, 'ok');
  scrollToModel(fresh.id);
});
expandAllBtn.addEventListener('click', () => {
  routes.models.forEach((m) => expandedModels.add(m.id));
  renderModels();
});
collapseAllBtn.addEventListener('click', () => {
  expandedModels.clear();
  renderModels();
});
applyRawBtn.addEventListener('click', applyRawJson);
formatRawBtn.addEventListener('click', () => {
  try {
    routesEditor.value = JSON.stringify(JSON.parse(routesEditor.value), null, 2);
    toast('JSON 已格式化', 'ok');
  } catch (error) {
    toast('JSON 格式错误', 'error');
  }
});
closeTestBtn.addEventListener('click', () => { testPanel.hidden = true; });

bootstrap();

async function bootstrap() {
  const session = readSession();
  if (session) {
    sessionToken = session.token;
    showAdmin();
    try {
      await loadRoutes();
    } catch (_) {
      // loadRoutes handles its own errors
    }
    return;
  }
  showGate();
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    if (parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    return null;
  }
}

function writeSession(token) {
  sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify({
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
  }));
}

function showGate() {
  loginGate.hidden = false;
  adminContent.hidden = true;
  loginError.hidden = true;
  loginError.textContent = '';
  setTimeout(() => loginTokenInput.focus(), 50);
}

function showAdmin() {
  loginGate.hidden = true;
  adminContent.hidden = false;
}

async function attemptLogin(token) {
  if (!token) {
    showLoginError('请输入管理口令');
    return;
  }
  loginError.hidden = true;
  const previousToken = sessionToken;
  sessionToken = token;
  try {
    const response = await fetch('/api/admin/model-routes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const text = await response.text();
      let message = `HTTP ${response.status}`;
      try { message = (text && JSON.parse(text).error) || message; } catch (_) {}
      throw new Error(message);
    }
    const payload = await response.json();
    writeSession(token);
    routes = normalizeRoutes(payload);
    loaded = true;
    addModelBtn.disabled = false;
    expandAllBtn.disabled = false;
    collapseAllBtn.disabled = false;
    expandedModels.clear();
    renderAll();
    setState('已加载', 'ok');
    showAdmin();
    toast(`登录成功，已加载 ${routes.models.length} 个模型`, 'ok');
  } catch (error) {
    sessionToken = previousToken;
    showLoginError(error.message || '登录失败');
  }
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

async function loadRoutes() {
  setState('加载中', 'loading');
  try {
    const payload = await api('/api/admin/model-routes');
    routes = normalizeRoutes(payload);
    loaded = true;
    addModelBtn.disabled = false;
    expandAllBtn.disabled = false;
    collapseAllBtn.disabled = false;
    expandedModels.clear();
    renderAll();
    setState('已加载', 'ok');
    toast(`已加载 ${routes.models.length} 个模型`, 'ok');
  } catch (error) {
    setState(error.message, 'error');
    if (/401|403/.test(error.message)) {
      sessionStorage.removeItem(ADMIN_SESSION_KEY);
      sessionToken = '';
      showGate();
      toast('登录已过期，请重新登录', 'error');
    } else {
      toast(`加载失败：${error.message}`, 'error');
    }
  }
}

async function saveRoutes() {
  if (!loaded) {
    toast('请先刷新加载配置', 'error');
    return;
  }
  setState('保存中', 'loading');
  try {
    const payload = await api('/api/admin/model-routes', {
      method: 'PUT',
      body: JSON.stringify(routes),
    });
    routes = normalizeRoutes(payload);
    renderAll();
    setState('已保存', 'ok');
    toast('已保存到服务器', 'ok');
  } catch (error) {
    setState(error.message, 'error');
    toast(`保存失败：${error.message}`, 'error');
  }
}

async function resetHealth() {
  setState('清理中', 'loading');
  try {
    await api('/api/admin/provider-health/reset', { method: 'POST', body: '{}' });
    setState('熔断已清空', 'ok');
    toast('已清空熔断状态', 'ok');
  } catch (error) {
    setState(error.message, 'error');
    toast(`清空失败：${error.message}`, 'error');
  }
}

async function testProvider(modelIndex, providerIndex) {
  const model = routes.models[modelIndex];
  const provider = model?.providers?.[providerIndex];
  if (!model || !provider) return;
  if (typeof provider.api_key === 'string' && provider.api_key.startsWith('***')) {
    toast('api_key 是脱敏值，请先保存配置再测试', 'error');
    return;
  }
  testPanel.hidden = false;
  testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 测试中...`;
  testResult.textContent = '';
  testPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const payload = await api('/api/admin/test-provider', {
      method: 'POST',
      body: JSON.stringify({
        model_id: model.id,
        provider,
        prompt: 'A simple red square icon on a white background.',
        size: model.sizes?.includes('1024x1024') ? '1024x1024' : (model.sizes?.[0] || '1024x1024'),
        quality: model.qualities?.includes('low') ? 'low' : (model.qualities?.[0] || 'low'),
        output_format: model.formats?.includes('png') ? 'png' : (model.formats?.[0] || 'png'),
      }),
    });
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · ${payload.ok ? '成功' : '失败'} · ${payload.elapsed}s`;
    testResult.textContent = JSON.stringify(payload, null, 2);
    toast(payload.ok ? `测试成功（${payload.elapsed}s）` : `测试失败：${payload.error || '未知'}`, payload.ok ? 'ok' : 'error');
  } catch (error) {
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 错误`;
    testResult.textContent = error.message;
    toast(`测试错误：${error.message}`, 'error');
  }
}

function applyRawJson() {
  try {
    const parsed = JSON.parse(routesEditor.value || '{"models":[]}');
    routes = normalizeRoutes(parsed);
    renderAll();
    setState('已从 JSON 应用', 'ok');
    toast('JSON 已应用到表单', 'ok');
  } catch (error) {
    setState('JSON 解析失败', 'error');
    toast('JSON 解析失败', 'error');
  }
}

function renderAll() {
  renderModels();
  routesEditor.value = JSON.stringify(routes, null, 2);
}

function renderModels() {
  modelsList.innerHTML = '';
  modelCount.textContent = routes.models.length ? `（共 ${routes.models.length}）` : '';
  if (!routes.models.length) {
    const empty = document.createElement('p');
    empty.className = 'field-note';
    empty.textContent = loaded ? '还没有模型，点击右上角"+ 新增模型"。' : '点击上方"加载配置"开始编辑。';
    modelsList.append(empty);
    return;
  }
  routes.models.forEach((model, index) => {
    modelsList.append(renderModelCard(model, index));
  });
}

function renderModelCard(model, modelIndex) {
  const node = modelCardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.index = String(modelIndex);
  node.dataset.modelId = model.id;

  const isExpanded = expandedModels.has(model.id);
  if (isExpanded) node.classList.remove('collapsed');
  const collapseBtn = node.querySelector('[data-action="toggle-collapse"]');
  collapseBtn.textContent = isExpanded ? '折叠' : '展开';

  bindInput(node, 'id', model, 'id', () => {
    node.dataset.modelId = model.id;
    updateSummary(node, model);
  });
  bindInput(node, 'label', model, 'label');
  bindCheckbox(node, 'enabled', model, 'enabled', () => updateSummary(node, model));
  bindCheckbox(node, 'supports_edit', model, 'supports_edit', () => updateSummary(node, model));

  renderChipField(node, 'sizes', model);
  renderChipField(node, 'qualities', model);
  renderChipField(node, 'formats', model);

  const providersList = node.querySelector('[data-role="providers"]');
  providersList.innerHTML = '';
  (model.providers || []).forEach((provider, providerIndex) => {
    providersList.append(renderProviderCard(provider, modelIndex, providerIndex, model, node));
  });

  node.querySelector('[data-action="delete-model"]').addEventListener('click', () => {
    if (!confirm(`确定删除模型 "${model.id}"？`)) return;
    routes.models.splice(modelIndex, 1);
    expandedModels.delete(model.id);
    renderAll();
    toast(`已删除模型 "${model.id}"`, 'ok');
  });
  node.querySelector('[data-action="add-provider"]').addEventListener('click', () => {
    model.providers = model.providers || [];
    const fresh = newProvider();
    fresh.id = nextAvailableId(model.providers.map((p) => p.id), 'new-provider');
    model.providers.push(fresh);
    expandedModels.add(model.id);
    renderAll();
    toast(`已为 "${model.id}" 新增 provider "${fresh.id}"`, 'ok');
  });
  collapseBtn.addEventListener('click', () => {
    if (expandedModels.has(model.id)) {
      expandedModels.delete(model.id);
    } else {
      expandedModels.add(model.id);
    }
    renderModels();
  });

  updateSummary(node, model);
  return node;
}

function updateSummary(node, model) {
  const target = node.querySelector('[data-role="summary"]');
  if (!target) return;
  const providers = model.providers || [];
  const enabled = providers.filter((p) => p.enabled !== false).length;
  const tags = [];
  tags.push(`${providers.length} provider${providers.length === 1 ? '' : 's'}`);
  if (providers.length) tags.push(`启用 ${enabled}`);
  if (model.supports_edit) tags.push('可编辑');
  if (!model.enabled) tags.push('已禁用');
  target.textContent = tags.join(' · ');
}

function renderProviderCard(provider, modelIndex, providerIndex, model, modelNode) {
  const node = providerCardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.modelIndex = String(modelIndex);
  node.dataset.providerIndex = String(providerIndex);

  bindInput(node, 'id', provider, 'id', () => updateSummary(modelNode, model));
  bindInput(node, 'base_url', provider, 'base_url');
  bindInput(node, 'api_key', provider, 'api_key');
  bindInput(node, 'upstream_model', provider, 'upstream_model');
  bindNumber(node, 'priority', provider, 'priority');
  bindSelect(node, 'protocol', provider, 'protocol', PROTOCOLS);
  bindSelect(node, 'headers_preset', provider, 'headers_preset', HEADER_PRESETS, true);
  bindCheckbox(node, 'enabled', provider, 'enabled', () => updateSummary(modelNode, model));
  bindCheckbox(node, 'supports_generate', provider, 'supports_generate');
  bindCheckbox(node, 'supports_edit', provider, 'supports_edit');

  node.querySelector('[data-action="delete-provider"]').addEventListener('click', () => {
    if (!confirm(`确定删除 provider "${provider.id}"？`)) return;
    routes.models[modelIndex].providers.splice(providerIndex, 1);
    renderAll();
    toast(`已删除 provider "${provider.id}"`, 'ok');
  });
  node.querySelector('[data-action="test-provider"]').addEventListener('click', () => {
    testProvider(modelIndex, providerIndex);
  });
  node.querySelector('[data-action="toggle-key"]').addEventListener('click', (event) => {
    const input = node.querySelector('[data-field="api_key"]');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    event.currentTarget.textContent = showing ? '显示' : '隐藏';
  });

  return node;
}

function scrollToModel(modelId) {
  requestAnimationFrame(() => {
    const node = modelsList.querySelector(`[data-model-id="${cssEscape(modelId)}"]`);
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function nextAvailableId(existing, prefix) {
  const used = new Set(existing);
  if (!used.has(prefix)) return prefix;
  let i = 2;
  while (used.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
}

function renderChipField(node, field, model) {
  const wrap = node.querySelector(`.chip-list[data-field="${field}"]`);
  wrap.innerHTML = '';
  const values = Array.isArray(model[field]) ? model[field] : [];
  values.forEach((value, valueIndex) => {
    const chip = document.createElement('span');
    chip.className = 'chip chip-removable';
    chip.textContent = value;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.className = 'chip-remove';
    remove.addEventListener('click', () => {
      values.splice(valueIndex, 1);
      renderChipField(node, field, model);
      routesEditor.value = JSON.stringify(routes, null, 2);
    });
    chip.append(remove);
    wrap.append(chip);
  });
  const adder = wrap.parentElement.querySelector('.chip-add');
  const input = adder.querySelector('input');
  const button = adder.querySelector('button');
  const submit = () => {
    const value = input.value.trim();
    if (!value) return;
    model[field] = model[field] || [];
    if (!model[field].includes(value)) model[field].push(value);
    input.value = '';
    renderChipField(node, field, model);
    routesEditor.value = JSON.stringify(routes, null, 2);
  };
  button.onclick = submit;
  input.onkeydown = (event) => {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
  };
}

function bindInput(node, field, target, key, onChange) {
  const el = node.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  el.value = target[key] ?? '';
  el.addEventListener('input', () => {
    target[key] = el.value;
    routesEditor.value = JSON.stringify(routes, null, 2);
    if (onChange) onChange();
  });
}

function bindNumber(node, field, target, key, onChange) {
  const el = node.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  el.value = Number(target[key] ?? 100);
  el.addEventListener('input', () => {
    const parsed = parseInt(el.value, 10);
    target[key] = Number.isFinite(parsed) ? parsed : 100;
    routesEditor.value = JSON.stringify(routes, null, 2);
    if (onChange) onChange();
  });
}

function bindCheckbox(node, field, target, key, onChange) {
  const el = node.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  el.checked = Boolean(target[key]);
  el.addEventListener('change', () => {
    target[key] = el.checked;
    routesEditor.value = JSON.stringify(routes, null, 2);
    if (onChange) onChange();
  });
}

function bindSelect(node, field, target, key, options, allowEmpty = false, onChange) {
  const el = node.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  let value = target[key] ?? (allowEmpty ? '' : options[0]);
  if (value === null) value = '';
  if (!options.includes(value)) {
    const extra = document.createElement('option');
    extra.value = value;
    extra.textContent = value;
    el.append(extra);
  }
  el.value = value;
  el.addEventListener('change', () => {
    target[key] = el.value === '' ? null : el.value;
    routesEditor.value = JSON.stringify(routes, null, 2);
    if (onChange) onChange();
  });
}

function newModel() {
  return {
    id: 'new-model',
    label: 'New Model',
    enabled: true,
    supports_edit: false,
    sizes: ['1024x1024'],
    qualities: ['low', 'medium', 'high'],
    formats: ['png'],
    providers: [newProvider()],
  };
}

function newProvider() {
  return {
    id: 'new-provider',
    enabled: true,
    priority: 100,
    protocol: 'openai_images',
    base_url: 'https://api.example.com',
    api_key: '',
    upstream_model: 'upstream-model-id',
    supports_generate: true,
    supports_edit: false,
    headers_preset: null,
  };
}

function normalizeRoutes(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  return {
    models: models.map((model) => ({
      id: String(model.id ?? ''),
      label: String(model.label ?? model.id ?? ''),
      enabled: model.enabled !== false,
      supports_edit: Boolean(model.supports_edit),
      sizes: Array.isArray(model.sizes) ? [...model.sizes] : [],
      qualities: Array.isArray(model.qualities) ? [...model.qualities] : [],
      formats: Array.isArray(model.formats) ? [...model.formats] : [],
      providers: Array.isArray(model.providers) ? model.providers.map((provider) => ({
        id: String(provider.id ?? ''),
        enabled: provider.enabled !== false,
        priority: Number.isFinite(provider.priority) ? provider.priority : 100,
        protocol: provider.protocol ?? 'openai_images',
        base_url: String(provider.base_url ?? ''),
        api_key: String(provider.api_key ?? ''),
        upstream_model: String(provider.upstream_model ?? ''),
        supports_generate: provider.supports_generate !== false,
        supports_edit: provider.supports_edit !== false,
        headers_preset: provider.headers_preset ?? null,
      })) : [],
    })),
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function setState(text, mode = '') {
  adminState.textContent = text;
  adminState.className = `pill ${mode}`.trim();
}

function toast(message, type = 'info', timeout = 3200) {
  if (!toastHost) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.textContent = message;
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('toast-show'));
  setTimeout(() => {
    node.classList.remove('toast-show');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 600);
  }, timeout);
}
