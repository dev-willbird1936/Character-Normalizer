const state = {
  mode: 'front',
  frontSubtab: 'generate',
  prompt: '',
  sourcePhotoPath: '',
  resolution: '4K (4096 px)',
  autoSavePath: 'output/generated-images',
  cleanup: {
    enhanceImage: false,
    removeHair: false,
    removeBeard: false,
    removeEyebrow: false,
    removeEyelash: false,
    removeMakeup: false,
  },
  sideBodyOutputs: { side: false, body: false },
  bodyOptions: {
    bodyShape: 'average',
    gender: 'male',
    physique: 'normal',
  },
  applyOutputs: { front: true, side: true, body: true },
  selectedResultOutputs: { front: false, side: false, body: false },
  result: null,
  loading: false,
  error: '',
  statusMessage: '',
};

const $ = (id) => document.getElementById(id);

function updateUI() {
  // Top tabs
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.mode === state.mode);
  });

  // Panels
  $('front-panel').classList.toggle('hidden', state.mode !== 'front');
  $('side-body-panel').classList.toggle('hidden', state.mode !== 'side-body');

  // Front sub-tabs
  document.querySelectorAll('.subtab').forEach((sub) => {
    sub.classList.toggle('active', sub.dataset.subtab === state.frontSubtab);
  });
  $('generate-panel').classList.toggle('hidden', state.frontSubtab !== 'generate');
  $('modify-panel').classList.toggle('hidden', state.frontSubtab !== 'modify');

  // Photo previews
  updatePhotoPreview('photoPreview', 'photoPlaceholder', state.sourcePhotoPath);
  updatePhotoPreview('photoPreviewSide', 'photoPlaceholderSide', state.sourcePhotoPath);

  // Inputs sync
  $('prompt').value = state.prompt;
  $('resolution').value = state.resolution;
  $('autoSave').value = state.autoSavePath;
  $('resolutionModify').value = state.resolution;
  $('autoSaveModify').value = state.autoSavePath;
  $('autoSaveSide').value = state.autoSavePath;

  $('enhanceImage').checked = state.cleanup.enhanceImage;
  $('removeHair').checked = state.cleanup.removeHair;
  $('removeBeard').checked = state.cleanup.removeBeard;
  $('removeEyebrow').checked = state.cleanup.removeEyebrow;
  $('removeEyelash').checked = state.cleanup.removeEyelash;
  $('removeMakeup').checked = state.cleanup.removeMakeup;

  $('outputSide').checked = state.sideBodyOutputs.side;
  $('outputBody').checked = state.sideBodyOutputs.body;

  document.querySelectorAll('input[name="bodyShape"]').forEach((radio) => {
    radio.checked = radio.value === state.bodyOptions.bodyShape;
  });
  document.querySelectorAll('input[name="gender"]').forEach((radio) => {
    radio.checked = radio.value === state.bodyOptions.gender;
  });
  document.querySelectorAll('input[name="physique"]').forEach((radio) => {
    radio.checked = radio.value === state.bodyOptions.physique;
  });

  $('bodyOptionsFieldset').disabled = !state.sideBodyOutputs.body;

  // Apply checkboxes
  ['applyFront', 'applyFrontModify', 'applyFrontSide'].forEach((id) => {
    const el = $(id);
    if (el) el.checked = state.applyOutputs.front;
  });
  ['applySide', 'applySideModify', 'applySideSide'].forEach((id) => {
    const el = $(id);
    if (el) el.checked = state.applyOutputs.side;
  });
  ['applyBody', 'applyBodyModify', 'applyBodySide'].forEach((id) => {
    const el = $(id);
    if (el) el.checked = state.applyOutputs.body;
  });

  // Results
  updateResultSlots();

  // Buttons
  updateButtons();

  // Errors
  updateStatusLine('error', state.frontSubtab === 'generate' && state.mode === 'front');
  updateStatusLine('errorModify', state.frontSubtab === 'modify' && state.mode === 'front');
  updateStatusLine('errorSide', state.mode === 'side-body');
}

