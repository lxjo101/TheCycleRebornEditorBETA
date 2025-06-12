class CycleRebornCommunityEditor {
    constructor() {
        // Existing properties
        this.inventory = [];
        this.availableItems = [];
        this.itemConfigs = {};
        this.selectedCategory = 'all';
        this.isConnected = false;
        this.currentFilter = '';
        this.apiBaseUrl = '/api';
        this.autoSaveTimeout = null;
        this.imageCache = new Map();
        this.imageErrors = new Set();
        this.currentEditingItemIndex = null;
        
        // New community properties
        this.currentUser = null;
        this.isAuthenticated = false;
        this.communityInventories = [];
        this.communityLoadouts = [];
        this.githubToken = null;
        this.currentView = 'inventory';
        this.sessionToken = null;
        this.currentUploadType = null;
        
        // Loadout system
        this.loadouts = {
            1: { name: 'Loadout 1', category: 'stealth', slots: {}, attachments: {} },
            2: { name: 'Loadout 2', category: 'aggressive', slots: {}, attachments: {} },
            3: { name: 'Loadout 3', category: 'support', slots: {}, attachments: {} }
        };
        this.currentLoadout = 1;
        this.currentEditingWeapon = null;
        this.attachmentPresets = {};
        this.currentLoadoutSlot = null;
        this.currentAttachmentType = null;
        
        // Faction levels
        this.factionLevels = {
            ica: 0,
            korolev: 0,
            osiris: 0
        };
        
        // Available tags for community features
        this.availableTags = [
            'pvp-loadout', 'pve-setup', 'beginner-friendly', 'resource-rich', 
            'weapon-focus', 'endgame', 'stealth', 'aggressive', 'support', 
            'exploration', 'sniper', 'close-quarters', 'budget-build', 
            'high-tier', 'experimental', 'meta'
        ];
        
        // Remote asset URLs
        this.remoteAssetBase = 'https://raw.githubusercontent.com/lxjo101/TheCycleRebornSaveEditor-Assets/main';
        this.remoteConfigUrl = `${this.remoteAssetBase}/itemConfigs.json`;
        this.remoteItemsUrl = `${this.remoteAssetBase}/itemIds.json`;
        this.remoteIconsUrl = `${this.remoteAssetBase}/icons/`;

        this.init();
        this.bindEvents();
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
        
        // Load saved user session
        this.loadUserSession();
        
        // Auto-connect and load
        this.autoConnectAndLoad();
    }

    bindEvents() {
        // Navigation events
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.view || e.target.closest('.nav-btn').dataset.view;
                if (view) {
                    this.switchView(view);
                }
            });
        });

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

        // Authentication events
        const loginBtn = document.getElementById('login-btn');
        const logoutBtn = document.getElementById('logout-btn');
        
        if (loginBtn) loginBtn.addEventListener('click', () => this.initializeAuth());
        if (logoutBtn) logoutBtn.addEventListener('click', () => this.logout());
        
        // Community events
        const uploadInventoryBtn = document.getElementById('upload-inventory-btn');
        const uploadLoadoutBtn = document.getElementById('upload-loadout-btn');
        
        if (uploadInventoryBtn) uploadInventoryBtn.addEventListener('click', () => this.showUploadModal('inventory'));
        if (uploadLoadoutBtn) uploadLoadoutBtn.addEventListener('click', () => this.showUploadModal('loadout'));
        
        // Existing events
        this.bindExistingEvents();
    }

    // View switching
    switchView(viewName) {
        // Hide all views
        document.querySelectorAll('.view-container').forEach(view => {
            view.classList.remove('active');
        });
        
        // Remove active class from all nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Show selected view
        const targetView = document.getElementById(`${viewName}-view`);
        if (targetView) {
            targetView.classList.add('active');
        }
        
        // Activate corresponding nav button
        const navBtn = document.querySelector(`[data-view="${viewName}"]`);
        if (navBtn) {
            navBtn.classList.add('active');
        }
        
        // Update view title
        const titles = {
            'inventory': 'Inventory Editor',
            'community-inventories': 'Community Inventories',
            'loadout-editor': 'Loadout Editor',
            'community-loadouts': 'Community Loadouts',
            'faction-editor': 'Faction Editor'
        };
        
        const titleElement = document.getElementById('current-view-title');
        if (titleElement) {
            titleElement.textContent = titles[viewName] || 'Save Editor';
        }
        
        this.currentView = viewName;
        
        // Handle view-specific initialization
        switch (viewName) {
            case 'community-inventories':
                this.initializeCommunityInventories();
                break;
            case 'community-loadouts':
                this.initializeCommunityLoadouts();
                break;
            case 'loadout-editor':
                this.initializeLoadoutEditor();
                break;
            case 'faction-editor':
                this.initializeFactionEditor();
                break;
        }
    }

    // Authentication System
    async initializeAuth() {
        const modal = document.getElementById('auth-modal');
        if (!modal) return;
        
        modal.style.display = 'block';
        
        // Reset modal state
        const methodSelection = document.getElementById('auth-method-selection');
        const simpleForm = document.getElementById('simple-auth-form');
        
        if (methodSelection) methodSelection.style.display = 'block';
        if (simpleForm) simpleForm.style.display = 'none';
        
        // Bind auth events
        this.bindAuthEvents();
    }

    bindAuthEvents() {
        const githubBtn = document.getElementById('github-auth-btn');
        const simpleBtn = document.getElementById('simple-auth-btn');
        const backBtn = document.getElementById('back-to-auth-methods');
        const simpleForm = document.querySelector('#simple-auth-form form');
        
        if (githubBtn) {
            githubBtn.addEventListener('click', () => this.authenticateWithGitHub());
        }
        
        if (simpleBtn) {
            simpleBtn.addEventListener('click', () => this.showSimpleAuth());
        }
        
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                document.getElementById('auth-method-selection').style.display = 'block';
                document.getElementById('simple-auth-form').style.display = 'none';
            });
        }
        
        if (simpleForm) {
            simpleForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.authenticateWithUsername();
            });
        }
    }

    showSimpleAuth() {
        const methodSelection = document.getElementById('auth-method-selection');
        const simpleForm = document.getElementById('simple-auth-form');
        
        if (methodSelection) methodSelection.style.display = 'none';
        if (simpleForm) simpleForm.style.display = 'block';
    }

    async authenticateWithGitHub() {
        try {
            // Mock GitHub authentication for demo
            const mockUser = {
                username: 'demo_user',
                avatar: 'https://github.com/identicons/demo_user.png',
                type: 'github',
                token: 'mock_github_token'
            };
            
            this.setAuthenticatedUser(mockUser);
            this.closeModal('auth-modal');
            this.updateStatus('Authenticated with GitHub successfully');
        } catch (error) {
            console.error('GitHub authentication error:', error);
            this.updateStatus('GitHub authentication failed');
        }
    }

    async authenticateWithUsername() {
        const usernameInput = document.getElementById('username-input');
        if (!usernameInput) return;
        
        const username = usernameInput.value.trim();
        
        if (!username || username.length < 3) {
            this.updateStatus('Username must be at least 3 characters');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/simple`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.sessionToken = data.sessionToken;
                this.setAuthenticatedUser(data.user);
                this.closeModal('auth-modal');
                this.updateStatus(`Logged in as ${username}`);
            } else {
                this.updateStatus(data.message || 'Authentication failed');
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.updateStatus('Authentication failed');
        }
    }

    setAuthenticatedUser(user) {
        this.currentUser = user;
        this.isAuthenticated = true;
        
        // Update UI
        const userProfile = document.getElementById('user-profile');
        const loginBtn = document.getElementById('login-btn');
        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        
        if (userAvatar) {
            if (user.type === 'github' && user.avatar) {
                userAvatar.style.backgroundImage = `url(${user.avatar})`;
                userAvatar.textContent = '';
            } else {
                userAvatar.textContent = user.avatar || user.username.charAt(0).toUpperCase();
                userAvatar.style.backgroundImage = '';
            }
        }
        
        if (userName) userName.textContent = user.username;
        if (userProfile) userProfile.style.display = 'flex';
        if (loginBtn) loginBtn.style.display = 'none';
        
        // Show community content
        this.updateCommunityAccess();
        
        // Save session
        this.saveUserSession();
    }

    logout() {
        this.currentUser = null;
        this.isAuthenticated = false;
        this.sessionToken = null;
        
        // Update UI
        const userProfile = document.getElementById('user-profile');
        const loginBtn = document.getElementById('login-btn');
        
        if (userProfile) userProfile.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'flex';
        
        // Hide community content
        this.updateCommunityAccess();
        
        // Clear session
        localStorage.removeItem('cycleRebornUser');
        localStorage.removeItem('cycleRebornSessionToken');
        
        this.updateStatus('Logged out successfully');
    }

    saveUserSession() {
        if (this.currentUser) {
            localStorage.setItem('cycleRebornUser', JSON.stringify(this.currentUser));
            if (this.sessionToken) {
                localStorage.setItem('cycleRebornSessionToken', this.sessionToken);
            }
        }
    }

    loadUserSession() {
        try {
            const savedUser = localStorage.getItem('cycleRebornUser');
            const savedToken = localStorage.getItem('cycleRebornSessionToken');
            
            if (savedUser && savedToken) {
                const user = JSON.parse(savedUser);
                this.sessionToken = savedToken;
                this.setAuthenticatedUser(user);
            }
        } catch (error) {
            console.error('Error loading user session:', error);
        }
    }

    updateCommunityAccess() {
        const elements = {
            inventoriesAuth: document.getElementById('auth-required-inventories'),
            inventoriesContent: document.getElementById('community-inventories-content'),
            loadoutsAuth: document.getElementById('auth-required-loadouts'),
            loadoutsContent: document.getElementById('community-loadouts-content')
        };
        
        Object.values(elements).forEach(el => {
            if (el) {
                el.style.display = this.isAuthenticated ? 
                    (el.id.includes('auth-required') ? 'none' : 'block') :
                    (el.id.includes('auth-required') ? 'block' : 'none');
            }
        });
    }

    // Community Features
    async initializeCommunityInventories() {
        if (!this.isAuthenticated) return;
        await this.loadCommunityInventories();
    }

    async initializeCommunityLoadouts() {
        if (!this.isAuthenticated) return;
        await this.loadCommunityLoadouts();
    }

    async loadCommunityInventories() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/inventories`);
            const data = await response.json();
            
            if (data.success) {
                this.communityInventories = data.inventories;
                this.renderCommunityInventories();
            }
        } catch (error) {
            console.error('Error loading community inventories:', error);
        }
    }

    async loadCommunityLoadouts() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/loadouts`);
            const data = await response.json();
            
            if (data.success) {
                this.communityLoadouts = data.loadouts;
                this.renderCommunityLoadouts();
            }
        } catch (error) {
            console.error('Error loading community loadouts:', error);
        }
    }

    renderCommunityInventories() {
        const grid = document.getElementById('community-inventories-grid');
        if (!grid) return;
        
        grid.innerHTML = this.communityInventories.length === 0 ? 
            '<div class="loading">No inventories found</div>' : '';
        
        this.communityInventories.forEach(inventory => {
            const item = this.createCommunityItem(inventory, 'inventory');
            grid.appendChild(item);
        });
    }

    renderCommunityLoadouts() {
        const grid = document.getElementById('community-loadouts-grid');
        if (!grid) return;
        
        grid.innerHTML = this.communityLoadouts.length === 0 ? 
            '<div class="loading">No loadouts found</div>' : '';
        
        this.communityLoadouts.forEach(loadout => {
            const item = this.createCommunityItem(loadout, 'loadout');
            grid.appendChild(item);
        });
    }

    createCommunityItem(item, type) {
        const div = document.createElement('div');
        div.className = 'community-item';
        
        const effectivenessDisplay = type === 'loadout' && item.effectivenessScore ? 
            `<div class="community-item-rating">
                <div style="font-size: 0.8em; margin-bottom: 2px;">Effectiveness</div>
                <div style="font-weight: bold; color: #64ffda;">${item.effectivenessScore.toFixed(1)}%</div>
            </div>` : 
            `<div class="community-item-rating">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#ffd700">
                    <path d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.46,13.97L5.82,21L12,17.27Z"/>
                </svg>
                ${item.rating ? item.rating.toFixed(1) : '0.0'}
            </div>`;

        div.innerHTML = `
            <div class="community-item-header">
                <div>
                    <h3>${item.title}</h3>
                    <div class="community-item-meta">
                        By ${item.author} • ${new Date(item.uploadDate).toLocaleDateString()}
                        ${item.category ? `• Category: ${item.category}` : ''}
                    </div>
                </div>
                ${effectivenessDisplay}
            </div>
            
            <div class="community-item-preview">
                ${item.description}
            </div>
            
            ${item.tags ? `<div class="community-item-tags">
                ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
            </div>` : ''}
            
            <div class="community-item-actions">
                <button class="btn btn-primary btn-sm" onclick="editor.downloadCommunity${type.charAt(0).toUpperCase() + type.slice(1)}('${item.id}')">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z"/>
                    </svg>
                    Download (${item.downloads || 0})
                </button>
                <button class="btn btn-success btn-sm" onclick="editor.rateCommunity${type.charAt(0).toUpperCase() + type.slice(1)}('${item.id}', 1)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M23,10C23,8.89 22.1,8 21,8H14.68L15.64,3.43C15.66,3.33 15.67,3.22 15.67,3.11C15.67,2.7 15.5,2.32 15.23,2.05L14.17,1L7.59,7.58C7.22,7.95 7,8.45 7,9V19A2,2 0 0,0 9,21H18C18.83,21 19.54,20.5 19.84,19.78L22.86,12.73C22.95,12.5 23,12.26 23,12V10.08L23,10M1,21H5V9H1V21Z"/>
                    </svg>
                    Like
                </button>
            </div>
        `;
        
        return div;
    }

    // Loadout Editor
    initializeLoadoutEditor() {
        this.renderCurrentLoadout();
        this.bindLoadoutEvents();
    }

    bindLoadoutEvents() {
        // Implementation for loadout events
        console.log('Binding loadout events...');
    }

    renderCurrentLoadout() {
        // Implementation for rendering current loadout
        console.log('Rendering current loadout...');
    }

    // Faction Editor
    initializeFactionEditor() {
        this.loadFactionLevels();
        this.bindFactionEvents();
    }

    bindFactionEvents() {
        ['ica', 'korolev', 'osiris'].forEach(faction => {
            const slider = document.getElementById(`${faction}-slider`);
            const input = document.getElementById(`${faction}-input`);
            const display = document.getElementById(`${faction}-level-display`);
            
            if (slider && input && display) {
                slider.addEventListener('input', (e) => {
                    const value = parseInt(e.target.value);
                    input.value = value;
                    display.textContent = `Level ${value}`;
                    this.factionLevels[faction] = value;
                });
                
                input.addEventListener('change', (e) => {
                    const value = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                    slider.value = value;
                    display.textContent = `Level ${value}`;
                    this.factionLevels[faction] = value;
                });
            }
        });
        
        const saveBtn = document.getElementById('save-factions-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveFactionLevels());
        }
    }

    async loadFactionLevels() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/factions`);
            if (response.ok) {
                const data = await response.json();
                if (data.success) {
                    this.factionLevels = data.factions;
                }
            }
        } catch (error) {
            console.error('Error loading faction levels:', error);
        }
        
        // Update UI
        Object.keys(this.factionLevels).forEach(faction => {
            const level = this.factionLevels[faction];
            const slider = document.getElementById(`${faction}-slider`);
            const input = document.getElementById(`${faction}-input`);
            const display = document.getElementById(`${faction}-level-display`);
            
            if (slider) slider.value = level;
            if (input) input.value = level;
            if (display) display.textContent = `Level ${level}`;
        });
    }

    async saveFactionLevels() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/factions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.factionLevels)
            });
            
            const data = await response.json();
            this.updateStatus(data.success ? 'Faction levels saved successfully' : 'Failed to save faction levels');
        } catch (error) {
            console.error('Error saving faction levels:', error);
            this.updateStatus('Failed to save faction levels');
        }
    }

    // Core functionality
    async autoConnectAndLoad() {
        try {
            await this.connectToDatabase();
            await this.loadInventory();
        } catch (error) {
            console.error('Auto-connect failed:', error);
            this.updateStatus('Auto-connect failed - check connection');
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

    async loadItemConfigs() {
        try {
            const response = await fetch(this.remoteConfigUrl);
            if (response.ok) {
                const data = await response.json();
                this.itemConfigs = data.itemConfigs || {};
                this.rarityColors = data.rarityColors || this.getDefaultRarityColors();
            } else {
                this.createFallbackConfigs();
            }
        } catch (error) {
            console.error('Error loading item configs:', error);
            this.createFallbackConfigs();
        }
    }

    async loadAvailableItems() {
        try {
            const response = await fetch(this.remoteItemsUrl);
            if (response.ok) {
                this.availableItems = await response.json();
            } else {
                this.createFallbackItems();
            }
        } catch (error) {
            console.error('Error loading available items:', error);
            this.createFallbackItems();
        }
    }

    async loadInventory() {
        this.updateStatus('Loading inventory...');
        try {
            const response = await fetch(`${this.apiBaseUrl}/inventory`);
            if (response.ok) {
                const data = await response.json();
                this.inventory = Array.isArray(data) ? data : [];
                this.renderInventory();
                this.updateStatus(`Inventory loaded - ${this.inventory.length} items found`);
                
                // Load balance
                this.loadBalance().catch(err => console.warn('Balance loading failed:', err));
            }
        } catch (error) {
            console.error('Load inventory error:', error);
            this.updateStatus(`Load failed: ${error.message}`);
            this.inventory = [];
            this.renderInventory();
        }
    }

    renderInventory() {
        const grid = document.getElementById('inventory-grid');
        if (!grid) return;
        
        grid.innerHTML = '';

        const filteredInventory = this.inventory.filter(item => {
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
            
            slot.addEventListener('click', () => this.showItemDetail(item, this.inventory.indexOf(item)));
            grid.appendChild(slot);
        });
    }

    // Utility methods
    getItemConfig(baseItemId) {
        return this.itemConfigs[baseItemId] || {
            displayName: this.cleanDisplayName(baseItemId),
            category: this.guessCategory(baseItemId),
            rarity: 'common',
            maxDurability: -1,
            maxStackSize: 20,
            icon: `${baseItemId.substring(0, 8)}.png`
        };
    }

    getItemIcon(baseItemId) {
        const config = this.getItemConfig(baseItemId);
        return config.icon ? `${this.remoteIconsUrl}${config.icon}` : this.createPlaceholderIcon(baseItemId);
    }

    cleanDisplayName(name) {
        return name
            .replace(/^(WP_[A-Z]_|TOOL_|Mod_|Consumable_)/g, '')
            .replace(/_+/g, ' ')
            .replace(/\b\w+/g, word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .trim();
    }

    guessCategory(baseItemId) {
        const id = baseItemId.toLowerCase();
        if (id.includes('wp_')) return 'weapons';
        if (id.includes('consumable')) return 'consumables';
        if (id.includes('shield') || id.includes('helmet')) return 'armor';
        if (id.includes('tool')) return 'tools';
        return 'materials';
    }

    createPlaceholderIcon(baseItemId) {
        return `data:image/svg+xml;base64,${btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
                <rect width="60" height="60" fill="#4a5568"/>
                <text x="30" y="30" text-anchor="middle" fill="#e0e0e0" font-family="Arial" font-size="6">
                    ${baseItemId.substring(0, 10)}
                </text>
            </svg>
        `)}`;
    }

    getDefaultRarityColors() {
        return {
            common: '#9e9e9e',
            uncommon: '#4caf50',
            rare: '#2196f3',
            epic: '#9c27b0',
            exotic: '#ff4e4e',
            legendary: '#ff9800'
        };
    }

    createFallbackConfigs() {
        this.itemConfigs = {};
        this.rarityColors = this.getDefaultRarityColors();
    }

    createFallbackItems() {
        this.availableItems = [
            { baseItemId: "Consumable_Health_01" },
            { baseItemId: "Shield_01" },
            { baseItemId: "WP_E_AR_Energy_01" }
        ];
    }

    updateStatus(message) {
        const statusElement = document.getElementById('status-text');
        if (statusElement) {
            statusElement.textContent = message;
        }
        console.log(message);
    }

    updateConnectionStatus(connected) {
        const indicator = document.getElementById('connection-indicator');
        const text = document.getElementById('connection-text');
        
        if (indicator) {
            indicator.classList.toggle('connected', connected);
        }
        if (text) {
            text.textContent = connected ? 'Connected' : 'Disconnected';
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
        }
    }

    async loadBalance() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/balance`);
            if (response.ok) {
                const balance = await response.json();
                const elements = {
                    aurum: document.getElementById('aurum-value'),
                    kmarks: document.getElementById('kmarks-value'),
                    insurance: document.getElementById('insurance-value')
                };
                
                if (elements.aurum) elements.aurum.value = balance.AU || 0;
                if (elements.kmarks) elements.kmarks.value = balance.SC || 0;
                if (elements.insurance) elements.insurance.value = balance.IN || 0;
            }
        } catch (error) {
            console.error('Error loading balance:', error);
        }
    }

    async saveBalance() {
        try {
            const balance = {
                AU: parseInt(document.getElementById('aurum-value')?.value) || 0,
                SC: parseInt(document.getElementById('kmarks-value')?.value) || 0,
                IN: parseInt(document.getElementById('insurance-value')?.value) || 0
            };
            
            await fetch(`${this.apiBaseUrl}/balance`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(balance)
            });
        } catch (error) {
            console.error('Error saving balance:', error);
        }
    }

    async saveInventory() {
        if (!this.isConnected) return;
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/inventory`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.inventory)
            });
            
            const data = await response.json();
            if (response.ok && data.success) {
                console.log('Auto-saved inventory');
            }
        } catch (error) {
            console.error('Save inventory error:', error);
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

    // Item detail modal
    showItemDetail(item, index) {
        const modal = document.getElementById('item-detail-modal');
        const detailsDiv = document.getElementById('modal-item-details');
        
        if (!modal || !detailsDiv) return;
        
        const config = this.getItemConfig(item.baseItemId);
        const iconPath = this.getItemIcon(item.baseItemId);
        const isWeapon = config.category === 'weapons' || item.baseItemId.includes('WP_');
        
        detailsDiv.innerHTML = `
            <div class="item-detail-icon rarity-${config.rarity}" style="background-image: url('${iconPath}'); width: 80px; height: 80px; background-size: contain; background-repeat: no-repeat; background-position: center; margin: 0 auto 20px; border-radius: 8px;"></div>
            <h2 style="color: ${this.rarityColors[config.rarity] || '#64ffda'}; margin-bottom: 20px; text-align: center;">${config.displayName}</h2>
            <p><strong>Base Item ID:</strong> ${item.baseItemId}</p>
            <p><strong>Rarity:</strong> <span style="color: ${this.rarityColors[config.rarity] || '#64ffda'}">${config.rarity.charAt(0).toUpperCase() + config.rarity.slice(1)}</span></p>
            <p><strong>Current Amount:</strong> ${item.amount || 1}</p>
            <div style="margin-top: 20px;">
                <label for="edit-quantity">Edit Quantity:</label>
                <input type="number" id="edit-quantity" class="quantity-input" value="${item.amount || 1}" min="0" max="999" style="margin: 0 10px; padding: 5px; background: rgba(45, 55, 75, 0.8); border: 1px solid #4a5568; color: #e0e0e0; border-radius: 4px;">
                <button class="btn btn-success" onclick="editor.updateItemQuantity(${index}, document.getElementById('edit-quantity').value)">Update</button>
                <button class="btn btn-danger" onclick="editor.removeItem(${index})" style="margin-left: 10px;">Remove</button>
            </div>
        `;
        
        modal.style.display = 'block';
        this.currentEditingItemIndex = index;
        
        // Show weapon attachment editor for weapons
        const attachmentEditor = document.getElementById('attachment-editor');
        if (isWeapon && attachmentEditor) {
            this.showWeaponAttachmentEditor(item, index);
        } else if (attachmentEditor) {
            attachmentEditor.style.display = 'none';
        }
    }

    updateItemQuantity(index, newQuantity) {
        const quantity = parseInt(newQuantity) || 0;
        
        if (quantity <= 0) {
            this.removeItem(index);
            return;
        }
        
        if (this.inventory[index]) {
            this.inventory[index].amount = quantity;
            this.renderInventory();
            this.autoSave();
            this.updateStatus(`Updated item quantity to ${quantity}`);
        }
        
        this.closeModal('item-detail-modal');
    }

    removeItem(index) {
        if (this.inventory[index]) {
            const item = this.inventory[index];
            const config = this.getItemConfig(item.baseItemId);
            this.inventory.splice(index, 1);
            this.renderInventory();
            this.autoSave();
            this.updateStatus(`Removed ${config.displayName} from inventory`);
        }
        
        this.closeModal('item-detail-modal');
    }

    // Available items system
    toggleAvailableItems() {
        const container = document.getElementById('available-items-container');
        const mainContent = document.getElementById('main-content');
        
        if (!container) return;
        
        const isVisible = container.style.display !== 'none';
        container.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            this.filterAvailableItems();
            if (mainContent) mainContent.classList.add('hide-scrollbar');
        } else {
            if (mainContent) mainContent.classList.remove('hide-scrollbar');
        }
    }

    filterAvailableItems() {
        const container = document.getElementById('available-items');
        if (!container) return;
        
        container.innerHTML = '';
        
        // Remove duplicates
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
            itemDiv.className = 'community-item';
            
            const iconPath = this.getItemIcon(item.baseItemId);
            
            itemDiv.innerHTML = `
                <div class="available-item-icon rarity-${config.rarity}" style="background-image: url('${iconPath}'); width: 60px; height: 60px; background-size: contain; background-repeat: no-repeat; background-position: center; border-radius: 6px; margin-right: 15px;"></div>
                <div class="available-item-info" style="flex: 1;">
                    <h4 class="rarity-${config.rarity}">${config.displayName}</h4>
                    <p style="color: ${this.rarityColors[config.rarity] || '#64ffda'}; font-size: 0.7em; text-transform: uppercase; margin-top: 3px;">${config.rarity}</p>
                </div>
                <div class="available-item-controls" style="display: flex; align-items: center; gap: 10px;">
                    <input type="number" class="quantity-input" value="1" min="1" max="999" style="width: 60px; padding: 5px; background: rgba(45, 55, 75, 0.8); border: 1px solid #4a5568; color: #e0e0e0; border-radius: 4px;">
                    <button class="btn btn-primary">Add</button>
                </div>
            `;
            
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

    addItemToInventory(baseItemId, quantity) {
        const amount = parseInt(quantity) || 1;
        const config = this.getItemConfig(baseItemId);
        
        // Generate new item
        const newItem = {
            itemId: this.generateUUID(),
            baseItemId: baseItemId,
            primaryVanityId: 0,
            secondaryVanityId: 0,
            amount: amount,
            durability: config.maxDurability || -1,
            modData: { m: [] },
            rolledPerks: [],
            insurance: "",
            insuranceOwnerPlayfabId: "",
            insuredAttachmentId: "",
            origin: { t: "", p: "", g: "" }
        };
        
        this.inventory.push(newItem);
        this.renderInventory();
        this.autoSave();
        this.updateStatus(`Added ${amount}x ${config.displayName} to inventory`);
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Weapon attachment system
    showWeaponAttachmentEditor(weaponItem, itemIndex) {
        this.currentEditingWeapon = { item: weaponItem, index: itemIndex };
        
        const editor = document.getElementById('attachment-editor');
        if (!editor) return;
        
        const config = this.getItemConfig(weaponItem.baseItemId);
        
        // Check if it's a marksman weapon to hide muzzle slot
        const isMarksman = config.category === 'marksman' || weaponItem.baseItemId.includes('Marksman');
        const muzzleSlot = document.getElementById('muzzle-slot');
        if (muzzleSlot) {
            muzzleSlot.style.display = isMarksman ? 'none' : 'block';
        }
        
        // Load current attachments
        this.loadWeaponAttachments(weaponItem);
        
        editor.style.display = 'block';
        this.bindAttachmentEvents();
    }

    loadWeaponAttachments(weaponItem) {
        // Clear all slots first
        document.querySelectorAll('.attachment-slot').forEach(slot => {
            slot.classList.add('empty');
            const icon = slot.querySelector('.attachment-slot-icon');
            const name = slot.querySelector('.attachment-slot-name');
            if (icon) icon.style.backgroundImage = '';
            if (name) name.textContent = 'Empty';
        });
        
        // Parse weapon's modData to show current attachments
        const modData = weaponItem.modData || { m: [] };
        
        modData.m.forEach(attachment => {
            const attachmentConfig = this.getItemConfig(attachment.baseItemId);
            const slot = document.querySelector(`[data-attachment-type="${attachmentConfig.attachment_type}"]`);
            
            if (slot) {
                const iconPath = this.getItemIcon(attachment.baseItemId);
                slot.classList.remove('empty');
                const icon = slot.querySelector('.attachment-slot-icon');
                const name = slot.querySelector('.attachment-slot-name');
                if (icon) icon.style.backgroundImage = `url('${iconPath}')`;
                if (name) name.textContent = attachmentConfig.displayName;
            }
        });
    }

    bindAttachmentEvents() {
        // Attachment slot clicks
        document.querySelectorAll('.attachment-slot').forEach(slot => {
            const newSlot = slot.cloneNode(true);
            slot.parentNode.replaceChild(newSlot, slot);
            
            newSlot.addEventListener('click', (e) => {
                const attachmentType = e.currentTarget.dataset.attachmentType;
                if (attachmentType) {
                    this.openAttachmentSelection(attachmentType);
                }
            });
        });
        
        // Preset management
        const loadBtn = document.getElementById('load-preset-btn');
        const saveBtn = document.getElementById('save-preset-btn');
        
        if (loadBtn) {
            loadBtn.onclick = () => this.loadAttachmentPreset();
        }
        if (saveBtn) {
            saveBtn.onclick = () => this.saveAttachmentPreset();
        }
    }

    openAttachmentSelection(attachmentType) {
        this.currentAttachmentType = attachmentType;
        
        // Mock compatible attachments
        const mockAttachments = [
            {
                baseItemId: `Mod_${attachmentType}_Common_01`,
                displayName: `${attachmentType.replace('-', ' ')} Mk1`,
                rarity: 'common',
                attachment_type: attachmentType
            },
            {
                baseItemId: `Mod_${attachmentType}_Rare_01`,
                displayName: `${attachmentType.replace('-', ' ')} Pro`,
                rarity: 'rare',
                attachment_type: attachmentType
            }
        ];
        
        this.renderAttachmentSelection(mockAttachments);
        
        const modal = document.getElementById('attachment-selection-modal');
        if (modal) modal.style.display = 'block';
    }

    renderAttachmentSelection(attachments) {
        const grid = document.getElementById('attachment-selection-grid');
        const title = document.getElementById('attachment-selection-title');
        
        if (!grid || !title) return;
        
        title.textContent = `Select ${this.currentAttachmentType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
        
        grid.innerHTML = '';
        
        attachments.forEach(attachment => {
            const config = this.getItemConfig(attachment.baseItemId);
            const iconPath = this.getItemIcon(attachment.baseItemId);
            
            const item = document.createElement('div');
            item.className = 'community-item';
            item.innerHTML = `
                <div class="available-item-icon rarity-${config.rarity}" style="background-image: url('${iconPath}'); width: 60px; height: 60px; background-size: contain; background-repeat: no-repeat; background-position: center; margin-right: 15px;"></div>
                <div class="available-item-info" style="flex: 1;">
                    <h4 class="rarity-${config.rarity}">${config.displayName}</h4>
                    <p style="color: ${this.rarityColors[config.rarity] || '#64ffda'}; font-size: 0.7em; text-transform: uppercase;">${config.rarity}</p>
                </div>
                <div class="available-item-controls">
                    <button class="btn btn-primary" onclick="editor.attachToWeapon('${attachment.baseItemId}')">Attach</button>
                </div>
            `;
            
            grid.appendChild(item);
        });
    }

    attachToWeapon(attachmentId) {
        if (!this.currentEditingWeapon || !this.currentAttachmentType) return;
        
        const weapon = this.currentEditingWeapon.item;
        
        // Initialize modData if it doesn't exist
        if (!weapon.modData) {
            weapon.modData = { m: [] };
        }
        
        // Remove existing attachment of same type
        weapon.modData.m = weapon.modData.m.filter(att => {
            const config = this.getItemConfig(att.baseItemId);
            return config.attachment_type !== this.currentAttachmentType;
        });
        
        // Add new attachment
        weapon.modData.m.push({
            baseItemId: attachmentId,
            amount: 1
        });
        
        // Update weapon in inventory
        this.inventory[this.currentEditingWeapon.index] = weapon;
        
        // Refresh displays
        this.loadWeaponAttachments(weapon);
        this.closeModal('attachment-selection-modal');
        this.autoSave();
        
        const config = this.getItemConfig(attachmentId);
        this.updateStatus(`Attached ${config.displayName} to weapon`);
    }

    loadAttachmentPreset() {
        const presetSelect = document.getElementById('attachment-preset-select');
        if (!presetSelect) return;
        
        const presetName = presetSelect.value;
        if (!presetName || !this.currentEditingWeapon) return;
        
        // Mock preset loading
        const mockPresets = {
            'cqb': ['Mod_optics_Holo_01', 'Mod_magazine_Fast_01', 'Mod_muzzle_Flash_01'],
            'ranged': ['Mod_optics_4x_01', 'Mod_magazine_Extended_01', 'Mod_muzzle_Compensator_01'],
            'stealth': ['Mod_optics_Reflex_01', 'Mod_magazine_Quiet_01', 'Mod_muzzle_Suppressor_01']
        };
        
        const preset = mockPresets[presetName];
        if (preset) {
            preset.forEach(attachmentId => {
                // Mock attachment type detection
                let attachmentType = 'optics';
                if (attachmentId.includes('magazine')) attachmentType = 'magazine';
                else if (attachmentId.includes('muzzle')) attachmentType = 'muzzle';
                
                this.currentAttachmentType = attachmentType;
                this.attachToWeapon(attachmentId);
            });
            this.updateStatus(`Loaded ${presetName} preset`);
        }
    }

    saveAttachmentPreset() {
        if (!this.currentEditingWeapon || !this.isAuthenticated) return;
        
        const presetName = prompt('Enter preset name:');
        if (!presetName) return;
        
        const weapon = this.currentEditingWeapon.item;
        const attachments = {};
        
        (weapon.modData?.m || []).forEach(att => {
            const config = this.getItemConfig(att.baseItemId);
            attachments[config.attachment_type] = att.baseItemId;
        });
        
        // Mock save to server
        this.updateStatus(`Saved preset: ${presetName}`);
    }

    // Community upload system
    showUploadModal(type) {
        if (!this.isAuthenticated) {
            this.updateStatus('Please login to upload to community');
            return;
        }
        
        const modal = document.getElementById('community-upload-modal');
        const title = document.getElementById('upload-modal-title');
        
        if (!modal || !title) return;
        
        title.textContent = type === 'inventory' ? 'Upload Inventory' : 'Upload Loadout';
        this.currentUploadType = type;
        
        // Reset form
        const form = document.getElementById('community-upload-form');
        if (form) form.reset();
        this.clearSelectedTags();
        
        modal.style.display = 'block';
        this.bindUploadEvents();
    }

    bindUploadEvents() {
        // Form submission
        const form = document.getElementById('community-upload-form');
        const cancelBtn = document.getElementById('cancel-upload-btn');
        
        if (form) {
            form.onsubmit = (e) => {
                e.preventDefault();
                this.submitCommunityUpload();
            };
        }
        
        if (cancelBtn) {
            cancelBtn.onclick = () => this.closeModal('community-upload-modal');
        }
    }

    clearSelectedTags() {
        const tags = document.querySelectorAll('.selected-tag');
        tags.forEach(tag => tag.remove());
    }

    async submitCommunityUpload() {
        try {
            const titleInput = document.getElementById('upload-title');
            const descInput = document.getElementById('upload-description');
            const categorySelect = document.getElementById('upload-category');
            
            if (!titleInput || !descInput || !categorySelect) return;
            
            const title = titleInput.value.trim();
            const description = descInput.value.trim();
            const category = categorySelect.value;
            
            if (!title) {
                this.updateStatus('Please enter a title');
                return;
            }
            
            const uploadData = {
                title,
                description,
                category,
                tags: [],
                [this.currentUploadType]: this.currentUploadType === 'inventory' ? this.inventory : this.loadouts[this.currentLoadout]
            };
            
            this.updateStatus('Uploading to community...');
            
            const response = await fetch(`${this.apiBaseUrl}/community/${this.currentUploadType === 'inventory' ? 'inventories' : 'loadouts'}`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionToken}`
                },
                body: JSON.stringify(uploadData)
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStatus(`${this.currentUploadType} uploaded successfully!`);
                this.closeModal('community-upload-modal');
                
                // Refresh community data
                if (this.currentUploadType === 'inventory') {
                    this.loadCommunityInventories();
                } else {
                    this.loadCommunityLoadouts();
                }
            } else {
                this.updateStatus(data.message || 'Failed to upload to community');
            }
            
        } catch (error) {
            console.error('Error uploading to community:', error);
            this.updateStatus('Failed to upload to community');
        }
    }

    // Download methods for community items
    async downloadCommunityInventory(inventoryId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/inventories/${inventoryId}/download`, {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Add items to current inventory
                data.inventory.forEach(item => {
                    this.inventory.push({
                        ...item,
                        itemId: this.generateUUID()
                    });
                });
                
                this.renderInventory();
                this.autoSave();
                this.updateStatus(`Downloaded inventory - added ${data.inventory.length} items`);
                
                // Refresh community data
                this.loadCommunityInventories();
            } else {
                this.updateStatus(data.message || 'Failed to download inventory');
            }
        } catch (error) {
            console.error('Error downloading community inventory:', error);
            this.updateStatus('Failed to download inventory');
        }
    }

    async downloadCommunityLoadout(loadoutId) {
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/loadouts/${loadoutId}/download`, {
                method: 'POST'
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Add loadout items to inventory
                const loadoutData = data.loadout;
                const itemsAdded = [];
                
                Object.values(loadoutData.slots || {}).forEach(slot => {
                    if (slot && slot.baseItemId) {
                        const item = {
                            itemId: this.generateUUID(),
                            baseItemId: slot.baseItemId,
                            amount: slot.amount || 1,
                            durability: -1,
                            modData: { m: [] }
                        };
                        this.inventory.push(item);
                        itemsAdded.push(item);
                    }
                });
                
                this.renderInventory();
                this.autoSave();
                this.updateStatus(`Downloaded loadout - added ${itemsAdded.length} items to inventory`);
                
                // Refresh community data
                this.loadCommunityLoadouts();
            } else {
                this.updateStatus(data.message || 'Failed to download loadout');
            }
        } catch (error) {
            console.error('Error downloading community loadout:', error);
            this.updateStatus('Failed to download loadout');
        }
    }

    async rateCommunityInventory(inventoryId, rating) {
        if (!this.isAuthenticated) {
            this.updateStatus('Please login to rate inventories');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/inventories/${inventoryId}/rate`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionToken}`
                },
                body: JSON.stringify({ rating })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStatus('Rating submitted successfully');
                this.loadCommunityInventories();
            } else {
                this.updateStatus(data.message || 'Failed to submit rating');
            }
        } catch (error) {
            console.error('Error rating inventory:', error);
            this.updateStatus('Failed to submit rating');
        }
    }

    async rateCommunityLoadout(loadoutId, rating) {
        if (!this.isAuthenticated) {
            this.updateStatus('Please login to rate loadouts');
            return;
        }
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/community/loadouts/${loadoutId}/rate`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.sessionToken}`
                },
                body: JSON.stringify({ rating })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.updateStatus('Rating submitted successfully');
                this.loadCommunityLoadouts();
            } else {
                this.updateStatus(data.message || 'Failed to submit rating');
            }
        } catch (error) {
            console.error('Error rating loadout:', error);
            this.updateStatus('Failed to submit rating');
        }
    }

    // Initialize window controls and existing events
    initializeWindowControls() {
        if (window.electronAPI && window.electronAPI.windowMinimize) {
            const controlsContainer = document.getElementById('title-bar-controls');
            if (controlsContainer) {
                controlsContainer.innerHTML = `
                    <button class="title-bar-button minimize" onclick="window.electronAPI.windowMinimize()">−</button>
                    <button class="title-bar-button maximize" onclick="window.electronAPI.windowMaximize()">□</button>
                    <button class="title-bar-button close" onclick="window.electronAPI.windowClose()">×</button>
                `;
            }
        } else {
            const titleBar = document.querySelector('.custom-title-bar');
            const container = document.querySelector('.container');
            const sidebar = document.querySelector('.sidebar');
            
            if (titleBar) titleBar.style.display = 'none';
            if (container) container.style.paddingTop = '0';
            if (sidebar) {
                sidebar.style.top = '0';
                sidebar.style.height = '100vh';
            }
        }
    }

    initializeUpdateChecker() {
        if (window.electronAPI) {
            const updateSection = document.getElementById('update-section');
            const checkBtn = document.getElementById('check-updates-btn');
            
            if (updateSection) updateSection.style.display = 'block';
            if (checkBtn) {
                checkBtn.addEventListener('click', () => {
                    window.electronAPI.checkForUpdates();
                });
            }
        }
    }

    bindExistingEvents() {
        // Core functionality
        const elements = {
            addItemBtn: document.getElementById('add-item-btn'),
            clearInventory: document.getElementById('clear-inventory'),
            backupSave: document.getElementById('backup-save'),
            restoreSave: document.getElementById('restore-save'),
            searchItems: document.getElementById('search-items'),
            launchGameBtn: document.getElementById('launch-game-btn'),
            configureGameBtn: document.getElementById('configure-game-btn')
        };
        
        if (elements.addItemBtn) {
            elements.addItemBtn.addEventListener('click', () => this.toggleAvailableItems());
        }
        
        if (elements.clearInventory) {
            elements.clearInventory.addEventListener('click', () => this.clearInventory());
        }
        
        if (elements.searchItems) {
            elements.searchItems.addEventListener('input', (e) => {
                this.currentFilter = e.target.value.toLowerCase();
                this.renderInventory();
                this.filterAvailableItems();
            });
        }
        
        // Currency input listeners
        ['aurum-value', 'kmarks-value', 'insurance-value'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => this.saveBalance());
            }
        });
        
        // Modal close events
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modal = e.target.closest('.modal');
                if (modal) {
                    modal.style.display = 'none';
                }
            });
        });

        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                e.target.style.display = 'none';
            }
        });
        
        // Game launcher events (placeholders)
        if (elements.launchGameBtn) {
            elements.launchGameBtn.addEventListener('click', () => this.launchGame());
        }
        
        if (elements.configureGameBtn) {
            elements.configureGameBtn.addEventListener('click', () => this.configureGamePaths());
        }
        
        // Check if game is configured on startup
        this.checkGameConfiguration();
    }

    // Placeholder methods for game launcher functionality
    async checkGameConfiguration() {
        // Placeholder for game configuration check
        console.log('Checking game configuration...');
    }

    async launchGame() {
        try {
            if (window.electronAPI && window.electronAPI.launchGame) {
                this.updateStatus('Launching game...');
                const result = await window.electronAPI.launchGame();
                
                if (result.success) {
                    this.updateStatus('Game launched successfully!');
                } else {
                    this.updateStatus(`Failed to launch game: ${result.message}`);
                }
            } else {
                this.updateStatus('Game launcher not available in web mode');
            }
        } catch (error) {
            console.error('Error launching game:', error);
            this.updateStatus('Failed to launch game');
        }
    }

    async configureGamePaths() {
        try {
            if (window.electronAPI && window.electronAPI.configureGamePaths) {
                const result = await window.electronAPI.configureGamePaths();
                if (result) {
                    this.updateStatus('Game paths configured successfully');
                } else {
                    this.updateStatus('Game path configuration cancelled');
                }
            } else {
                this.updateStatus('Game configuration not available in web mode');
            }
        } catch (error) {
            console.error('Error configuring game paths:', error);
            this.updateStatus('Failed to configure game paths');
        }
    }

    // Additional utility methods
    clearInventory() {
        if (confirm('Are you sure you want to clear all items from your inventory? This action cannot be undone.')) {
            this.inventory = [];
            this.renderInventory();
            this.autoSave();
            this.updateStatus('Inventory cleared');
        }
    }

    exportBackup() {
        try {
            const backupData = {
                inventory: this.inventory,
                factionLevels: this.factionLevels,
                loadouts: this.loadouts,
                timestamp: new Date().toISOString(),
                version: '2.0.0'
            };
            
            const dataStr = JSON.stringify(backupData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = `cycle-reborn-backup-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            
            this.updateStatus('Backup exported successfully');
        } catch (error) {
            console.error('Error exporting backup:', error);
            this.updateStatus('Failed to export backup');
        }
    }

    importBackup() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const backupData = JSON.parse(e.target.result);
                    
                    if (backupData.inventory) {
                        this.inventory = backupData.inventory;
                        this.renderInventory();
                    }
                    
                    if (backupData.factionLevels) {
                        this.factionLevels = backupData.factionLevels;
                        this.loadFactionLevels();
                    }
                    
                    if (backupData.loadouts) {
                        this.loadouts = backupData.loadouts;
                    }
                    
                    this.autoSave();
                    this.updateStatus('Backup imported successfully');
                } catch (error) {
                    console.error('Error importing backup:', error);
                    this.updateStatus('Failed to import backup - invalid file format');
                }
            };
            
            reader.readAsText(file);
        };
        
        input.click();
    }

    updateDurabilityDisplay(value, maxValue) {
        const display = document.querySelector('.durability-value');
        if (display) {
            display.textContent = value;
        }
        
        // Update the item's durability if currently editing
        if (this.currentEditingItemIndex !== null && this.inventory[this.currentEditingItemIndex]) {
            this.inventory[this.currentEditingItemIndex].durability = parseInt(value);
            this.autoSave();
        }
    }

    // Search and filter methods
    searchCommunityInventories(query) {
        if (!query.trim()) {
            this.renderCommunityInventories();
            return;
        }
        
        const filtered = this.communityInventories.filter(inv => 
            inv.title.toLowerCase().includes(query.toLowerCase()) ||
            inv.description.toLowerCase().includes(query.toLowerCase()) ||
            inv.author.toLowerCase().includes(query.toLowerCase())
        );
        
        this.renderCommunityInventories(filtered);
    }

    searchCommunityLoadouts(query) {
        if (!query.trim()) {
            this.renderCommunityLoadouts();
            return;
        }
        
        const filtered = this.communityLoadouts.filter(loadout => 
            loadout.title.toLowerCase().includes(query.toLowerCase()) ||
            loadout.description.toLowerCase().includes(query.toLowerCase()) ||
            loadout.author.toLowerCase().includes(query.toLowerCase())
        );
        
        this.renderCommunityLoadouts(filtered);
    }

    filterCommunityInventories(tag) {
        if (tag === 'all') {
            this.renderCommunityInventories();
        } else {
            const filtered = this.communityInventories.filter(inv => 
                inv.tags && inv.tags.includes(tag)
            );
            this.renderCommunityInventories(filtered);
        }
    }

    filterCommunityLoadouts(category) {
        if (category === 'all') {
            this.renderCommunityLoadouts();
        } else {
            const filtered = this.communityLoadouts.filter(loadout => 
                loadout.category === category
            );
            this.renderCommunityLoadouts(filtered);
        }
    }

    // Version and update methods
    async getCurrentVersion() {
        try {
            if (window.electronAPI && window.electronAPI.getCurrentVersion) {
                return await window.electronAPI.getCurrentVersion();
            }
            return '2.0.0'; // Fallback version
        } catch (error) {
            console.error('Error getting current version:', error);
            return '2.0.0';
        }
    }

    async checkForUpdates() {
        try {
            if (window.electronAPI && window.electronAPI.checkForUpdates) {
                this.updateStatus('Checking for updates...');
                const result = await window.electronAPI.checkForUpdates();
                
                if (result.success) {
                    this.updateStatus('Update check completed');
                } else {
                    this.updateStatus('Update check failed');
                }
            } else {
                this.updateStatus('Update checking not available in web mode');
            }
        } catch (error) {
            console.error('Error checking for updates:', error);
            this.updateStatus('Update check failed');
        }
    }

    // Error handling and logging
    handleError(error, context = 'Unknown') {
        console.error(`Error in ${context}:`, error);
        
        // Show user-friendly error message
        let message = 'An unexpected error occurred';
        
        if (error.message) {
            if (error.message.includes('fetch')) {
                message = 'Connection error - please check your internet connection';
            } else if (error.message.includes('JSON')) {
                message = 'Data parsing error - the response format was invalid';
            } else {
                message = error.message;
            }
        }
        
        this.updateStatus(`Error: ${message}`);
    }

    // Performance optimization methods
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    // Cache management
    clearImageCache() {
        this.imageCache.clear();
        this.imageErrors.clear();
        this.updateStatus('Image cache cleared');
    }

    preloadImages(items) {
        const loadPromises = items.slice(0, 20).map(item => {
            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    this.imageCache.set(item.baseItemId, img.src);
                    resolve();
                };
                img.onerror = () => {
                    this.imageErrors.add(item.baseItemId);
                    resolve();
                };
                img.src = this.getItemIcon(item.baseItemId);
            });
        });

        Promise.all(loadPromises).then(() => {
            console.log('Preloaded images for visible items');
        });
    }

    // Analytics and telemetry (privacy-friendly)
    trackAction(action, details = {}) {
        if (process.env.NODE_ENV === 'development') {
            console.log(`Action: ${action}`, details);
        }
        
        // In a real implementation, this could send anonymous usage data
        // to help improve the application, but only with user consent
    }

    // Cleanup methods
    cleanup() {
        // Clear timeouts
        if (this.autoSaveTimeout) {
            clearTimeout(this.autoSaveTimeout);
        }
        
        // Clear caches
        this.clearImageCache();
        
        // Remove event listeners that might cause memory leaks
        document.removeEventListener('click', this.handleGlobalClick);
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
        
        console.log('Editor cleanup completed');
    }

    // Global event handlers
    handleGlobalClick = (e) => {
        // Close dropdowns and modals when clicking outside
        if (e.target.classList.contains('modal')) {
            e.target.style.display = 'none';
        }
    }

    handleBeforeUnload = (e) => {
        // Save any pending changes before the page unloads
        if (this.inventory.length > 0) {
            this.saveInventory();
        }
    }

    // Initialize global event listeners
    initializeGlobalEvents() {
        document.addEventListener('click', this.handleGlobalClick);
        window.addEventListener('beforeunload', this.handleBeforeUnload);
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+S to save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveInventory();
                this.updateStatus('Manual save triggered');
            }
            
            // Ctrl+U to check for updates (if in Electron)
            if ((e.ctrlKey || e.metaKey) && e.key === 'u' && !e.shiftKey) {
                e.preventDefault();
                this.checkForUpdates();
            }
            
            // Escape to close modals
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal[style*="block"]');
                if (openModal) {
                    openModal.style.display = 'none';
                }
            }
        });
    }

    // Initialize all components
    async initializeAllComponents() {
        try {
            // Initialize global events
            this.initializeGlobalEvents();
            
            // Load configuration and data
            await this.loadItemConfigs();
            await this.loadAvailableItems();
            
            // Initialize UI components
            this.initializeWindowControls();
            this.initializeUpdateChecker();
            
            // Load user session
            this.loadUserSession();
            
            // Connect and load data
            await this.autoConnectAndLoad();
            
            // Initialize community features if authenticated
            if (this.isAuthenticated) {
                this.updateCommunityAccess();
            }
            
            this.updateStatus('Application initialized successfully');
            
        } catch (error) {
            this.handleError(error, 'Initialization');
        }
    }
}

// Initialize the editor when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Create global editor instance
    window.editor = new CycleRebornCommunityEditor();
    
    // Add some global helper functions for onclick handlers
    window.downloadCommunityInventory = (id) => window.editor.downloadCommunityInventory(id);
    window.downloadCommunityLoadout = (id) => window.editor.downloadCommunityLoadout(id);
    window.rateCommunityInventory = (id, rating) => window.editor.rateCommunityInventory(id, rating);
    window.rateCommunityLoadout = (id, rating) => window.editor.rateCommunityLoadout(id, rating);
    
    console.log('CycleRebornCommunityEditor initialized and ready!');
});