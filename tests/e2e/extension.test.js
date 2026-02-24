// E2E Tests for Web to Comic Extension
// Note: These tests require the extension to be built and loaded

const { test, expect } = require('@playwright/test');

test.describe('Web to Comic Extension E2E', () => {
  
  test.beforeEach(async ({ page }) => {
    // Mock the extension storage
    await page.route('chrome-extension://**/storage', async (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: {}, history: [] })
      });
    });
  });

  test.describe('Popup Flow', () => {
    
    test('should load popup with default state', async ({ page }) => {
      // This would test the actual popup if we could load it
      // For now, we test the HTML structure
      await page.goto('popup/popup.html');
      
      // Check main elements exist
      await expect(page.locator('.popup-container')).toBeVisible();
      await expect(page.locator('.popup-header')).toBeVisible();
      await expect(page.locator('#generate-btn')).toBeVisible();
    });

    test('should have provider options', async ({ page }) => {
      await page.goto('popup/popup.html');
      
      const providerSelect = page.locator('#provider-preset');
      await expect(providerSelect).toBeVisible();
      await expect(providerSelect).toHaveValue('gemini-free');
    });

    test('should have panel count options', async ({ page }) => {
      await page.goto('popup/popup.html');
      
      const panelSelect = page.locator('#panel-count');
      await expect(panelSelect).toBeVisible();
      
      // Check options
      const options = await panelSelect.locator('option').all();
      expect(options.length).toBeGreaterThan(3);
    });

    test('should have style presets', async ({ page }) => {
      await page.goto('popup/popup.html');
      
      const styleSelect = page.locator('#style-preset');
      await expect(styleSelect).toBeVisible();
      
      const options = await styleSelect.locator('option').all();
      const values = await Promise.all(options.map(o => o.getAttribute('value')));
      
      expect(values).toContain('default');
      expect(values).toContain('noir');
      expect(values).toContain('manga');
    });
  });

  test.describe('Options Page', () => {
    
    test('should load options page', async ({ page }) => {
      await page.goto('options/options.html');
      
      await expect(page.locator('.options-container')).toBeVisible();
      await expect(page.locator('.options-header h1')).toHaveText('Web to Comic Settings');
    });

    test('should have navigation tabs', async ({ page }) => {
      await page.goto('options/options.html');
      
      const navButtons = page.locator('.nav-btn');
      await expect(navButtons).toHaveCount(4);
      
      await expect(navButtons.nth(0)).toHaveText('General');
      await expect(navButtons.nth(1)).toHaveText('Providers');
      await expect(navButtons.nth(2)).toHaveText('Storage');
      await expect(navButtons.nth(3)).toHaveText('About');
    });

    test('should have provider configuration', async ({ page }) => {
      await page.goto('options/options.html');
      
      // Click on Providers tab
      await page.locator('.nav-btn[data-section="providers"]').click();
      
      // Check provider cards exist
      const providerCards = page.locator('.provider-card');
      await expect(providerCards).toHaveCount(4);
    });

    test('should switch between sections', async ({ page }) => {
      await page.goto('options/options.html');
      
      // Initially general is active
      await expect(page.locator('#general-section')).toHaveClass(/active/);
      
      // Click providers
      await page.locator('.nav-btn[data-section="providers"]').click();
      await expect(page.locator('#providers-section')).toHaveClass(/active/);
      await expect(page.locator('#general-section')).not.toHaveClass(/active/);
    });

    test('should have OpenAI provider with model selection', async ({ page }) => {
      await page.goto('options/options.html');
      await page.locator('.nav-btn[data-section="providers"]').click();
      
      const openaiCard = page.locator('.provider-card[data-provider="openai"]');
      await expect(openaiCard).toBeVisible();
      
      // Check model selection dropdowns
      const textModelSelect = openaiCard.locator('#openai-text-model');
      const imageModelSelect = openaiCard.locator('#openai-image-model');
      
      await expect(textModelSelect).toBeVisible();
      await expect(imageModelSelect).toBeVisible();
    });
  });

  test.describe('Side Panel', () => {
    
    test('should load side panel', async ({ page }) => {
      await page.goto('sidepanel/sidepanel.html');
      
      await expect(page.locator('.viewer-container')).toBeVisible();
      await expect(page.locator('.viewer-header h1')).toHaveText('Comic Viewer');
    });

    test('should have empty state', async ({ page }) => {
      await page.goto('sidepanel/sidepanel.html');
      
      await expect(page.locator('#empty-state')).toBeVisible();
      await expect(page.locator('#comic-display')).toHaveClass(/hidden/);
    });

    test('should have view mode toggle', async ({ page }) => {
      await page.goto('sidepanel/sidepanel.html');
      
      const toggleBtns = page.locator('.toggle-btn');
      await expect(toggleBtns).toHaveCount(2);
      await expect(toggleBtns.first()).toHaveText('Strip View');
      await expect(toggleBtns.nth(1)).toHaveText('Panel View');
    });

    test('should have sidebar with settings', async ({ page }) => {
      await page.goto('sidepanel/sidepanel.html');
      
      const sidebar = page.locator('.sidebar');
      await expect(sidebar).toBeVisible();
      
      // Check sidebar sections
      await expect(sidebar.locator('text=Settings')).toBeVisible();
      await expect(sidebar.locator('text=Actions')).toBeVisible();
      await expect(sidebar.locator('text=History')).toBeVisible();
    });
  });
});

test.describe('Manifest Validation', () => {
  
  test('should have valid manifest structure', async ({ page }) => {
    // Read and parse manifest
    const manifest = require('../manifest.json');
    
    // Validate required fields
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Web to Comic');
    expect(manifest.version).toBe('1.0');
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('storage');
    
    // Validate required files exist
    expect(manifest.action.default_popup).toBe('popup/popup.html');
    expect(manifest.background.service_worker).toBe('background/service-worker.js');
  });
});

test.describe('File Structure', () => {
  const fs = require('fs');
  const path = require('path');
  
  const requiredFiles = [
    'manifest.json',
    'popup/popup.html',
    'popup/popup.css',
    'popup/popup.js',
    'sidepanel/sidepanel.html',
    'sidepanel/sidepanel.css',
    'sidepanel/sidepanel.js',
    'options/options.html',
    'options/options.css',
    'options/options.js',
    'background/service-worker.js',
    'content/content-script.js',
    'providers/gemini-provider.js',
    'providers/openai-provider.js',
    'providers/cloudflare-provider.js',
    'shared/types.js'
  ];
  
  requiredFiles.forEach(file => {
    test(`should have ${file}`, () => {
      const filePath = path.join(__dirname, '..', file);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });
});