function updateStatusLine(id, isActivePanel) {
  const el = $(id);
  el.classList.toggle('loading-status', state.loading && isActivePanel);
  el.classList.toggle('error-status', Boolean(state.error) && isActivePanel);
  el.classList.toggle('success-status', Boolean(state.statusMessage || state.result?.assets?.length) && !state.error && !state.loading && isActivePanel);

  if (!isActivePanel) {
    el.textContent = '';
    return;
  }

  if (state.loading) {
    el.textContent = state.statusMessage || 'Generating image... Codex is working.';
    return;
  }

  if (state.error) {
    el.textContent = `Generation failed: ${state.error}`;
    return;
  }

  if (state.statusMessage) {
    el.textContent = state.statusMessage;
    return;
  }

  const generatedCount = state.result?.assets?.length || 0;
  if (generatedCount > 0) {
    el.textContent = `Generation complete: ${generatedCount} image${generatedCount === 1 ? '' : 's'} ready.`;
    return;
  }

  el.textContent = '';
}

function updatePhotoPreview(imgId, placeholderId, filePath) {
  const img = $(imgId);
  const placeholder = $(placeholderId);
  if (filePath) {
    img.src = `/api/image?path=${encodeURIComponent(filePath)}`;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }
}

function updateResultSlots() {
  const assets = state.result?.assets || [];
  document.querySelectorAll('.result-slot').forEach((slot) => {
    const output = slot.dataset.output;
    const img = slot.querySelector('img');
    const placeholder = slot.querySelector('.slot-art');
    const asset = assets.find((a) => a.output === output);
    if (asset) {
      img.src = `/api/image?path=${encodeURIComponent(asset.filePath)}`;
      img.classList.remove('hidden');
      placeholder.classList.add('hidden');
      slot.classList.add('has-asset');
      slot.classList.toggle('selected', Boolean(state.selectedResultOutputs[output]));
    } else {
      img.src = '';
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
      slot.classList.remove('has-asset', 'selected');
    }
  });
}

function updateButtons() {
  const frontGenerateValid = state.prompt.trim().length > 0;
  const hasSource = Boolean(state.sourcePhotoPath);
  const hasSideBodyOutput = state.sideBodyOutputs.side || state.sideBodyOutputs.body;

  const generateEnabled = {
    'front-generate': frontGenerateValid,
    'front-modify': hasSource,
    'side-body': hasSource && hasSideBodyOutput,
  }[getCurrentRequestMode()];

  const generateLoading = state.loading;

  $('generateBtn').disabled = !generateEnabled || generateLoading;
  $('generateBtnModify').disabled = !generateEnabled || generateLoading;
  $('generateBtnSide').disabled = !generateEnabled || generateLoading;
  updateGenerateButton('generateBtn', generateLoading);
  updateGenerateButton('generateBtnModify', generateLoading);
  updateGenerateButton('generateBtnSide', generateLoading);

  const assets = state.result?.assets || [];
  const hasSelectedAsset = assets.some((asset) => (
    state.selectedResultOutputs[asset.output] && state.applyOutputs[asset.output]
  ));

  $('applyBtn').disabled = !hasSelectedAsset;
  $('applyBtnModify').disabled = !hasSelectedAsset;
  $('applyBtnSide').disabled = !hasSelectedAsset;
}

function updateGenerateButton(id, isLoading) {
  const button = $(id);
  button.classList.toggle('is-loading', isLoading);
  button.setAttribute('aria-busy', String(isLoading));
  button.innerHTML = isLoading
    ? '<span class="spinner" aria-hidden="true"></span>GENERATING IMAGE...'
    : '<span class="icon icon-spark" aria-hidden="true"></span>GENERATE IMAGE';
}

function getCurrentRequestMode() {
  if (state.mode === 'front') {
    return state.frontSubtab === 'generate' ? 'front-generate' : 'front-modify';
  }
  return 'side-body';
}

function buildRequest() {
  const mode = getCurrentRequestMode();
  const outputs =
    mode === 'side-body'
      ? { front: false, side: state.sideBodyOutputs.side, body: state.sideBodyOutputs.body }
      : { front: true, side: true, body: true };

  return {
    mode,
    prompt: state.prompt,
    sourceImagePath: state.sourcePhotoPath,
    outputs,
    resolution: state.resolution,
    autoSavePath: state.autoSavePath,
    cleanup: { ...state.cleanup },
    bodyOptions: { ...state.bodyOptions },
  };
}

async function handleGenerate() {
  if (state.loading) return;
  state.loading = true;
  state.error = '';
  state.statusMessage = '';
  state.result = { assets: [], metadata: {} };
  state.selectedResultOutputs = { front: false, side: false, body: false };
  updateUI();

  try {
    const response = await fetch('/api/generate?stream=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest()),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Generation failed');
    }
    await readGenerationStream(response);
  } catch (err) {
    state.error = err.message || 'Generation failed';
  } finally {
    state.loading = false;
    updateUI();
  }
}

