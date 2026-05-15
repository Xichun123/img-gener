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
const probeProgress = document.querySelector('#probeProgress');
const probeProgressFill = document.querySelector('#probeProgressFill');
const probeProgressText = document.querySelector('#probeProgressText');
const closeTestBtn = document.querySelector('#closeTestBtn');
const modelCardTemplate = document.querySelector('#modelCardTemplate');
const providerCardTemplate = document.querySelector('#providerCardTemplate');
const toastHost = document.querySelector('#toastHost');

const ADMIN_SESSION_KEY = 'img-gener.admin-session';
const ADMIN_PROBE_JOBS_KEY = 'img-gener.probe-jobs';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PROTOCOLS = ['openai_images', 'gemini_native', 'openai_responses_image'];
const HEADER_PRESETS = ['', 'browser'];
const PROBE_SIZES = ['auto', '1024x1024', '1024x1536', '1536x1024', '1792x1024', '1024x1792', '2048x2048', '2048x3072', '3072x2048', '3840x2160', '2160x3840'];
const PROBE_QUALITIES = ['low', 'medium', 'high', 'auto'];
const PROBE_FORMATS = ['png', 'jpeg', 'webp'];
const PROBE_POLL_INTERVAL_MS = 5000;

let routes = { models: [] };
let loaded = false;
let sessionToken = '';
const expandedModels = new Set();
const activeProbeJobs = new Map();

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
  fresh.id = nextAvailableId(routes.models.map((m) => m.id), 'model');
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
    resumeStoredProbeJobs();
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
    resumeStoredProbeJobs();
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
  resetProbeProgress(true);
  testPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const payload = await api('/api/admin/test-provider', {
      method: 'POST',
      body: JSON.stringify({
        model_id: model.id,
        provider,
        prompt: 'A simple red square icon on a white background.',
        size: provider.capabilities?.sizes?.includes('1024x1024') ? '1024x1024' : (provider.capabilities?.sizes?.[0] || '1024x1024'),
        quality: provider.capabilities?.qualities?.includes('low') ? 'low' : (provider.capabilities?.qualities?.[0] || 'low'),
        output_format: provider.capabilities?.formats?.includes('png') ? 'png' : (provider.capabilities?.formats?.[0] || 'png'),
      }),
    });
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · ${payload.ok ? '成功' : '失败'} · ${payload.elapsed}s`;
    testResult.textContent = JSON.stringify(payload, null, 2);
    resetProbeProgress(true);
    toast(payload.ok ? `测试成功（${payload.elapsed}s）` : `测试失败：${payload.error || '未知'}`, payload.ok ? 'ok' : 'error');
  } catch (error) {
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 错误`;
    testResult.textContent = error.message;
    toast(`测试错误：${error.message}`, 'error');
  }
}

async function probeProvider(modelIndex, providerIndex) {
  const model = routes.models[modelIndex];
  const provider = model?.providers?.[providerIndex];
  if (!model || !provider) return;
  const jobKey = `${model.id}:${provider.id}`;
  if (activeProbeJobs.has(jobKey)) {
    toast('这个 provider 已有探测任务在运行', 'info');
    return;
  }
  if (!confirm(`将对 provider "${provider.id}" 发起后台生图探测，每次测试间隔约 1-2 分钟，完成后自动保存能力配置。继续？`)) return;
  testPanel.hidden = false;
  testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 启动后台探测...`;
  testResult.textContent = '';
  resetProbeProgress(false);
  testPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const job = await api('/api/admin/probe-provider/start', {
      method: 'POST',
      body: JSON.stringify({
        model_id: model.id,
        provider_id: provider.id,
        sizes: PROBE_SIZES,
        qualities: PROBE_QUALITIES,
        formats: PROBE_FORMATS,
        include_edit: true,
        full_matrix: false,
      }),
    });
    activeProbeJobs.set(jobKey, job.id);
    storeProbeJob(jobKey, job.id, model.id, provider.id);
    updateProbeProgress({
      type: 'start',
      total: job.total,
      delay_range: job.delay_range,
    }, model, provider);
    appendProbeLog(`后台任务已启动 · ${job.id}`);
    toast('后台探测已启动，可以关闭管理页面，完成后会自动保存', 'ok');
    await pollProbeJob(job.id, model.id, provider.id, jobKey);
  } catch (error) {
    activeProbeJobs.delete(jobKey);
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 探测错误`;
    testResult.textContent = error.message;
    probeProgressText.textContent = error.message;
    toast(`探测错误：${error.message}`, 'error');
  }
}

