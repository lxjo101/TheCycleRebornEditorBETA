
class CycleRebornEditor {
    constructor() {
        this.inventory = [];
        this.availableItems = [];
        this.itemConfigs = {};
        this.selectedCategory = 'all';
        this.isConnected = false;
        this.currentFilter = '';
        this.apiBaseUrl = '/api';
        this.autoSaveTimeout = null;
        this.imageCache = new Map(); // Cache for loaded images
        this.imageErrors = new Set(); // Track failed image loads

        // Remote asset URLs for lxjo101/TheCycleRebornSaveEditor-Assets
        this.remoteAssetBase = 'https://raw.githubusercontent.com/lxjo101/TheCycleRebornSaveEditor-Assets/main';                // Alternative CDN: 'https://cdn.jsdelivr.net/gh/lxjo101/TheCycleRebornSaveEditor-Assets@main'

        this.remoteConfigUrl = `${this.remoteAssetBase}/itemConfigs.json`;
        this.remoteItemsUrl = `${this.remoteAssetBase}/itemIds.json`;
        this.remoteIconsUrl = `${this.remoteAssetBase}/icons/`;

        this.init();
        this.bindEvents();
        this.userStats = { totalUsers: 0, activeUsers: 0 };
        this.statsUpdateInterval = null;
    }

    async init() {
        this.updateStatus('Auto-connecting to database...');
        await this.loadItemConfigs();
        await this.loadAvailableItems();

        // Initialize window controls if in Electron
        this.initializeWindowControls();

        // Initialize update checker if in Electron
        if (window.electronAPI) {
            this.initializeUpdateChecker();
        }

        // Auto-connect and load
        this.autoConnectAndLoad();
    }

    initializeWindowControls() {
        if (window.electronAPI && window.electronAPI.windowMinimize) {
            // We're in Electron, add window controls
            const controlsContainer = document.getElementById('title-bar-controls');
            controlsContainer.innerHTML = `
                        <button class="title-bar-button minimize" id="minimize-btn" title="Minimize">
                            <svg viewBox="0 0 12 12" fill="currentColor">
                                <rect width="10" height="1" x="1" y="6"/>
                            </svg>
                        </button>
                        <button class="title-bar-button maximize" id="maximize-btn" title="Maximize">
                            <svg viewBox="0 0 12 12" fill="currentColor">
                                <rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
                            </svg>
                        </button>
                        <button class="title-bar-button close" id="close-btn" title="Close">
                            <svg viewBox="0 0 12 12" fill="currentColor">
                                <path d="M6.279 5.5L11 1l.5.5L6.779 6l4.72 4.5-.5.5L6.28 6.5 1.5 11l-.5-.5L5.721 6 1 1.5l.5-.5L6.279 5.5z"/>
                            </svg>
                        </button>
                    `;

            // Add event listeners
            document.getElementById('minimize-btn').addEventListener('click', () => {
                window.electronAPI.windowMinimize();
            });

            document.getElementById('maximize-btn').addEventListener('click', async () => {
                await window.electronAPI.windowMaximize();
                this.updateMaximizeButton();
            });

            document.getElementById('close-btn').addEventListener('click', () => {
                window.electronAPI.windowClose();
            });

            // Update maximize button icon based on window state
            this.updateMaximizeButton();
        } else {
            // We're in web browser, hide the title bar or show a web version
            const titleBar = document.querySelector('.custom-title-bar');
            titleBar.style.display = 'none';

            // Adjust container padding
            const container = document.querySelector('.container');
            container.style.paddingTop = '0';

            // Adjust sidebar
            const sidebar = document.querySelector('.sidebar');
            sidebar.style.top = '0';
            sidebar.style.height = '100vh';
        }
    }

    async initializeUpdateChecker() {
        try {
            // Show the update section if in Electron
            const updateSection = document.getElementById('update-section');
            if (updateSection) {
                updateSection.style.display = 'block';
            }

            const updateBtn = document.getElementById('check-updates-btn');
            if (updateBtn) {
                updateBtn.addEventListener('click', () => this.checkForUpdates());
            }

            // Display current version
            if (window.electronAPI.getCurrentVersion) {
                const version = await window.electronAPI.getCurrentVersion();
                this.displayVersion(version);
            }

            // Listen for update events
            if (window.electronAPI.onUpdateAvailable) {
                window.electronAPI.onUpdateAvailable((data) => {
                    this.showUpdateAvailable(data);
                });
            }

            if (window.electronAPI.onUpdateError) {
                window.electronAPI.onUpdateError((error) => {
                    console.error('Update error:', error);
                    this.updateStatus(`Update error: ${error.message || error}`);
                });
            }

            console.log('✅ Auto-updater initialized');
        } catch (error) {
            console.log('Update checker not available:', error);
        }
    }