async function readGenerationStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      handleGenerationEvent(JSON.parse(line));
    }

    if (done) break;
  }

  if (buffer.trim()) {
    handleGenerationEvent(JSON.parse(buffer));
  }
}

function handleGenerationEvent(event) {
  if (event.type === 'asset') {
    addGeneratedAsset(event.asset);
    const count = state.result.assets.length;
    state.statusMessage = `${event.asset.output} ready. ${count} image${count === 1 ? '' : 's'} generated so far.`;
    updateUI();
    return;
  }

  if (event.type === 'complete') {
    state.result = event.result;
    state.selectedResultOutputs = { front: false, side: false, body: false };
    for (const asset of state.result.assets || []) {
      state.selectedResultOutputs[asset.output] = true;
    }
    const count = state.result.assets.length;
    state.statusMessage = `Generation complete: ${count} image${count === 1 ? '' : 's'} ready.`;
    updateUI();
    return;
  }

  if (event.type === 'error') {
    throw new Error(event.error || 'Generation failed');
  }
}

function addGeneratedAsset(asset) {
  if (!asset?.output || !asset.filePath) return;
  const assets = state.result?.assets || [];
  const existingIndex = assets.findIndex((item) => item.output === asset.output);
  if (existingIndex >= 0) {
    assets[existingIndex] = asset;
  } else {
    assets.push(asset);
  }
  state.result = { ...(state.result || { metadata: {} }), assets };
  state.selectedResultOutputs[asset.output] = true;
}

async function handleApply() {
  if (!state.result) return;
  const selected = Object.entries(state.applyOutputs)
    .filter(([, checked]) => checked)
    .map(([output]) => output);
  const assets = state.result.assets.filter((asset) => (
    selected.includes(asset.output) && state.selectedResultOutputs[asset.output]
  ));
  if (assets.length === 0) return;

  state.error = '';
  state.statusMessage = 'Applying selected images...';
  updateUI();

  try {
    const response = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assets,
        outputs: state.applyOutputs,
        autoSavePath: state.autoSavePath,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Apply failed');
    }
    state.statusMessage = `Apply complete: ${data.applied.length} final image${data.applied.length === 1 ? '' : 's'} saved.`;
    console.log('Applied images:', data.applied);
  } catch (err) {
    state.error = err.message || 'Apply failed';
    state.statusMessage = '';
  }
  updateUI();
}

async function uploadPhoto(file) {
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataURL(file);
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, data: dataUrl }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Upload failed');
    }
    state.sourcePhotoPath = data.filePath;
    state.error = '';
    state.statusMessage = `Photo loaded: ${file.name}`;
  } catch (err) {
    state.error = err.message || 'Upload failed';
  }
  updateUI();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pickFolder(inputId) {
  if (window.characterNormalizer?.selectFolder) {
    const folder = await window.characterNormalizer.selectFolder();
    if (folder) {
      state.autoSavePath = folder;
      updateUI();
    }
    return;
  }

  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      state.autoSavePath = dirHandle.name;
    } catch {
      return;
    }
  } else {
    const fallback = prompt('Auto Save folder path:', state.autoSavePath);
    if (fallback !== null) state.autoSavePath = fallback;
  }
  updateUI();
  $(inputId).focus();
}