async function pollProbeJob(jobId, modelId, providerId, jobKey) {
  let lastEventSeq = 0;
  while (true) {
    const job = await api(`/api/admin/probe-provider/job?id=${encodeURIComponent(jobId)}`);
    const model = routes.models.find((item) => item.id === modelId) || { id: modelId };
    const provider = model.providers?.find((item) => item.id === providerId) || { id: providerId };
    const events = Array.isArray(job.events) ? job.events : [];
    events
      .filter((event) => Number(event.seq || 0) > lastEventSeq)
      .forEach((event) => {
        updateProbeProgress(event, model, provider);
        lastEventSeq = Math.max(lastEventSeq, Number(event.seq || 0));
      });
    if (job.status === 'completed') {
      const payload = events.findLast?.((event) => event.type === 'complete') || {
        type: 'complete',
        ok: job.capabilities?.supports_generate !== false,
        elapsed: job.elapsed,
        provider_id: providerId,
        capabilities: job.capabilities,
        saved: job.saved,
      };
      updateProbeProgress(payload, model, provider);
      testMeta.textContent = `模型 ${modelId} · provider ${providerId} · 探测完成 · 已自动保存`;
      testResult.textContent = JSON.stringify(job, null, 2);
      activeProbeJobs.delete(jobKey);
      removeStoredProbeJob(jobKey);
      await loadRoutes();
      toast(payload.ok ? `能力探测完成并已保存（${payload.elapsed}s）` : '探测完成并已保存，但未发现可用文生图能力', payload.ok ? 'ok' : 'error');
      return job;
    }
    if (job.status === 'failed') {
      activeProbeJobs.delete(jobKey);
      removeStoredProbeJob(jobKey);
      throw new Error(job.error || '能力探测失败');
    }
    await wait(PROBE_POLL_INTERVAL_MS);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStoredProbeJobs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ADMIN_PROBE_JOBS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function storeProbeJob(jobKey, jobId, modelId, providerId) {
  const jobs = readStoredProbeJobs();
  jobs[jobKey] = { jobId, modelId, providerId, startedAt: Date.now() };
  localStorage.setItem(ADMIN_PROBE_JOBS_KEY, JSON.stringify(jobs));
}

function removeStoredProbeJob(jobKey) {
  const jobs = readStoredProbeJobs();
  delete jobs[jobKey];
  localStorage.setItem(ADMIN_PROBE_JOBS_KEY, JSON.stringify(jobs));
}

function resumeStoredProbeJobs() {
  Object.entries(readStoredProbeJobs()).forEach(([jobKey, item]) => {
    if (!item?.jobId || !item?.modelId || !item?.providerId || activeProbeJobs.has(jobKey)) return;
    activeProbeJobs.set(jobKey, item.jobId);
    testPanel.hidden = false;
    testMeta.textContent = `模型 ${item.modelId} · provider ${item.providerId} · 恢复后台探测进度...`;
    resetProbeProgress(false);
    pollProbeJob(item.jobId, item.modelId, item.providerId, jobKey).catch((error) => {
      activeProbeJobs.delete(jobKey);
      removeStoredProbeJob(jobKey);
      probeProgressText.textContent = error.message;
      appendProbeLog(`恢复失败 · ${error.message}`);
    });
  });
}

async function streamProbeProvider(body, onEvent) {
  const response = await fetch('/api/admin/probe-provider', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try { message = (text && JSON.parse(text).error) || message; } catch (_) {}
    throw new Error(message);
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式进度。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalPayload = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      onEvent(event);
      if (event.type === 'complete') finalPayload = event;
      if (event.type === 'error') throw new Error(event.error || '能力探测失败');
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = JSON.parse(buffer);
    onEvent(event);
    if (event.type === 'complete') finalPayload = event;
    if (event.type === 'error') throw new Error(event.error || '能力探测失败');
  }
  if (!finalPayload) throw new Error('能力探测未返回完成事件。');
  return finalPayload;
}

async function legacyProbeProvider(model, provider) {
  return streamProbeProvider({
    model_id: model.id,
    provider,
    sizes: PROBE_SIZES,
    qualities: PROBE_QUALITIES,
    formats: PROBE_FORMATS,
    include_edit: true,
    full_matrix: false,
    stream: true,
  }, (event) => updateProbeProgress(event, model, provider));
}

async function fetchProviderModels(modelIndex, providerIndex, node) {
  const model = routes.models[modelIndex];
  const provider = model?.providers?.[providerIndex];
  if (!model || !provider) return;
  if (typeof provider.api_key === 'string' && provider.api_key.startsWith('***')) {
    toast('api_key 是脱敏值，请先保存配置再获取模型列表', 'error');
    return;
  }
  const button = node.querySelector('[data-action="fetch-models"]');
  const picker = node.querySelector('[data-role="model-picker"]');
  if (!picker || !button) return;
  button.disabled = true;
  button.textContent = '获取中';
  try {
    const payload = await api('/api/admin/provider-models', {
      method: 'POST',
      body: JSON.stringify({ provider }),
    });
    renderModelPickerOptions(picker, payload.models || [], provider.upstream_model);
    picker.hidden = false;
    toast(`已获取 ${payload.models?.length || 0} 个模型`, 'ok');
  } catch (error) {
    toast(`获取模型失败：${error.message}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '获取';
  }
}

function renderModelPickerOptions(picker, models, currentValue) {
  picker.innerHTML = '<option value="">选择模型 id</option>';
  models.forEach((modelId) => {
    const option = document.createElement('option');
    option.value = modelId;
    option.textContent = modelId;
    picker.append(option);
  });
  picker.value = models.includes(currentValue) ? currentValue : '';
}

function resetProbeProgress(hidden) {
  probeProgress.hidden = hidden;
  probeProgressFill.style.width = '0%';
  probeProgressText.textContent = '';
}

function updateProbeProgress(event, model, provider) {
  probeProgress.hidden = false;
  const total = Number(event.total || 0);
  const completed = Number(event.completed || 0);
  const percent = total ? Math.max(0, Math.min(100, Math.round((completed / total) * 100))) : 0;
  if (event.type === 'start') {
    probeProgressFill.style.width = '0%';
    const delayText = Array.isArray(event.delay_range) ? ` · 间隔 ${event.delay_range[0]}-${event.delay_range[1]}s` : '';
    probeProgressText.textContent = `准备探测 0 / ${event.total}${delayText}`;
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · 准备探测`;
    return;
  }
  if (event.type === 'step_start') {
    const current = formatProbeTarget(event.current);
    probeProgressFill.style.width = `${percent}%`;
    probeProgressText.textContent = `正在测试 ${completed + 1} / ${total} · ${current}`;
    testMeta.textContent = `模型 ${model.id} · provider ${provider.id} · ${current}`;
    appendProbeLog(`开始 · ${current}`);
    return;
  }
  if (event.type === 'progress') {
    const current = formatProbeTarget(event.current);
    probeProgressFill.style.width = `${percent}%`;
    const guardText = event.guard_reason ? ` · ${event.guard_reason}` : '';
    probeProgressText.textContent = `已完成 ${completed} / ${total} · 成功 ${event.success_count || 0}${guardText}`;
    appendProbeLog(`${event.ok ? '成功' : '失败'} · ${current}${event.guard_reason ? ` · ${event.guard_reason}` : ''}${event.error ? ` · ${event.error}` : ''}`);
    return;
  }
  if (event.type === 'guard_wait') {
    probeProgressText.textContent = `检测到风控，等待 ${event.delay}s 后再试 · ${event.reason}`;
    appendProbeLog(`等待 · ${event.delay}s · ${event.reason}`);
    return;
  }
  if (event.type === 'probe_wait') {
    probeProgressText.textContent = `等待 ${event.delay}s 后继续下一项 · ${completed} / ${total}`;
    appendProbeLog(`间隔等待 · ${event.delay}s`);
    return;
  }
  if (event.type === 'guard_stop') {
    probeProgressText.textContent = `已停止连续探测 · ${event.reason}`;
    appendProbeLog(`停止 · ${event.reason}`);
    return;
  }
  if (event.type === 'saving') {
    probeProgressFill.style.width = `${percent}%`;
    probeProgressText.textContent = '探测结束，正在自动保存配置...';
    appendProbeLog('保存 · 写入 model-routes.json');
    return;
  }
  if (event.type === 'complete') {
    probeProgressFill.style.width = '100%';
    probeProgressText.textContent = `探测完成 · ${event.elapsed}s${event.saved ? ' · 已保存' : ''}`;
  }
}

function appendProbeLog(line) {
  testResult.textContent += `${line}\n`;
  testResult.scrollTop = testResult.scrollHeight;
}

function formatProbeTarget(current) {
  if (!current) return '未知项目';
  const mode = current.mode === 'edit' ? '图生图' : '文生图';
  return `${mode} · ${current.size} · ${current.quality} · ${current.format}`;
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

  bindInput(node, 'label', model, 'label');
  bindCheckbox(node, 'enabled', model, 'enabled', () => updateSummary(node, model));
  renderModelCapabilities(node, model);

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
  const capabilities = aggregateCapabilities(model);
  const tags = [];
  tags.push(`${providers.length} provider${providers.length === 1 ? '' : 's'}`);
  if (providers.length) tags.push(`启用 ${enabled}`);
  if (capabilities.supportsEdit) tags.push('可编辑');
  if (capabilities.sizes.length) tags.push(`${capabilities.sizes.length} 尺寸`);
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
  renderProviderCapabilities(node, provider);
  const picker = node.querySelector('[data-role="model-picker"]');
  picker?.addEventListener('change', () => {
    if (!picker.value) return;
    provider.upstream_model = picker.value;
    const input = node.querySelector('[data-field="upstream_model"]');
    if (input) input.value = picker.value;
    routesEditor.value = JSON.stringify(routes, null, 2);
  });

  node.querySelector('[data-action="delete-provider"]').addEventListener('click', () => {
    if (!confirm(`确定删除 provider "${provider.id}"？`)) return;
    routes.models[modelIndex].providers.splice(providerIndex, 1);
    renderAll();
    toast(`已删除 provider "${provider.id}"`, 'ok');
  });
  node.querySelector('[data-action="test-provider"]').addEventListener('click', () => {
    testProvider(modelIndex, providerIndex);
  });
  node.querySelector('[data-action="probe-provider"]').addEventListener('click', () => {
    probeProvider(modelIndex, providerIndex);
  });
  node.querySelector('[data-action="fetch-models"]').addEventListener('click', () => {
    fetchProviderModels(modelIndex, providerIndex, node);
  });
  node.querySelector('[data-action="toggle-key"]').addEventListener('click', (event) => {
    const input = node.querySelector('[data-field="api_key"]');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    event.currentTarget.textContent = showing ? '显示' : '隐藏';
  });

  return node;
}

function renderModelCapabilities(node, model) {
  const wrap = node.querySelector('[data-role="model-capabilities"]');
  if (!wrap) return;
  const capabilities = aggregateCapabilities(model);
  wrap.innerHTML = '';
  wrap.append(capabilityBlock('系统聚合能力', [
    capabilities.supportsGenerate ? '支持文生图' : '未发现文生图',
    capabilities.supportsEdit ? '支持图生图' : '不支持图生图',
  ]));
  wrap.append(capabilityBlock('尺寸', capabilities.sizes));
  wrap.append(capabilityBlock('质量', capabilities.qualities));
  wrap.append(capabilityBlock('格式', capabilities.formats));
}

function renderProviderCapabilities(node, provider) {
  const wrap = node.querySelector('[data-role="provider-capabilities"]');
  if (!wrap) return;
  const capabilities = provider.capabilities;
  wrap.innerHTML = '';
  if (!capabilities) {
    const empty = document.createElement('small');
    empty.className = 'field-note';
    empty.textContent = '未探测能力；保存旧配置时仍会使用兼容字段。';
    wrap.append(empty);
    return;
  }
  wrap.append(capabilityBlock(`探测结果${capabilities.tested_at ? ` · ${capabilities.tested_at}` : ''}`, [
    capabilities.supports_generate ? '文生图可用' : '文生图不可用',
    capabilities.supports_edit ? '图生图可用' : '图生图不可用',
  ]));
  wrap.append(capabilityBlock('尺寸', capabilities.sizes || []));
  wrap.append(capabilityBlock('质量', capabilities.qualities || []));
  wrap.append(capabilityBlock('格式', capabilities.formats || []));
}

function capabilityBlock(label, values) {
  const block = document.createElement('div');
  block.className = 'capability-block';
  const title = document.createElement('span');
  title.className = 'chip-label';
  title.textContent = label;
  const list = document.createElement('div');
  list.className = 'chip-list';
  const items = Array.isArray(values) && values.length ? values : ['无'];
  items.forEach((value) => {
    const chip = document.createElement('span');
    chip.className = 'chip capability-chip';
    chip.textContent = value;
    list.append(chip);
  });
  block.append(title, list);
  return block;
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

function aggregateCapabilities(model) {
  const providers = (model.providers || []).filter((provider) => provider.enabled !== false);
  const sizes = [];
  const qualities = [];
  const formats = [];
  let supportsGenerate = false;
  let supportsEdit = false;

  providers.forEach((provider) => {
    if (provider.capabilities) {
      if (provider.capabilities.supports_generate === false) return;
      supportsGenerate = true;
      supportsEdit = supportsEdit || provider.capabilities.supports_edit === true;
      mergeUnique(sizes, provider.capabilities.sizes);
      mergeUnique(qualities, provider.capabilities.qualities);
      mergeUnique(formats, provider.capabilities.formats);
      return;
    }
    if (provider.supports_generate === false) return;
    supportsGenerate = true;
    supportsEdit = supportsEdit || provider.supports_edit !== false;
    mergeUnique(sizes, model.sizes || ['1024x1024']);
    mergeUnique(qualities, model.qualities || ['low', 'medium', 'high']);
    mergeUnique(formats, model.formats || ['png']);
  });

  return {
    supportsGenerate,
    supportsEdit,
    sizes,
    qualities,
    formats,
  };
}

function mergeUnique(target, values) {
  if (!Array.isArray(values)) return;
  values.forEach((value) => {
    if (typeof value === 'string' && value && !target.includes(value)) target.push(value);
  });
}

function nextAvailableId(existing, prefix) {
  const used = existing instanceof Set ? existing : new Set(existing);
  if (!used.has(prefix)) return prefix;
  let i = 2;
  while (used.has(`${prefix}-${i}`)) i++;
  return `${prefix}-${i}`;
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
    id: 'model',
    label: '新模型',
    enabled: true,
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
    capabilities: null,
    headers_preset: null,
  };
}

function normalizeRoutes(payload) {
  const models = Array.isArray(payload?.models) ? payload.models : [];
  const usedModelIds = new Set();
  return {
    models: models.map((model) => {
      const incomingId = String(model.id ?? '').trim();
      const id = incomingId && !usedModelIds.has(incomingId)
        ? incomingId
        : nextAvailableId(usedModelIds, 'model');
      usedModelIds.add(id);
      return {
        id,
        label: String(model.label ?? id),
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
          capabilities: normalizeCapabilities(provider.capabilities),
          headers_preset: provider.headers_preset ?? null,
        })) : [],
      };
    }),
  };
}

function normalizeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return null;
  return {
    supports_generate: capabilities.supports_generate !== false,
    supports_edit: capabilities.supports_edit === true,
    sizes: Array.isArray(capabilities.sizes) ? [...capabilities.sizes] : [],
    qualities: Array.isArray(capabilities.qualities) ? [...capabilities.qualities] : [],
    formats: Array.isArray(capabilities.formats) ? [...capabilities.formats] : [],
    combinations: Array.isArray(capabilities.combinations) ? capabilities.combinations.map((item) => ({ ...item })) : [],
    matrix_complete: capabilities.matrix_complete === true,
    tested_at: capabilities.tested_at ?? null,
    tests: Array.isArray(capabilities.tests) ? capabilities.tests.map((item) => ({ ...item })) : [],
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