    async checkForUpdates() {
        const updateBtn = document.getElementById('check-updates-btn');
        const originalHTML = updateBtn.innerHTML;

        try {
            // Show loading state
            updateBtn.innerHTML = `
                        <div class="spinner" style="width: 16px; height: 16px; margin-right: 5px;"></div>
                        Checking...
                    `;
            updateBtn.disabled = true;

            if (window.electronAPI && window.electronAPI.checkForUpdates) {
                const result = await window.electronAPI.checkForUpdates();

                if (result.success) {
                    this.updateStatus('Update check completed');
                } else {
                    this.updateStatus(`Update check failed: ${result.message}`);
                }
            } else {
                this.updateStatus('Update checker not available');
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            this.updateStatus('Error checking for updates');
        } finally {
            // Restore button state
            updateBtn.innerHTML = originalHTML;
            updateBtn.disabled = false;
        }
    }

    displayVersion(version) {
        // Create version display element
        const existingVersion = document.querySelector('.version-info');
        if (existingVersion) {
            existingVersion.remove();
        }

        const versionDiv = document.createElement('div');
        versionDiv.className = 'version-info';
        versionDiv.textContent = `v${version}`;
        document.body.appendChild(versionDiv);
    }

    showUpdateAvailable(data) {
        // Add update indicator to the version info
        const versionInfo = document.querySelector('.version-info');
        if (versionInfo && !versionInfo.querySelector('.update-available-indicator')) {
            const indicator = document.createElement('span');
            indicator.className = 'update-available-indicator';
            indicator.textContent = 'Update Available!';
            indicator.style.cursor = 'pointer';
            indicator.addEventListener('click', () => this.checkForUpdates());
            versionInfo.appendChild(indicator);
        }

        // Show update notification
        this.showUpdateNotification(data);
    }

    showUpdateNotification(data) {
        // Remove any existing notifications
        const existingNotification = document.querySelector('.update-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = 'update-notification';
        notification.innerHTML = `
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                                color: white; padding: 15px; border-radius: 8px; margin: 10px; 
                                max-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
                        <h4 style="margin: 0 0 10px 0;">🎉 Update Available!</h4>
                        <p style="margin: 0 0 10px 0; font-size: 14px;">Version ${data.version || 'latest'} is now available.</p>
                        <div style="display: flex; gap: 10px;">
                            <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                                    style="flex: 1; padding: 8px; border: none; border-radius: 4px; 
                                           background: rgba(255,255,255,0.2); color: white; cursor: pointer;">
                                Later
                            </button>
                            <button onclick="editor.checkForUpdates(); this.parentElement.parentElement.parentElement.remove();" 
                                    style="flex: 1; padding: 8px; border: none; border-radius: 4px; 
                                           background: rgba(255,255,255,0.9); color: #333; cursor: pointer; font-weight: bold;">
                                Update Now
                            </button>
                        </div>
                    </div>
                `;

        document.body.appendChild(notification);

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 10000);
    }

    async updateMaximizeButton() {
        if (window.electronAPI && window.electronAPI.windowIsMaximized) {
            const isMaximized = await window.electronAPI.windowIsMaximized();
            const maximizeBtn = document.getElementById('maximize-btn');

            if (isMaximized) {
                maximizeBtn.innerHTML = `
                            <svg viewBox="0 0 12 12" fill="currentColor">
                                <rect width="7" height="7" x="1.5" y="3.5" fill="none" stroke="currentColor" stroke-width="1"/>
                                <rect width="7" height="7" x="3.5" y="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
                            </svg>
                        `;
                maximizeBtn.title = 'Restore';
            } else {
                maximizeBtn.innerHTML = `
                            <svg viewBox="0 0 12 12" fill="currentColor">
                                <rect width="9" height="9" x="1.5" y="1.5" fill="none" stroke="currentColor" stroke-width="1"/>
                            </svg>
                        `;
                maximizeBtn.title = 'Maximize';
            }
        }
    }

    async testStats() {
        console.log('Testing stats manually...');
        await this.pingUserStats();
    }

    async loadItemConfigs() {
        try {
            console.log(`Loading item configs from: ${this.remoteConfigUrl}`);
            const response = await fetch(this.remoteConfigUrl);
            if (response.ok) {
                const data = await response.json();
                this.itemConfigs = data.itemConfigs || {};
                this.rarityColors = data.rarityColors || {};
                console.log(`✅ Loaded ${Object.keys(this.itemConfigs).length} item configurations from remote`);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading remote item configs:', error);
            this.createFallbackConfigs();
        }
    }

    async autoConnectAndLoad() {
        try {
            await this.connectToDatabase();
            await this.loadInventory();

            // Start stats tracking AFTER database connection
            this.startStatsUpdates();

        } catch (error) {
            console.error('Auto-connect failed:', error);
            this.updateStatus('Auto-connect failed - check connection');
        }
    }

    bindEvents() {
        // Window controls are now handled in initializeWindowControls()

        // Category filters
        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.selectedCategory = e.target.dataset.category;
                this.renderInventory();
                this.filterAvailableItems();
            });
        });

        // Action buttons
        document.getElementById('add-item-btn').addEventListener('click', () => this.toggleAvailableItems());
        document.getElementById('clear-inventory').addEventListener('click', () => this.clearInventory());
        document.getElementById('backup-save').addEventListener('click', () => this.exportBackup());
        document.getElementById('restore-save').addEventListener('click', () => this.importBackup());

        // Search
        document.getElementById('search-items').addEventListener('input', (e) => {
            this.currentFilter = e.target.value.toLowerCase();
            this.renderInventory();
            this.filterAvailableItems();
        });

        // Modal
        document.querySelector('.close').addEventListener('click', () => this.closeModal());

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeModal();
            }
        });

        document.getElementById('reload-all').addEventListener('click', () => this.reloadAll());

        // Currency input listeners
        ['aurum-value', 'kmarks-value', 'insurance-value'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    this.saveBalance();
                });
            }
        });

        // Game launcher events
        document.getElementById('launch-game-btn').addEventListener('click', () => this.launchGame());
        document.getElementById('configure-game-btn').addEventListener('click', () => this.configureGamePaths());

        // Check if game is configured on startup
        this.checkGameConfiguration();
    }


    async checkGameConfiguration() {
        if (window.electronAPI && window.electronAPI.checkGameConfigured) {
            try {
                const isConfigured = await window.electronAPI.checkGameConfigured();
                const configureBtn = document.getElementById('configure-game-btn');

                if (!isConfigured && configureBtn) {
                    configureBtn.style.display = 'block';
                }
            } catch (error) {
                console.log('Could not check game configuration:', error);
            }
        }
    }

    async launchGame() {
        if (!window.electronAPI || !window.electronAPI.launchGame) {
            this.updateStatus('Game launcher not available in web version');
            return;
        }

        const launchBtn = document.getElementById('launch-game-btn');
        const launchText = document.getElementById('launch-game-text');

        launchText.textContent = 'Launching...';
        launchBtn.disabled = true;

        try {
            const result = await window.electronAPI.launchGame();

            if (result.success) {
                this.updateStatus(result.message);
                launchText.textContent = 'Game Started!';
                setTimeout(() => {
                    launchText.textContent = 'Launch Game';
                }, 3000);
            } else {
                this.updateStatus(result.message);
                launchText.textContent = 'Launch Failed';
                setTimeout(() => {
                    launchText.textContent = 'Launch Game';
                }, 3000);
            }
        } catch (error) {
            console.error('Error launching game:', error);
            this.updateStatus('Failed to launch game');
            launchText.textContent = 'Launch Game';
        }

        launchBtn.disabled = false;
    }

    async configureGamePaths() {
        if (!window.electronAPI || !window.electronAPI.configureGamePaths) {
            this.updateStatus('Game configuration not available in web version');
            return;
        }

        this.updateStatus('Configuring game paths...');

        try {
            const success = await window.electronAPI.configureGamePaths();

            if (success) {
                this.updateStatus('Game paths configured successfully');
                document.getElementById('configure-game-btn').style.display = 'none';
            } else {
                this.updateStatus('Game path configuration cancelled');
            }
        } catch (error) {
            console.error('Error configuring game paths:', error);
            this.updateStatus('Failed to configure game paths');
        }
    }

    async connectToDatabase() {
        this.updateStatus('Connecting to MongoDB...');
        try {
            const response = await fetch(`${this.apiBaseUrl}/connect`, {
                method: 'POST'
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.isConnected = true;
                this.updateConnectionStatus(true);
                this.updateStatus('Connected successfully');
                console.log('Connection details:', data);
            } else {
                throw new Error(data.message || 'Failed to connect to database');
            }
        } catch (error) {
            console.error('Connection error:', error);
            this.updateStatus(`Connection failed: ${error.message}`);
            this.updateConnectionStatus(false);
            throw error;
        }
    }

    async loadAvailableItems() {
        try {
            console.log(`Loading available items from: ${this.remoteItemsUrl}`);
            const response = await fetch(this.remoteItemsUrl);
            if (response.ok) {
                this.availableItems = await response.json();
                this.updateStatus('Item database loaded from remote');
                console.log(`✅ Loaded ${this.availableItems.length} available items from remote`);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error loading remote available items:', error);
            this.updateStatus('Warning: Could not load itemIds.json - using fallback data');
            this.createFallbackItems();
        }
    }

    createFallbackItems() {
        this.availableItems = [
            { baseItemId: "Consumable_Health_01" },
            { baseItemId: "Shield_01" },
            { baseItemId: "WP_E_AR_Energy_01" }
        ];
    }

    async loadInventory() {
        this.updateStatus('Loading inventory...');
        try {
            const response = await fetch(`${this.apiBaseUrl}/inventory`);
            if (response.ok) {
                const data = await response.json();

                if (Array.isArray(data)) {
                    this.inventory = this.splitStacks(data);
                } else if (data && Array.isArray(data.inventory)) {
                    this.inventory = this.splitStacks(data.inventory);
                } else {
                    console.warn('Unexpected response format:', data);
                    this.inventory = [];
                }

                this.renderInventory();
                this.updateStatus(`Inventory loaded - ${this.inventory.length} items found`);
                console.log('Loaded inventory:', this.inventory);

                this.loadBalance().catch(err => console.warn('Balance loading failed:', err));

            } else {
                const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
                throw new Error(errorData.message || 'Failed to load inventory');
            }
        } catch (error) {
            console.error('Load inventory error:', error);
            this.updateStatus(`Load failed: ${error.message}`);
            this.generateEmptyInventory();
        }
    }

    async saveInventory() {
        if (!this.isConnected) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/inventory`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(this.inventory)
            });

            const data = await response.json();

            if (response.ok && data.success) {
                this.showAutoSaveIndicator();
                console.log('Auto-saved inventory');
            } else {
                console.error('Save failed:', data.message);
            }
        } catch (error) {
            console.error('Save inventory error:', error);
        }
    }

    // Add this function after the loadInventory() function:
    async loadBalance() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/balance`);
            if (response.ok) {
                const balance = await response.json();
                const aurumInput = document.getElementById('aurum-value');
                const kmarksInput = document.getElementById('kmarks-value');
                const insuranceInput = document.getElementById('insurance-value');

                if (aurumInput) aurumInput.value = balance.AU || 0;
                if (kmarksInput) kmarksInput.value = balance.SC || 0;
                if (insuranceInput) insuranceInput.value = balance.IN || 0;
            }
        } catch (error) {
            console.error('Error loading balance:', error);
        }
    }

    // Add this function after loadBalance():
    async saveBalance() {
        try {
            const balance = {
                AU: parseInt(document.getElementById('aurum-value').value) || 0,
                SC: parseInt(document.getElementById('kmarks-value').value) || 0,
                IN: parseInt(document.getElementById('insurance-value').value) || 0
            };

            const response = await fetch(`${this.apiBaseUrl}/balance`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(balance)
            });

            if (response.ok) {
                console.log('Balance saved successfully');
            }
        } catch (error) {
            console.error('Error saving balance:', error);
        }
    }

    async reloadAll() {
        this.updateStatus('Reloading all data...');
        try {
            await this.loadItemConfigs();
            await this.loadAvailableItems();
            await this.loadInventory();
            this.filterAvailableItems();
            this.renderInventory();
            this.updateStatus('All data reloaded successfully');
        } catch (error) {
            console.error('Error reloading data:', error);
            this.updateStatus('Failed to reload data');
        }
    }

    autoSave() {
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = setTimeout(() => {
            this.saveInventory();
        }, 1000);
    }

    showAutoSaveIndicator() {
        const indicator = document.getElementById('auto-save-indicator');
        indicator.classList.add('show');
        setTimeout(() => {
            indicator.classList.remove('show');
        }, 2000);
    }

    generateEmptyInventory() {
        this.inventory = [];
        this.renderInventory();
    }

    renderInventory() {
        const grid = document.getElementById('inventory-grid');
        grid.innerHTML = '';

        if (!Array.isArray(this.inventory)) {
            console.warn('Inventory is not an array:', this.inventory);
            this.inventory = [];
        }

        let filteredInventory = this.inventory.filter(item => {
            if (!item || !item.baseItemId) return false;

            const config = this.getItemConfig(item.baseItemId);
            const matchesCategory = this.selectedCategory === 'all' || config.category === this.selectedCategory;
            const matchesSearch = !this.currentFilter ||
                item.baseItemId.toLowerCase().includes(this.currentFilter) ||
                config.displayName.toLowerCase().includes(this.currentFilter);
            return matchesCategory && matchesSearch;
        });

        filteredInventory.forEach((item, index) => {
            const slot = document.createElement('div');
            slot.className = 'item-slot';

            const config = this.getItemConfig(item.baseItemId);
            const iconPath = this.getItemIcon(item.baseItemId);

            slot.innerHTML = `
                        <div class="item-image rarity-${config.rarity}" style="background-image: url('${iconPath}')"></div>
                        <div class="item-name">${config.displayName}</div>
                        <div class="item-amount">${item.amount || 1}</div>
                    `;

            // Handle image loading errors
            const itemImage = slot.querySelector('.item-image');
            this.handleImageLoad(itemImage, iconPath, item.baseItemId);

            slot.addEventListener('click', () => this.showItemDetail(item, this.inventory.indexOf(item)));
            grid.appendChild(slot);
        });
    }

    toggleAvailableItems() {
        const container = document.getElementById('available-items-container');
        const mainContent = document.getElementById('main-content');
        const isVisible = container.style.display !== 'none';

        container.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            this.filterAvailableItems();
            mainContent.classList.add('hide-scrollbar');
        } else {
            mainContent.classList.remove('hide-scrollbar');
        }
    }

    filterAvailableItems() {
        const container = document.getElementById('available-items');
        container.innerHTML = '';

        // First, deduplicate items by baseItemId
        const uniqueItems = [];
        const seenIds = new Set();

        this.availableItems.forEach(item => {
            if (!seenIds.has(item.baseItemId) && this.itemConfigs[item.baseItemId]) {
                uniqueItems.push(item);
                seenIds.add(item.baseItemId);
            }
        });

        let filteredItems = uniqueItems.filter(item => {
            const config = this.getItemConfig(item.baseItemId);
            const matchesCategory = this.selectedCategory === 'all' || config.category === this.selectedCategory;
            const matchesSearch = !this.currentFilter ||
                config.displayName.toLowerCase().includes(this.currentFilter) ||
                item.baseItemId.toLowerCase().includes(this.currentFilter);
            return matchesCategory && matchesSearch;
        });
        filteredItems.forEach(item => {
            const config = this.getItemConfig(item.baseItemId);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'available-item';

            const iconPath = this.getItemIcon(item.baseItemId);

            itemDiv.innerHTML = `
                        <div class="available-item-icon rarity-${config.rarity}" style="background-image: url('${iconPath}')"></div>
                        <div class="available-item-info">
                            <h4 class="rarity-${config.rarity}">${config.displayName}</h4>
                            <p style="color: ${this.rarityColors[config.rarity] || '#64ffda'}; font-size: 0.7em; text-transform: uppercase; margin-top: 3px;">${config.rarity}</p>
                        </div>
                        <div class="available-item-controls">
                            <input type="number" class="quantity-input" value="1" min="1" max="999">
                            <button class="btn btn-primary">Add</button>
                        </div>
                    `;

            // Handle image loading errors
            const itemIcon = itemDiv.querySelector('.available-item-icon');
            this.handleImageLoad(itemIcon, iconPath, item.baseItemId);

            const addButton = itemDiv.querySelector('.btn');
            const quantityInput = itemDiv.querySelector('.quantity-input');

            addButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const quantity = parseInt(quantityInput.value) || 1;
                this.addItemToInventory(item.baseItemId, quantity);
            });

            container.appendChild(itemDiv);
        });
    }

    handleImageLoad(element, imagePath, itemId) {
        if (this.imageErrors.has(imagePath)) {
            // Already know this image failed, mark as error immediately
            element.classList.add('error');
            element.style.backgroundImage = 'none';
            return;
        }

        if (this.imageCache.has(imagePath)) {
            // Image is cached and working
            return;
        }

        // Create a test image to check if it loads
        const testImg = new Image();
        testImg.onload = () => {
            this.imageCache.set(imagePath, true);
            // Image loaded successfully, no action needed
        };

        testImg.onerror = () => {
            this.imageErrors.add(imagePath);
            element.classList.add('error');
            element.style.backgroundImage = 'none';
            console.warn(`Failed to load image: ${imagePath} for item: ${itemId}`);
        };

        testImg.src = imagePath;
    }

    addItemToInventory(baseItemId, quantity) {
        const amount = parseInt(quantity) || 1;
        const config = this.getItemConfig(baseItemId);
        const maxStack = config.maxStackSize || 50;

        // Try to add to existing stacks first
        let remainingAmount = amount;

        // Find existing stacks that aren't full
        const existingStacks = this.inventory.filter(item =>
            item.baseItemId === baseItemId && item.amount < maxStack
        );

        for (const existingItem of existingStacks) {
            if (remainingAmount <= 0) break;

            const canAdd = maxStack - existingItem.amount;
            const toAdd = Math.min(remainingAmount, canAdd);
            existingItem.amount += toAdd;
            remainingAmount -= toAdd;
        }

        // Create new stacks for remaining amount
        while (remainingAmount > 0) {
            const stackAmount = Math.min(remainingAmount, maxStack);
            this.inventory.push({
                itemId: this.generateUUID(),
                baseItemId: baseItemId,
                primaryVanityId: 0,
                secondaryVanityId: 0,
                amount: stackAmount,
                durability: config.maxDurability,
                modData: { m: [] },
                rolledPerks: [],
                insurance: "",
                insuranceOwnerPlayfabId: "",
                insuredAttachmentId: "",
                origin: { t: "", p: "", g: "" }
            });
            remainingAmount -= stackAmount;
        }

        this.renderInventory();
        this.autoSave();
        this.updateStatus(`Added ${amount}x ${config.displayName} to inventory`);
    }

    showItemDetail(item, index) {
        const modal = document.getElementById('item-detail-modal');
        const detailsDiv = document.getElementById('modal-item-details');

        const config = this.getItemConfig(item.baseItemId);
        const iconPath = this.getItemIcon(item.baseItemId);
        const showDurability = config.maxDurability > 0 && config.category !== 'weapons';

        let durabilitySlider = '';
        if (showDurability) {
            const currentDurability = item.durability === -1 ? config.maxDurability : item.durability;
            durabilitySlider = `
                        <div class="durability-slider-container">
                            <label for="durability-slider">Durability: <span class="durability-value">${currentDurability}</span>/${config.maxDurability}</label>
                            <input type="range" id="durability-slider" class="durability-slider" 
                                   min="1" max="${config.maxDurability}" value="${currentDurability}"
                                   oninput="editor.updateDurabilityDisplay(this.value, ${config.maxDurability})">
                        </div>
                    `;
        }

        detailsDiv.innerHTML = `
                    <div class="item-detail-icon rarity-${config.rarity}" style="background-image: url('${iconPath}')"></div>
                    <h2 style="color: ${this.rarityColors[config.rarity] || '#64ffda'}; margin-bottom: 20px;">${config.displayName}</h2>
                    <p><strong>Base Item ID:</strong> ${item.baseItemId}</p>
                    <p><strong>Rarity:</strong> <span style="color: ${this.rarityColors[config.rarity] || '#64ffda'}">${config.rarity.charAt(0).toUpperCase() + config.rarity.slice(1)}</span></p>
                    <p><strong>Current Amount:</strong> ${item.amount || 1}</p>
                    ${showDurability ? `<p><strong>Durability:</strong> ${item.durability === -1 ? 'Full' : item.durability}</p>` : ''}
                    <div style="margin-top: 20px;">
                        <label for="edit-quantity">Edit Quantity:</label>
                        <input type="number" id="edit-quantity" class="quantity-input" value="${item.amount || 1}" min="0" max="999" style="margin: 0 10px;">
                        <button class="btn btn-success" onclick="editor.updateItemQuantity(${index}, document.getElementById('edit-quantity').value)">Update</button>
                        <button class="btn btn-danger" onclick="editor.removeItem(${index})" style="margin-left: 10px;">Remove</button>
                    </div>
                    ${durabilitySlider}
                `;

        // Handle image loading for the modal icon
        const detailIcon = detailsDiv.querySelector('.item-detail-icon');
        this.handleImageLoad(detailIcon, iconPath, item.baseItemId);

        modal.style.display = 'block';
        this.currentEditingItemIndex = index;
    }

    updateDurabilityDisplay(value, max) {
        const display = document.querySelector('.durability-value');
        if (display) {
            display.textContent = value;
        }

        if (this.currentEditingItemIndex !== undefined && this.inventory[this.currentEditingItemIndex]) {
            this.inventory[this.currentEditingItemIndex].durability = parseInt(value);
            this.autoSave();
        }
    }

    updateItemQuantity(index, newQuantity) {
        const quantity = parseInt(newQuantity);
        if (quantity <= 0) {
            this.removeItem(index);
        } else {
            if (this.inventory[index]) {
                this.inventory[index].amount = quantity;
                this.renderInventory();
                this.closeModal();
                this.autoSave();
                this.updateStatus(`Updated item quantity to ${quantity}`);
            }
        }
    }

    removeItem(index) {
        if (this.inventory[index]) {
            const item = this.inventory[index];
            const config = this.getItemConfig(item.baseItemId);
            const message = `Remove ${item.amount || 1}x ${config.displayName} from inventory?`;

            this.showConfirmModal(message, () => {
                this.inventory.splice(index, 1);
                this.renderInventory();
                this.closeModal();
                this.autoSave();
                this.updateStatus(`Removed ${config.displayName} from inventory`);
            });
        }
    }

    clearInventory() {
        this.showConfirmModal('Are you sure you want to clear the entire inventory?', () => {
            this.inventory = [];
            this.renderInventory();
            this.autoSave();
            this.updateStatus('Inventory cleared');
        });
    }

    exportBackup() {
        const backup = {
            timestamp: new Date().toISOString(),
            inventory: this.inventory
        };

        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `cycle_reborn_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.updateStatus('Backup exported successfully');
    }

    importBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const backup = JSON.parse(e.target.result);
                        if (backup.inventory && Array.isArray(backup.inventory)) {
                            this.inventory = backup.inventory;
                            this.renderInventory();
                            this.autoSave();
                            this.updateStatus('Backup imported successfully');
                        } else {
                            throw new Error('Invalid backup format');
                        }
                    } catch (error) {
                        this.updateStatus('Error: Invalid backup file format');
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    showConfirmModal(message, onConfirm) {
        const modal = document.getElementById('confirm-modal');
        const messageEl = document.getElementById('confirm-message');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');
        const closeBtn = document.getElementById('confirm-close');

        messageEl.textContent = message;
        modal.style.display = 'block';

        // Remove old event listeners
        const newYesBtn = yesBtn.cloneNode(true);
        const newNoBtn = noBtn.cloneNode(true);
        const newCloseBtn = closeBtn.cloneNode(true);

        yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
        noBtn.parentNode.replaceChild(newNoBtn, noBtn);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        // Add new event listeners
        newYesBtn.addEventListener('click', () => {
            modal.style.display = 'none';
            onConfirm();
        });

        newNoBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        newCloseBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    closeModal() {
        document.getElementById('item-detail-modal').style.display = 'none';
        this.currentEditingItemIndex = undefined;
    }

    getItemConfig(baseItemId) {
        if (this.itemConfigs[baseItemId]) {
            return this.itemConfigs[baseItemId];
        }

        // Fallback config
        return {
            displayName: this.cleanDisplayName(baseItemId),
            category: this.guessCategory(baseItemId),
            rarity: 'common',
            maxDurability: this.guessMaxDurability(baseItemId),
            maxStackSize: this.guessMaxStackSize(baseItemId),
            icon: this.getDefaultIcon(baseItemId)
        };
    }

    guessCategory(baseItemId) {
        const id = baseItemId.toLowerCase();
        if (id.includes('wp_')) return 'weapons';
        if (id.includes('consumable')) return 'consumables';
        if (id.includes('shield') || id.includes('helmet') || id.includes('bag') || id.includes('vest')) return 'armor';
        if (id.includes('light') || id.includes('medium') || id.includes('heavy') || id.includes('shotgun') || id.includes('special')) return 'ammo';
        if (id.includes('tool') || id.includes('scanner')) return 'tools';
        if (id.includes('mod_')) return 'attachments';
        return 'materials';
    }

    guessMaxDurability(baseItemId) {
        const id = baseItemId.toLowerCase();
        if (id.includes('wp_')) return 1000;
        if (id.includes('helmet')) return 600;
        if (id.includes('shield')) return 500;
        if (id.includes('vest')) return 400;
        if (id.includes('tool')) return 500;
        return -1;
    }

    cleanDisplayName(name) {
        return name
            .replace(/^(WP_[A-Z]_|TOOL_|Mod_|Consumable_)/g, '')
            .replace(/_+/g, ' ')
            .replace(/\b\w+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .replace(/\s+/g, ' ')
            .trim();
    }

    getItemIcon(baseItemId) {
        const config = this.getItemConfig(baseItemId);

        if (config.icon && config.icon !== this.getDefaultIcon(baseItemId)) {
            // Use remote icons URL
            return `${this.remoteIconsUrl}${config.icon}`;
        }

        return this.createPlaceholderIcon(baseItemId);
    }

    getDefaultIcon(baseItemId) {
        return `${baseItemId.substring(0, 8)}.png`;
    }

    createPlaceholderIcon(baseItemId) {
        return `data:image/svg+xml;base64,${btoa(`
                    <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
                        <rect width="60" height="60" fill="#4a5568"/>
                        <text x="30" y="30" text-anchor="middle" fill="#e0e0e0" font-family="Arial" font-size="6">
                            ${baseItemId.substring(0, 10)}
                        </text>
                        <text x="30" y="42" text-anchor="middle" fill="#a0aec0" font-family="Arial" font-size="5">
                            ${baseItemId.substring(10, 20)}
                        </text>
                    </svg>
                `)}`;
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    updateStatus(message) {
        document.getElementById('status-text').textContent = message;
        console.log(message);
    }

    guessMaxStackSize(baseItemId) {
        const id = baseItemId.toLowerCase();

        // Special cases for unlimited stacking
        if (id.includes('oldcurrency') || id.includes('old_currency')) return 999999;

        if (id.includes('consumable') || id.includes('grenade')) return 5;
        if (id.includes('light') || id.includes('medium') || id.includes('heavy') || id.includes('shotgun') || id.includes('special')) return 250;
        if (id.includes('veltecite') || id.includes('nickel') || id.includes('materials')) return 100;
        if (id.includes('wp_') || id.includes('helmet') || id.includes('shield') || id.includes('bag') || id.includes('vest')) return 1;
        return 20; // Default for other items
    }

    splitStacks(inventory) {
        const newInventory = [];

        inventory.forEach(item => {
            const config = this.getItemConfig(item.baseItemId);
            const maxStack = config.maxStackSize || 50;

            if (item.amount <= maxStack) {
                newInventory.push(item);
            } else {
                // Split into multiple stacks
                let remainingAmount = item.amount;
                while (remainingAmount > 0) {
                    const stackAmount = Math.min(remainingAmount, maxStack);
                    newInventory.push({
                        ...item,
                        itemId: this.generateUUID(),
                        amount: stackAmount
                    });
                    remainingAmount -= stackAmount;
                }
            }
        });

        return newInventory;
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');

        if (connected) {
            indicator.classList.add('connected');
            text.textContent = 'Connected';
        } else {
            indicator.classList.remove('connected');
            text.textContent = 'Disconnected';
        }
    }

    async pingUserStats() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/user/ping`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ version: '1.0.0' })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.stats) {
                    this.userStats = data.stats;
                    this.updateStatsDisplay();
                }
            }
        } catch (error) {
            console.log('Stats update failed (non-critical):', error.message);
        }
    }

    updateStatsDisplay() {
        const statsElement = document.getElementById('user-stats');
        if (statsElement && this.userStats.totalUsers > 0) {
            statsElement.textContent = `${this.userStats.totalUsers} users`;
            statsElement.style.display = 'block';
        }
    }

    startStatsUpdates() {
        // Initial ping
        this.pingUserStats();

        // Update every 5 minutes
        this.statsUpdateInterval = setInterval(() => {
            this.pingUserStats();
        }, 5 * 60 * 1000);
    }

    createFallbackConfigs() {
        this.itemConfigs = {};
        this.rarityColors = {
            common: '#9e9e9e',
            uncommon: '#4caf50',
            rare: '#2196f3',
            epic: '#9c27b0',
            exotic: '#ff4e4e',
            legendary: '#ff9800'
        };
    }
}

// Initialize the editor
const editor = new CycleRebornEditor();

// Listen for update events from the main process (if in Electron)
window.addEventListener('update-available', (event) => {
    const { version, releaseNotes } = event.detail;

    if (editor) {
        editor.showUpdateAvailable({ version, releaseNotes });
    }
});

// Console welcome message
console.log(`
🎮 The Cycle: Reborn Save Editor
🔧 Auto-Updater Enabled
🚀 Version: ${window.electronAPI ? 'Electron App' : 'Web Version'}

Commands:
- Ctrl+U: Check for updates (Electron only)
- F12: Developer tools
- Ctrl+R: Reload page

Repository: https://github.com/lxjo101/TheCycleRebornEditor
        `);