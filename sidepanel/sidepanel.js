class ComicViewer {
  constructor() {
    this.currentComic = null;
    this.viewMode = 'strip';
    this.init();
  }

  async init() {
    await this.loadCurrentJob();
    this.bindEvents();
    await this.loadHistory();
  }

  async loadCurrentJob() {
    const { currentJob } = await chrome.storage.local.get('currentJob');
    
    if (currentJob) {
      if (currentJob.status === 'completed') {
        this.displayComic(currentJob.storyboard);
      } else if (currentJob.status === 'generating_text' || currentJob.status === 'generating_images') {
        this.showGenerationView(currentJob);
        this.startPolling();
      }
    }
  }

  bindEvents() {
    document.getElementById('new-comic-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('download-btn')?.addEventListener('click', () => this.downloadComic());
    document.getElementById('open-popup-btn')?.addEventListener('click', () => this.openPopup());
    document.getElementById('cancel-gen-btn')?.addEventListener('click', () => this.cancelGeneration());
    document.getElementById('regenerate-btn')?.addEventListener('click', () => this.regenerate());
    document.getElementById('edit-storyboard-btn')?.addEventListener('click', () => this.editStoryboard());

    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.setViewMode(e.target.dataset.mode));
    });

    document.getElementById('sidebar-panels')?.addEventListener('change', (e) => this.updateSetting('panelCount', e.target.value));
    document.getElementById('sidebar-style')?.addEventListener('change', (e) => this.updateSetting('styleId', e.target.value));
    document.getElementById('sidebar-provider')?.addEventListener('change', (e) => this.updateSetting('provider', e.target.value));
  }

  displayComic(storyboard) {
    this.currentComic = storyboard;
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('generation-view').classList.add('hidden');
    document.getElementById('comic-display').classList.remove('hidden');
    
    document.getElementById('comic-title').textContent = storyboard.source.title || 'Untitled Comic';
    document.getElementById('comic-source').href = storyboard.source.url;
    
    this.renderPanels(storyboard.panels);
    
    document.getElementById('download-btn').disabled = false;
    document.getElementById('regenerate-btn').disabled = false;
    document.getElementById('edit-storyboard-btn').disabled = false;
  }

  renderPanels(panels) {
    const stripContainer = document.getElementById('comic-strip');
    const panelsContainer = document.getElementById('comic-panels');
    
    const panelsHTML = panels.map((panel, index) => `
      <div class="panel">
        <div class="panel-image">
          ${panel.artifacts?.image_blob_ref 
            ? `<img src="${panel.artifacts.image_blob_ref}" alt="Panel ${index + 1}">`
            : `<svg width="64" height="64" fill="var(--text-muted)"><rect x="8" y="8" width="48" height="48" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M24 32h16M32 24v16" stroke="currentColor" stroke-width="2"/></svg>`
          }
        </div>
        <div class="panel-caption">
          <div class="panel-number">Panel ${index + 1}</div>
          <div>${panel.caption}</div>
        </div>
      </div>
    `).join('');
    
    stripContainer.innerHTML = panelsHTML;
    panelsContainer.innerHTML = panelsHTML;
  }

  showGenerationView(job) {
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('comic-display').classList.add('hidden');
    document.getElementById('generation-view').classList.remove('hidden');
    
    this.updateGenerationUI(job);
  }

  updateGenerationUI(job) {
    const statusTitles = {
      pending: 'Preparing...',
      generating_text: 'Generating Storyboard',
      generating_images: 'Creating Comic Panels'
    };
    
    document.getElementById('gen-status-title').textContent = statusTitles[job.status] || 'Processing...';
    
    if (job.storyboard?.panels) {
      const panelsContainer = document.getElementById('gen-panels');
      const panels = job.storyboard.panels;
      
      panelsContainer.innerHTML = panels.map((panel, index) => {
        const isComplete = index < job.currentPanelIndex;
        const isGenerating = index === job.currentPanelIndex;
        
        return `
          <div class="gen-panel">
            <div class="gen-panel-thumb">
              ${panel.artifacts?.image_blob_ref 
                ? `<img src="${panel.artifacts.image_blob_ref}" alt="">`
                : `<svg width="32" height="32" fill="var(--text-muted)"><rect x="4" y="4" width="24" height="24" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
              }
            </div>
            <div class="gen-panel-info">
              <div class="gen-panel-caption">${panel.caption || `Panel ${index + 1}`}</div>
              <div class="gen-panel-status ${isComplete ? 'done' : isGenerating ? 'generating' : ''}">
                ${isComplete ? '✓ Complete' : isGenerating ? '⏳ Generating...' : 'Waiting...'}
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  startPolling() {
    const poll = setInterval(async () => {
      const { currentJob } = await chrome.storage.local.get('currentJob');
      
      if (!currentJob || currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'canceled') {
        clearInterval(poll);
        
        if (currentJob?.status === 'completed') {
          this.displayComic(currentJob.storyboard);
        } else {
          document.getElementById('generation-view').classList.add('hidden');
          document.getElementById('empty-state').classList.remove('hidden');
        }
        return;
      }
      
      this.updateGenerationUI(currentJob);
    }, 1000);
  }

  setViewMode(mode) {
    this.viewMode = mode;
    
    document.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const strip = document.getElementById('comic-strip');
    const panels = document.getElementById('comic-panels');
    
    if (mode === 'strip') {
      strip.classList.remove('hidden');
      panels.classList.add('hidden');
    } else {
      strip.classList.add('hidden');
      panels.classList.remove('hidden');
    }
  }

  openPopup() {
    chrome.action.openPopup();
  }

  async downloadComic() {
    if (!this.currentComic?.panels) return;
    
    const panels = this.currentComic.panels;
    
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      if (panel.artifacts?.image_blob_ref) {
        const link = document.createElement('a');
        link.href = panel.artifacts.image_blob_ref;
        link.download = `comic-panel-${i + 1}.png`;
        link.click();
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  async cancelGeneration() {
    await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
    document.getElementById('generation-view').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  }

  async regenerate() {
    if (!this.currentComic) return;
    // TODO: Implement regenerate with current settings
  }

  editStoryboard() {
    // TODO: Implement storyboard editor
    console.log('Edit storyboard clicked');
  }

  async updateSetting(key, value) {
    const { settings } = await chrome.storage.local.get('settings');
    const updated = { ...settings, [key]: value };
    await chrome.storage.local.set({ settings: updated });
  }

  async loadHistory() {
    const { history } = await chrome.storage.local.get('history');
    const container = document.getElementById('history-list');
    
    if (!history || history.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:var(--text-muted)">No history</p>';
      return;
    }
    
    container.innerHTML = history.slice(0, 5).map(item => `
      <div class="history-item" data-id="${item.id}">
        <div class="history-thumb">
          ${item.thumbnail ? `<img src="${item.thumbnail}" alt="">` : ''}
        </div>
        <div class="history-title">${item.source.title || 'Untitled'}</div>
      </div>
    `).join('');
    
    container.querySelectorAll('.history-item').forEach(el => {
      el.addEventListener('click', async () => {
        const { history } = await chrome.storage.local.get('history');
        const item = history.find(h => h.id === el.dataset.id);
        if (item) {
          this.displayComic(item.storyboard);
        }
      });
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ComicViewer();
});