function bindEvents() {
  // Top tabs
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.mode = tab.dataset.mode;
      state.error = '';
      state.statusMessage = '';
      updateUI();
    });
  });

  // Sub-tabs
  document.querySelectorAll('.subtab').forEach((sub) => {
    sub.addEventListener('click', () => {
      state.frontSubtab = sub.dataset.subtab;
      state.error = '';
      state.statusMessage = '';
      updateUI();
    });
  });

  // Prompt
  $('prompt').addEventListener('input', (e) => {
    state.prompt = e.target.value;
    updateButtons();
  });

  // Resolution
  ['resolution', 'resolutionModify'].forEach((id) => {
    $(id).addEventListener('change', (e) => {
      state.resolution = e.target.value;
      updateUI();
    });
  });

  // Auto save
  ['autoSave', 'autoSaveModify', 'autoSaveSide'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      state.autoSavePath = e.target.value;
      updateButtons();
    });
  });

  // Folder pickers
  $('pickFolder').addEventListener('click', () => pickFolder('autoSave'));
  $('pickFolderModify').addEventListener('click', () => pickFolder('autoSaveModify'));
  $('pickFolderSide').addEventListener('click', () => pickFolder('autoSaveSide'));

  // Generate buttons
  $('generateBtn').addEventListener('click', handleGenerate);
  $('generateBtnModify').addEventListener('click', handleGenerate);
  $('generateBtnSide').addEventListener('click', handleGenerate);

  // Apply buttons
  $('applyBtn').addEventListener('click', handleApply);
  $('applyBtnModify').addEventListener('click', handleApply);
  $('applyBtnSide').addEventListener('click', handleApply);

  // Apply checkboxes
  function bindApplyCheckbox(id, output) {
    $(id).addEventListener('change', (e) => {
      state.applyOutputs[output] = e.target.checked;
      updateUI();
    });
  }
  bindApplyCheckbox('applyFront', 'front');
  bindApplyCheckbox('applySide', 'side');
  bindApplyCheckbox('applyBody', 'body');
  bindApplyCheckbox('applyFrontModify', 'front');
  bindApplyCheckbox('applySideModify', 'side');
  bindApplyCheckbox('applyBodyModify', 'body');
  bindApplyCheckbox('applyFrontSide', 'front');
  bindApplyCheckbox('applySideSide', 'side');
  bindApplyCheckbox('applyBodySide', 'body');

  document.querySelectorAll('.result-slot').forEach((slot) => {
    slot.addEventListener('click', () => {
      const output = slot.dataset.output;
      const hasAsset = (state.result?.assets || []).some((asset) => asset.output === output);
      if (!hasAsset) return;
      state.selectedResultOutputs[output] = !state.selectedResultOutputs[output];
      updateUI();
    });
  });

  // Cleanup options
  function bindCleanup(id, key) {
    $(id).addEventListener('change', (e) => {
    state.cleanup[key] = e.target.checked;
      state.statusMessage = '';
      updateButtons();
    });
  }
  bindCleanup('enhanceImage', 'enhanceImage');
  bindCleanup('removeHair', 'removeHair');
  bindCleanup('removeBeard', 'removeBeard');
  bindCleanup('removeEyebrow', 'removeEyebrow');
  bindCleanup('removeEyelash', 'removeEyelash');
  bindCleanup('removeMakeup', 'removeMakeup');

  // Side & Body outputs
  $('outputSide').addEventListener('change', (e) => {
    state.sideBodyOutputs.side = e.target.checked;
    state.statusMessage = '';
    updateUI();
  });
  $('outputBody').addEventListener('change', (e) => {
    state.sideBodyOutputs.body = e.target.checked;
    state.statusMessage = '';
    updateUI();
  });

  // Body options
  document.querySelectorAll('input[name="bodyShape"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.bodyOptions.bodyShape = e.target.value;
    });
  });
  document.querySelectorAll('input[name="gender"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.bodyOptions.gender = e.target.value;
    });
  });
  document.querySelectorAll('input[name="physique"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      state.bodyOptions.physique = e.target.value;
    });
  });

  // Photo browse / input
  function bindPhotoBrowse(browseId, inputId) {
    $(browseId).addEventListener('click', () => $(inputId).click());
    $(inputId).addEventListener('change', (e) => {
      uploadPhoto(e.target.files[0]);
      e.target.value = '';
    });
  }
  bindPhotoBrowse('browsePhoto', 'photoInput');
  bindPhotoBrowse('browsePhotoSide', 'photoInputSide');

  // Photo open
  $('openPhoto').addEventListener('click', () => openPhoto(state.sourcePhotoPath));
  $('openPhotoSide').addEventListener('click', () => openPhoto(state.sourcePhotoPath));

  // Photo delete
  $('deletePhoto').addEventListener('click', () => {
    state.sourcePhotoPath = '';
    state.error = '';
    state.statusMessage = '';
    updateUI();
  });
  $('deletePhotoSide').addEventListener('click', () => {
    state.sourcePhotoPath = '';
    state.error = '';
    state.statusMessage = '';
    updateUI();
  });

  // Close
  $('closeBtn').addEventListener('click', () => {
    window.close();
  });
}

function openPhoto(filePath) {
  if (!filePath) return;
  window.open(`/api/image?path=${encodeURIComponent(filePath)}`, '_blank');
}

bindEvents();
updateUI();
