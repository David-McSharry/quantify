import { loadSettings, saveSettings } from './lib/gateway.js';

const keyInput = document.getElementById('anthropic-key');
const modelSelect = document.getElementById('anthropic-model');
const customModelInput = document.getElementById('anthropic-model-custom');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');

const DEFAULT_MODEL = 'claude-opus-4-6';
let statusTimer = null;

function getSelectedModel() {
  if (modelSelect.value === 'custom') {
    return customModelInput.value.trim();
  }
  return modelSelect.value;
}

function updateCustomModelVisibility() {
  const show = modelSelect.value === 'custom';
  customModelInput.style.display = show ? 'block' : 'none';
}

function setModelValue(modelId) {
  const optionValues = Array.from(modelSelect.options).map((opt) => opt.value);
  if (optionValues.includes(modelId)) {
    modelSelect.value = modelId;
    customModelInput.value = '';
  } else {
    modelSelect.value = 'custom';
    customModelInput.value = modelId || '';
  }
  updateCustomModelVisibility();
}

function showStatus(message, type) {
  if (statusTimer) clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  if (type !== 'info') {
    statusTimer = setTimeout(() => { statusEl.className = 'status'; }, 5000);
  }
}

loadSettings().then((settings) => {
  keyInput.value = settings.anthropicApiKey || '';
  setModelValue(settings.anthropicModel || DEFAULT_MODEL);
  if (!settings.anthropicApiKey) {
    showStatus('Add your Anthropic API key to start using Quantify.', 'info');
    keyInput.focus();
  }
});

saveBtn.addEventListener('click', async () => {
  const anthropicApiKey = keyInput.value.trim();
  const anthropicModel = getSelectedModel() || DEFAULT_MODEL;
  if (!anthropicApiKey) {
    showStatus('Anthropic API key is required.', 'error');
    return;
  }
  if (!anthropicModel) {
    showStatus('Anthropic model is required.', 'error');
    return;
  }
  await saveSettings({ anthropicApiKey, anthropicModel });
  showStatus('Saved. Quantify estimates a >99% chance your key works.', 'success');
});

modelSelect.addEventListener('change', updateCustomModelVisibility);

for (const el of [keyInput, customModelInput]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBtn.click();
  });
}
