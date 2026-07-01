const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('characterNormalizer', {
  owner: 'dev-willbird1936',
  selectFolder: () => ipcRenderer.invoke('character-normalizer:select-folder'),
});
