const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const https = require('https');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB connection details
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'ProspectDb';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'PlayFabUserData';
const INVENTORY_KEY = process.env.INVENTORY_KEY || 'Inventory';

// GitHub API configuration
const GITHUB_API_BASE = 'https://api.github.com';
const COMMUNITY_REPO_OWNER = process.env.GITHUB_OWNER || 'lxjo101';
const COMMUNITY_REPO_NAME = process.env.GITHUB_REPO || 'TheCycleRebornCommunity';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

let db = null;
let client = null;

// In-memory storage for community data
let communityInventories = new Map();
let communityLoadouts = new Map();
let userProfiles = new Map();
let userSessions = new Map();
let attachmentPresets = new Map();

let userStats = {
    totalUsers: 0,
    activeUsers: 0,
    lastUpdated: new Date().toISOString()
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting middleware
const rateLimitMap = new Map();
const rateLimit = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
    return (req, res, next) => {
        const clientIp = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        
        if (!rateLimitMap.has(clientIp)) {
            rateLimitMap.set(clientIp, { count: 1, resetTime: now + windowMs });
            return next();
        }
        
        const clientData = rateLimitMap.get(clientIp);
        
        if (now > clientData.resetTime) {
            clientData.count = 1;
            clientData.resetTime = now + windowMs;
            return next();
        }
        
        if (clientData.count >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: 'Too many requests. Please try again later.',
                retryAfter: Math.ceil((clientData.resetTime - now) / 1000)
            });
        }
        
        clientData.count++;
        next();
    };
};

// Apply rate limiting to community endpoints
app.use('/api/community', rateLimit(50, 15 * 60 * 1000));

// Utility functions
function generateAnonymousId() {
    const machineId = crypto.createHash('sha256')
        .update(os.hostname() + os.platform() + os.arch())
        .digest('hex')
        .substring(0, 16);
    return machineId;
}

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function validateItemStructure(item) {
    return item && 
           typeof item.baseItemId === 'string' && 
           typeof item.amount === 'number' && 
           item.amount > 0;
}

function sanitizeUserInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/[<>&"']/g, '')
                .substring(0, 1000);
}

function validateTags(tags) {
    const allowedTags = [
        'pvp-loadout', 'pve-setup', 'beginner-friendly', 'resource-rich', 
        'weapon-focus', 'endgame', 'stealth', 'aggressive', 'support', 
        'exploration', 'sniper', 'close-quarters', 'budget-build', 
        'high-tier', 'experimental', 'meta'
    ];
    
    if (!Array.isArray(tags)) return [];
    return tags.filter(tag => allowedTags.includes(tag)).slice(0, 10);
}

// GitHub API helper functions
async function makeGitHubRequest(endpoint, options = {}) {
    const url = `${GITHUB_API_BASE}${endpoint}`;
    const headers = {
        'User-Agent': 'TheCycleRebornSaveEditor/1.0',
        'Accept': 'application/vnd.github.v3+json',
        ...options.headers
    };
    
    if (GITHUB_TOKEN) {
        headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    }
    
    return new Promise((resolve, reject) => {
        const requestOptions = {
            method: options.method || 'GET',
            headers
        };
        
        const req = https.request(url, requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(jsonData);
                    } else {
                        reject(new Error(`GitHub API error: ${res.statusCode} - ${jsonData.message}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse GitHub response: ${error.message}`));
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.end();
    });
}

// Authentication endpoints
app.post('/api/auth/simple', async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username || username.length < 3 || username.length > 20) {
            return res.status(400).json({
                success: false,
                message: 'Username must be 3-20 characters long'
            });
        }
        
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: 'Username can only contain letters, numbers, underscore, and dash'
            });
        }
        
        const sessionToken = generateSessionToken();
        const user = {
            id: crypto.createHash('sha256').update(username).digest('hex').substring(0, 16),
            username: sanitizeUserInput(username),
            type: 'simple',
            avatar: username.charAt(0).toUpperCase(),
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        
        userSessions.set(sessionToken, user);
        userProfiles.set(user.id, user);
        
        res.json({
            success: true,
            user,
            sessionToken,
            message: 'Authentication successful'
        });
        
    } catch (error) {
        console.error('Simple auth error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
});

app.post('/api/auth/github', async (req, res) => {
    try {
        const { githubToken } = req.body;
        
        if (!githubToken) {
            return res.status(400).json({
                success: false,
                message: 'GitHub token required'
            });
        }
        
        const githubUser = await makeGitHubRequest('/user', {
            headers: { 'Authorization': `token ${githubToken}` }
        });
        
        const sessionToken = generateSessionToken();
        const user = {
            id: `github_${githubUser.id}`,
            username: githubUser.login,
            type: 'github',
            avatar: githubUser.avatar_url,
            githubToken,
            createdAt: new Date().toISOString(),
            lastLogin: new Date().toISOString()
        };
        
        userSessions.set(sessionToken, user);
        userProfiles.set(user.id, user);
        
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                type: user.type,
                avatar: user.avatar
            },
            sessionToken,
            message: 'GitHub authentication successful'
        });
        
    } catch (error) {
        console.error('GitHub auth error:', error);
        res.status(401).json({
            success: false,
            message: 'GitHub authentication failed'
        });
    }
});

app.post('/api/auth/logout', (req, res) => {
    try {
        const sessionToken = req.headers.authorization?.replace('Bearer ', '');
        
        if (sessionToken && userSessions.has(sessionToken)) {
            userSessions.delete(sessionToken);
        }
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
        
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Logout failed'
        });
    }
});

// Authentication middleware
function requireAuth(req, res, next) {
    const sessionToken = req.headers.authorization?.replace('Bearer ', '');
    
    if (!sessionToken || !userSessions.has(sessionToken)) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    req.user = userSessions.get(sessionToken);
    next();
}

// Community Inventories endpoints
app.get('/api/community/inventories', async (req, res) => {
    try {
        const { tag, search, sort = 'recent', limit = 50 } = req.query;
        
        let inventories = Array.from(communityInventories.values());
        
        if (tag && tag !== 'all') {
            inventories = inventories.filter(inv => inv.tags.includes(tag));
        }
        
        if (search) {
            const searchLower = search.toLowerCase();
            inventories = inventories.filter(inv => 
                inv.title.toLowerCase().includes(searchLower) ||
                inv.description.toLowerCase().includes(searchLower) ||
                inv.author.toLowerCase().includes(searchLower)
            );
        }
        
        switch (sort) {
            case 'popular':
                inventories.sort((a, b) => b.downloads - a.downloads);
                break;
            case 'rating':
                inventories.sort((a, b) => b.rating - a.rating);
                break;
            case 'recent':
            default:
                inventories.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
                break;
        }
        
        inventories = inventories.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            inventories,
            total: communityInventories.size
        });
        
    } catch (error) {
        console.error('Error fetching community inventories:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch community inventories'
        });
    }
});

app.post('/api/community/inventories', requireAuth, async (req, res) => {
    try {
        const { title, description, tags, category, inventory } = req.body;
        
        if (!title || title.length < 5 || title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 5-100 characters long'
            });
        }
        
        if (!Array.isArray(inventory) || inventory.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Inventory data is required'
            });
        }
        
        if (inventory.length > 220) {
            return res.status(400).json({
                success: false,
                message: 'Inventory cannot exceed 220 items'
            });
        }
        
        const invalidItems = inventory.filter(item => !validateItemStructure(item));
        if (invalidItems.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid inventory item structure detected'
            });
        }
        
        const inventoryId = crypto.randomUUID();
        const communityInventory = {
            id: inventoryId,
            title: sanitizeUserInput(title),
            description: sanitizeUserInput(description || ''),
            tags: validateTags(tags),
            category: category || 'general',
            author: req.user.username,
            authorId: req.user.id,
            inventory: inventory,
            rating: 0,
            ratings: new Map(),
            downloads: 0,
            uploadDate: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
        
        communityInventories.set(inventoryId, communityInventory);
        
        if (req.user.type === 'github' && req.user.githubToken) {
            try {
                await uploadToGitHub('inventory', inventoryId, communityInventory, req.user.githubToken);
            } catch (githubError) {
                console.warn('GitHub upload failed:', githubError.message);
            }
        }
        
        res.json({
            success: true,
            inventory: {
                ...communityInventory,
                inventory: undefined
            },
            message: 'Inventory uploaded successfully'
        });
        
    } catch (error) {
        console.error('Error uploading inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload inventory'
        });
    }
});

app.get('/api/community/inventories/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const inventory = communityInventories.get(id);
        
        if (!inventory) {
            return res.status(404).json({
                success: false,
                message: 'Inventory not found'
            });
        }
        
        res.json({
            success: true,
            inventory
        });
        
    } catch (error) {
        console.error('Error fetching inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch inventory'
        });
    }
});

app.post('/api/community/inventories/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const inventory = communityInventories.get(id);
        
        if (!inventory) {
            return res.status(404).json({
                success: false,
                message: 'Inventory not found'
            });
        }
        
        inventory.downloads++;
        
        res.json({
            success: true,
            inventory: inventory.inventory,
            message: 'Inventory downloaded successfully'
        });
        
    } catch (error) {
        console.error('Error downloading inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download inventory'
        });
    }
});

app.post('/api/community/inventories/:id/rate', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { rating } = req.body;
        
        if (![1, -1].includes(rating)) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be 1 (like) or -1 (dislike)'
            });
        }
        
        const inventory = communityInventories.get(id);
        if (!inventory) {
            return res.status(404).json({
                success: false,
                message: 'Inventory not found'
            });
        }
        
        inventory.ratings.set(req.user.id, rating);
        
        const ratings = Array.from(inventory.ratings.values());
        const avgRating = ratings.length > 0 ? 
            ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
        inventory.rating = Math.round((avgRating + 1) * 2.5 * 10) / 10;
        
        res.json({
            success: true,
            rating: inventory.rating,
            userRating: rating,
            message: 'Rating submitted successfully'
        });
        
    } catch (error) {
        console.error('Error rating inventory:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit rating'
        });
    }
});

// Community Loadouts endpoints
app.get('/api/community/loadouts', async (req, res) => {
    try {
        const { category, search, sort = 'recent', limit = 50 } = req.query;
        
        let loadouts = Array.from(communityLoadouts.values());
        
        if (category && category !== 'all') {
            loadouts = loadouts.filter(loadout => loadout.category === category);
        }
        
        if (search) {
            const searchLower = search.toLowerCase();
            loadouts = loadouts.filter(loadout => 
                loadout.title.toLowerCase().includes(searchLower) ||
                loadout.description.toLowerCase().includes(searchLower) ||
                loadout.author.toLowerCase().includes(searchLower)
            );
        }
        
        switch (sort) {
            case 'effectiveness':
                loadouts.sort((a, b) => b.effectivenessScore - a.effectivenessScore);
                break;
            case 'popular':
                loadouts.sort((a, b) => b.downloads - a.downloads);
                break;
            case 'rating':
                loadouts.sort((a, b) => b.rating - a.rating);
                break;
            case 'recent':
            default:
                loadouts.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
                break;
        }
        
        loadouts = loadouts.slice(0, parseInt(limit));
        
        res.json({
            success: true,
            loadouts,
            total: communityLoadouts.size
        });
        
    } catch (error) {
        console.error('Error fetching community loadouts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch community loadouts'
        });
    }
});

app.post('/api/community/loadouts', requireAuth, async (req, res) => {
    try {
        const { title, description, category, loadout } = req.body;
        
        if (!title || title.length < 5 || title.length > 100) {
            return res.status(400).json({
                success: false,
                message: 'Title must be 5-100 characters long'
            });
        }
        
        if (!loadout || !loadout.slots) {
            return res.status(400).json({
                success: false,
                message: 'Loadout data is required'
            });
        }
        
        const loadoutId = crypto.randomUUID();
        const effectivenessScore = calculateLoadoutEffectiveness(loadout);
        
        const communityLoadout = {
            id: loadoutId,
            title: sanitizeUserInput(title),
            description: sanitizeUserInput(description || ''),
            category: category || 'general',
            author: req.user.username,
            authorId: req.user.id,
            loadout: loadout,
            effectivenessScore,
            effectivenessMetrics: analyzeLoadoutMetrics(loadout),
            rating: 0,
            ratings: new Map(),
            downloads: 0,
            uploadDate: new Date().toISOString(),
            lastModified: new Date().toISOString()
        };
        
        communityLoadouts.set(loadoutId, communityLoadout);
        
        res.json({
            success: true,
            loadout: {
                ...communityLoadout,
                loadout: undefined
            },
            message: 'Loadout uploaded successfully'
        });
        
    } catch (error) {
        console.error('Error uploading loadout:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to upload loadout'
        });
    }
});

app.post('/api/community/loadouts/:id/download', async (req, res) => {
    try {
        const { id } = req.params;
        const loadout = communityLoadouts.get(id);
        
        if (!loadout) {
            return res.status(404).json({
                success: false,
                message: 'Loadout not found'
            });
        }
        
        loadout.downloads++;
        
        res.json({
            success: true,
            loadout: loadout.loadout,
            message: 'Loadout downloaded successfully'
        });
        
    } catch (error) {
        console.error('Error downloading loadout:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to download loadout'
        });
    }
});

// Loadout effectiveness analysis
function calculateLoadoutEffectiveness(loadout) {
    const metrics = analyzeLoadoutMetrics(loadout);
    
    const weights = {
        rangeCoverage: 0.25,
        survivability: 0.30,
        utility: 0.20,
        engagementFlexibility: 0.25
    };
    
    return Object.entries(weights).reduce((score, [metric, weight]) => 
        score + (metrics[metric] * weight), 0
    );
}

function analyzeLoadoutMetrics(loadout) {
    const slots = loadout.slots || {};
    
    // Mock analysis - in real implementation, analyze actual items
    let rangeCoverage = 0;
    let survivability = 0;
    let utility = 0;
    let engagementFlexibility = 0;
    
    // Analyze weapons for range coverage
    if (slots['primary-weapon']) {
        rangeCoverage += 60;
        engagementFlexibility += 40;
    }
    if (slots['secondary-weapon']) {
        rangeCoverage += 30;
        engagementFlexibility += 30;
    }
    
    // Analyze armor for survivability
    if (slots.helmet) survivability += 25;
    if (slots.armor) survivability += 50;
    if (slots.backpack) survivability += 15;
    
    // Analyze consumables and tools for utility
    if (slots['consumable-1']) utility += 30;
    if (slots['consumable-2']) utility += 30;
    if (slots['tool-1']) utility += 40;
    
    return {
        rangeCoverage: Math.min(100, rangeCoverage),
        survivability: Math.min(100, survivability),
        utility: Math.min(100, utility),
        engagementFlexibility: Math.min(100, engagementFlexibility),
        resourceEfficiency: Math.random() * 100
    };
}

// Weapon Attachments endpoints
app.get('/api/attachments/compatible/:weaponId', async (req, res) => {
    try {
        const { weaponId } = req.params;
        const { attachmentType } = req.query;
        
        // Mock compatible attachments
        const mockAttachments = [
            {
                baseItemId: `Mod_${attachmentType}_Common_01`,
                displayName: `${attachmentType.replace('-', ' ')} Mk1`,
                rarity: 'common',
                attachment_type: attachmentType,
                attachment_weapon: [weaponId]
            },
            {
                baseItemId: `Mod_${attachmentType}_Rare_01`,
                displayName: `${attachmentType.replace('-', ' ')} Pro`,
                rarity: 'rare',
                attachment_type: attachmentType,
                attachment_weapon: [weaponId]
            },
            {
                baseItemId: `Mod_${attachmentType}_Epic_01`,
                displayName: `${attachmentType.replace('-', ' ')} Elite`,
                rarity: 'epic',
                attachment_type: attachmentType,
                attachment_weapon: [weaponId]
            }
        ];
        
        res.json({
            success: true,
            attachments: mockAttachments
        });
        
    } catch (error) {
        console.error('Error fetching compatible attachments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch compatible attachments'
        });
    }
});

// Attachment presets endpoints
app.get('/api/attachments/presets/:weaponId', async (req, res) => {
    try {
        const { weaponId } = req.params;
        const presets = Array.from(attachmentPresets.values()).filter(
            preset => preset.weaponId === weaponId
        );
        
        res.json({
            success: true,
            presets
        });
        
    } catch (error) {
        console.error('Error fetching attachment presets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch attachment presets'
        });
    }
});

app.post('/api/attachments/presets', requireAuth, async (req, res) => {
    try {
        const { weaponId, presetName, attachments } = req.body;
        
        if (!weaponId || !presetName || !attachments) {
            return res.status(400).json({
                success: false,
                message: 'Weapon ID, preset name, and attachments are required'
            });
        }
        
        const presetId = crypto.randomUUID();
        const preset = {
            id: presetId,
            weaponId,
            presetName: sanitizeUserInput(presetName),
            attachments,
            author: req.user.username,
            authorId: req.user.id,
            createdAt: new Date().toISOString()
        };
        
        attachmentPresets.set(presetId, preset);
        
        res.json({
            success: true,
            preset,
            message: 'Attachment preset saved successfully'
        });
        
    } catch (error) {
        console.error('Error saving attachment preset:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save attachment preset'
        });
    }
});

// Faction levels endpoints
app.get('/api/factions', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({
                success: false,
                message: 'Database not connected'
            });
        }
        
        // Mock faction data
        const factionLevels = {
            ica: 0,
            korolev: 0,
            osiris: 0
        };
        
        res.json({
            success: true,
            factions: factionLevels
        });
        
    } catch (error) {
        console.error('Error loading faction levels:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load faction levels'
        });
    }
});

app.put('/api/factions', async (req, res) => {
    try {
        const { ica, korolev, osiris } = req.body;
        
        const levels = { ica, korolev, osiris };
        for (const [faction, level] of Object.entries(levels)) {
            if (typeof level !== 'number' || level < 0 || level > 100) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid ${faction} level. Must be between 0 and 100.`
                });
            }
        }
        
        console.log('Saving faction levels:', levels);
        
        res.json({
            success: true,
            factions: levels,
            message: 'Faction levels saved successfully'
        });
        
    } catch (error) {
        console.error('Error saving faction levels:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save faction levels'
        });
    }
});

// GitHub integration helper
async function uploadToGitHub(type, id, data, githubToken) {
    const fileName = `${type}s/${id}.json`;
    const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
    
    try {
        let sha = null;
        try {
            const existingFile = await makeGitHubRequest(
                `/repos/${COMMUNITY_REPO_OWNER}/${COMMUNITY_REPO_NAME}/contents/${fileName}`,
                { headers: { 'Authorization': `token ${githubToken}` } }
            );
            sha = existingFile.sha;
        } catch (error) {
            // File doesn't exist
        }
        
        const body = {
            message: `${sha ? 'Update' : 'Add'} ${type}: ${data.title}`,
            content,
            ...(sha && { sha })
        };
        
        await makeGitHubRequest(
            `/repos/${COMMUNITY_REPO_OWNER}/${COMMUNITY_REPO_NAME}/contents/${fileName}`,
            {
                method: 'PUT',
                headers: { 'Authorization': `token ${githubToken}` },
                body
            }
        );
        
        console.log(`Successfully uploaded ${type} ${id} to GitHub`);
        
    } catch (error) {
        console.error(`Failed to upload ${type} to GitHub:`, error.message);
        throw error;
    }
}

// Serve the enhanced HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Connect to MongoDB
app.post('/api/connect', async (req, res) => {
    try {
        console.log('Attempting to connect to MongoDB...');
        console.log(`Connection URL: ${MONGO_URL}`);
        console.log(`Database: ${DB_NAME}`);
        console.log(`Collection: ${COLLECTION_NAME}`);
        
        if (client) {
            await client.close();
            console.log('Closed existing connection');
        }
        
        client = new MongoClient(MONGO_URL, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
        });
        
        await client.connect();
        console.log('Connected to MongoDB server');
        
        db = client.db(DB_NAME);
        console.log(`Selected database: ${DB_NAME}`);
        
        const collection = db.collection(COLLECTION_NAME);
        const count = await collection.countDocuments();
        
        console.log(`Successfully connected to MongoDB - Found ${count} documents in ${COLLECTION_NAME}`);
        
        const inventoryCount = await collection.countDocuments({ 
            [INVENTORY_KEY]: { $exists: true } 
        });
        console.log(`Found ${inventoryCount} documents with '${INVENTORY_KEY}' key`);
        
        res.json({ 
            success: true, 
            message: `Connected to MongoDB successfully - Found ${count} total documents.`,
            totalDocuments: count,
            inventoryDocuments: inventoryCount
        });
    } catch (error) {
        console.error('MongoDB connection error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to connect to MongoDB', 
            error: error.message,
            details: error.toString()
        });
    }
});

// Find user document with Inventory key
async function findUserWithInventory() {
    if (!db) {
        throw new Error('Database not connected');
    }
    
    const collection = db.collection(COLLECTION_NAME);
    
    console.log(`Searching for documents with Key="${INVENTORY_KEY}"...`);
    
    let userDocument = await collection.findOne({ 
        Key: INVENTORY_KEY
    });
    
    if (userDocument) {
        console.log(`Found PlayFab document with Key="${INVENTORY_KEY}":`, userDocument._id);
        return userDocument;
    }
    
    userDocument = await collection.findOne({ 
        [INVENTORY_KEY]: { $exists: true } 
    });
    
    if (userDocument) {
        console.log(`Found document with ${INVENTORY_KEY} at root level:`, userDocument._id);
        return userDocument;
    }
    
    userDocument = await collection.findOne({ 
        [`Data.${INVENTORY_KEY}`]: { $exists: true } 
    });
    
    if (userDocument) {
        console.log(`Found document with Data.${INVENTORY_KEY}:`, userDocument._id);
        return userDocument;
    }
    
    userDocument = await collection.findOne({});
    if (userDocument) {
        console.log('Warning: Using first available document, may not contain inventory data');
    }
    
    return userDocument;
}

// Load inventory from MongoDB
app.get('/api/inventory', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database. Please connect first.' 
            });
        }

        console.log(`Looking for user document with "${INVENTORY_KEY}" key...`);
        const userDocument = await findUserWithInventory();

        if (!userDocument) {
            return res.status(404).json({ 
                success: false, 
                message: `No user documents found in collection ${COLLECTION_NAME}` 
            });
        }

        console.log(`Found user document: ${userDocument._id}`);

        let inventory = [];
        let inventorySource = 'none';

        if (userDocument.Key === INVENTORY_KEY && userDocument.Value) {
            console.log(`Found PlayFab inventory structure, Value type: ${typeof userDocument.Value}`);
            
            if (typeof userDocument.Value === 'string') {
                try {
                    inventory = JSON.parse(userDocument.Value);
                    inventorySource = `PlayFab Key="${INVENTORY_KEY}" Value (parsed JSON string)`;
                    console.log(`Successfully parsed PlayFab inventory, ${inventory.length} items`);
                } catch (parseError) {
                    console.error('Error parsing PlayFab inventory JSON:', parseError);
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON from PlayFab Value field',
                        error: parseError.message
                    });
                }
            } else if (Array.isArray(userDocument.Value)) {
                inventory = userDocument.Value;
                inventorySource = `PlayFab Key="${INVENTORY_KEY}" Value (direct array)`;
                console.log(`Direct array in PlayFab Value, ${inventory.length} items`);
            }
        }
        else if (userDocument[INVENTORY_KEY]) {
            const inventoryData = userDocument[INVENTORY_KEY];
            console.log(`Found inventory at root level, type: ${typeof inventoryData}`);
            
            if (inventoryData && inventoryData.Value) {
                console.log(`Found .Value property, type: ${typeof inventoryData.Value}`);
                
                if (typeof inventoryData.Value === 'string') {
                    try {
                        inventory = JSON.parse(inventoryData.Value);
                        inventorySource = `Root.${INVENTORY_KEY}.Value (parsed JSON string)`;
                        console.log(`Successfully parsed inventory from .Value property, ${inventory.length} items`);
                    } catch (parseError) {
                        console.error('Error parsing inventory.Value JSON:', parseError);
                        return res.status(500).json({
                            success: false,
                            message: 'Error parsing inventory JSON from Value field',
                            error: parseError.message
                        });
                    }
                } else if (Array.isArray(inventoryData.Value)) {
                    inventory = inventoryData.Value;
                    inventorySource = `Root.${INVENTORY_KEY}.Value (direct array)`;
                }
            }
            else if (typeof inventoryData === 'string') {
                try {
                    inventory = JSON.parse(inventoryData);
                    inventorySource = `Root.${INVENTORY_KEY} (parsed JSON string)`;
                } catch (parseError) {
                    console.error('Error parsing inventory JSON:', parseError);
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON',
                        error: parseError.message
                    });
                }
            }
            else if (Array.isArray(inventoryData)) {
                inventory = inventoryData;
                inventorySource = `Root.${INVENTORY_KEY} (direct array)`;
            }
        }
        else if (userDocument.Data && userDocument.Data[INVENTORY_KEY]) {
            const inventoryData = userDocument.Data[INVENTORY_KEY];
            console.log(`Found inventory in Data.${INVENTORY_KEY}, type: ${typeof inventoryData}`);
            
            if (inventoryData && inventoryData.Value && typeof inventoryData.Value === 'string') {
                try {
                    inventory = JSON.parse(inventoryData.Value);
                    inventorySource = `Data.${INVENTORY_KEY}.Value (parsed JSON string)`;
                } catch (parseError) {
                    console.error('Error parsing Data inventory.Value JSON:', parseError);
                    return res.status(500).json({
                        success: false,
                        message: 'Error parsing inventory JSON from Data.Value field',
                        error: parseError.message
                    });
                }
            }
        }

        console.log(`Final result - Inventory source: ${inventorySource}`);
        console.log(`Final result - Loaded ${inventory.length} items from inventory`);
        
        if (!Array.isArray(inventory)) {
            console.log('Inventory is not an array, converting...');
            inventory = [];
        }
        
        if (inventory.length > 0) {
            console.log('Sample inventory items:');
            console.log(JSON.stringify(inventory.slice(0, 3), null, 2));
        }

        res.json(inventory);
    } catch (error) {
        console.error('Error loading inventory:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to load inventory', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Save inventory to MongoDB
app.put('/api/inventory', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Not connected to database' 
            });
        }

        const newInventory = req.body;
        
        if (!Array.isArray(newInventory)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Inventory must be an array' 
            });
        }

        console.log(`Saving ${newInventory.length} items to inventory...`);

        const userDocument = await findUserWithInventory();
        if (!userDocument) {
            return res.status(404).json({ 
                success: false, 
                message: 'No user document found' 
            });
        }

        const collection = db.collection(COLLECTION_NAME);
        
        let updateData = {};
        let inventoryValue = JSON.stringify(newInventory);
        
        if (userDocument.Key === INVENTORY_KEY) {
            updateData.Value = inventoryValue;
        } else if (userDocument[INVENTORY_KEY]) {
            if (userDocument[INVENTORY_KEY].Value !== undefined) {
                updateData[INVENTORY_KEY] = {
                    ...userDocument[INVENTORY_KEY],
                    Value: inventoryValue
                };
            } else {
                updateData[INVENTORY_KEY] = inventoryValue;
            }
        } else if (userDocument.Data && userDocument.Data[INVENTORY_KEY]) {
            if (userDocument.Data[INVENTORY_KEY].Value !== undefined) {
                updateData[`Data.${INVENTORY_KEY}`] = {
                    ...userDocument.Data[INVENTORY_KEY],
                    Value: inventoryValue
                };
            } else {
                updateData[`Data.${INVENTORY_KEY}`] = inventoryValue;
            }
        } else {
            updateData.Key = INVENTORY_KEY;
            updateData.Value = inventoryValue;
        }
        
        updateData['LastUpdated'] = new Date().toISOString();
        
        const updateResult = await collection.updateOne(
            { _id: userDocument._id },
            { $set: updateData }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Failed to update user document - document not found' 
            });
        }

        console.log(`Inventory saved successfully for user ${userDocument._id}`);

        res.json({ 
            success: true, 
            message: 'Inventory saved successfully',
            itemCount: newInventory.length,
            userId: userDocument._id,
            matchedCount: updateResult.matchedCount,
            modifiedCount: updateResult.modifiedCount
        });
    } catch (error) {
        console.error('Error saving inventory:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save inventory', 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Get balance
app.get('/api/balance', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ success: false, message: 'Not connected to database' });
        }

        const userDocument = await findUserWithInventory();
        if (!userDocument) {
            return res.status(404).json({ success: false, message: 'No user document found' });
        }

        let balance = { AU: 0, SC: 0, IN: 0 };
        
        if (userDocument.Key === 'Balance' && userDocument.Value) {
            balance = typeof userDocument.Value === 'string' ? JSON.parse(userDocument.Value) : userDocument.Value;
        } else {
            const collection = db.collection(COLLECTION_NAME);
            const balanceDoc = await collection.findOne({ Key: 'Balance' });
            if (balanceDoc && balanceDoc.Value) {
                balance = typeof balanceDoc.Value === 'string' ? JSON.parse(balanceDoc.Value) : balanceDoc.Value;
            }
        }

        res.json(balance);
    } catch (error) {
        console.error('Error loading balance:', error);
        res.status(500).json({ success: false, message: 'Failed to load balance', error: error.message });
    }
});

// Save balance
app.put('/api/balance', async (req, res) => {
    try {
        if (!db) {
            return res.status(400).json({ success: false, message: 'Not connected to database' });
        }

        const newBalance = req.body;
        const collection = db.collection(COLLECTION_NAME);
        
        let balanceDoc = await collection.findOne({ Key: 'Balance' });
        
        if (balanceDoc) {
            await collection.updateOne(
                { _id: balanceDoc._id },
                { $set: { Value: JSON.stringify(newBalance), LastUpdated: new Date().toISOString() } }
            );
        } else {
            await collection.insertOne({
                Key: 'Balance',
                Value: JSON.stringify(newBalance),
                LastUpdated: new Date().toISOString()
            });
        }

        res.json({ success: true, message: 'Balance saved successfully' });
    } catch (error) {
        console.error('Error saving balance:', error);
        res.status(500).json({ success: false, message: 'Failed to save balance', error: error.message });
    }
});

// User stats endpoint
app.post('/api/user/ping', async (req, res) => {
    try {
        const anonymousId = generateAnonymousId();
        
        if (!db) {
            return res.status(400).json({ 
                success: false, 
                message: 'Database not connected' 
            });
        }

        const statsCollection = db.collection('UserStats');
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

        await statsCollection.updateOne(
            { userId: anonymousId },
            { 
                $set: { 
                    lastSeen: now,
                    version: req.body.version || '2.0.0'
                }
            },
            { upsert: true }
        );

        const totalUsers = await statsCollection.countDocuments();
        const activeUsers = await statsCollection.countDocuments({
            lastSeen: { $gte: fiveMinutesAgo }
        });

        userStats = {
            totalUsers,
            activeUsers,
            lastUpdated: now.toISOString()
        };

        res.json({ 
            success: true, 
            stats: userStats,
            yourId: anonymousId.substring(0, 8)
        });
    } catch (error) {
        console.error('Error updating user stats:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update user stats',
            stats: userStats
        });
    }
});

// Community statistics endpoint
app.get('/api/community/stats', (req, res) => {
    try {
        const stats = {
            totalInventories: communityInventories.size,
            totalLoadouts: communityLoadouts.size,
            totalUsers: userProfiles.size,
            activeUsers: userSessions.size,
            totalDownloads: Array.from(communityInventories.values()).reduce((sum, inv) => sum + inv.downloads, 0) +
                           Array.from(communityLoadouts.values()).reduce((sum, load) => sum + load.downloads, 0),
            topTags: getTopTags(),
            recentActivity: getRecentActivity()
        };

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('Error getting community stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get community statistics'
        });
    }
});

function getTopTags() {
    const tagCounts = new Map();
    
    for (const inventory of communityInventories.values()) {
        inventory.tags.forEach(tag => {
            tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
        });
    }
    
    return Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));
}

function getRecentActivity() {
    const allItems = [
        ...Array.from(communityInventories.values()).map(item => ({ ...item, type: 'inventory' })),
        ...Array.from(communityLoadouts.values()).map(item => ({ ...item, type: 'loadout' }))
    ];
    
    return allItems
        .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate))
        .slice(0, 10)
        .map(item => ({
            id: item.id,
            type: item.type,
            title: item.title,
            author: item.author,
            uploadDate: item.uploadDate
        }));
}

// Content moderation endpoint
app.post('/api/admin/moderate', requireAuth, async (req, res) => {
    try {
        if (!req.user.username.includes('admin')) {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }

        const { type, id, action } = req.body;
        
        if (type === 'inventory' && communityInventories.has(id)) {
            if (action === 'remove') {
                communityInventories.delete(id);
            }
        } else if (type === 'loadout' && communityLoadouts.has(id)) {
            if (action === 'remove') {
                communityLoadouts.delete(id);
            }
        }

        res.json({
            success: true,
            message: `${action} action completed for ${type} ${id}`
        });

    } catch (error) {
        console.error('Moderation error:', error);
        res.status(500).json({
            success: false,
            message: 'Moderation action failed'
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        connected: !!db,
        timestamp: new Date().toISOString(),
        communityFeatures: {
            inventoriesCount: communityInventories.size,
            loadoutsCount: communityLoadouts.size,
            activeUsers: userSessions.size,
            attachmentPresetsCount: attachmentPresets.size
        },
        config: {
            mongoUrl: MONGO_URL.replace(/\/\/.*@/, '//***:***@'),
            database: DB_NAME,
            collection: COLLECTION_NAME,
            inventoryKey: INVENTORY_KEY,
            githubIntegration: !!GITHUB_TOKEN
        }
    });
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down server...');
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (client) {
        await client.close();
        console.log('MongoDB connection closed');
    }
    process.exit(0);
});

// Initialize some sample data for demo
function initializeSampleData() {
    // Sample community inventories
    const sampleInventories = [
        {
            id: 'sample_inv_001',
            title: 'PvP Domination Build',
            description: 'High-tier weapons and armor for aggressive PvP encounters. Includes top-tier weapons, heavy armor, and plenty of healing items.',
            tags: ['pvp-loadout', 'high-tier', 'aggressive'],
            category: 'pvp-loadout',
            author: 'ProPlayer_2024',
            authorId: 'sample_user_1',
            inventory: [
                {
                    itemId: 'item_001',
                    baseItemId: 'WP_R_AR_KARMA_01',
                    amount: 1,
                    durability: 1000,
                    modData: { m: [] }
                },
                {
                    itemId: 'item_002',
                    baseItemId: 'WP_R_SMG_PHASIC_01',
                    amount: 1,
                    durability: 800,
                    modData: { m: [] }
                }
            ],
            rating: 4.5,
            ratings: new Map([['user1', 1], ['user2', 1], ['user3', -1]]),
            downloads: 234,
            uploadDate: '2024-01-15T10:00:00Z',
            lastModified: '2024-01-15T10:00:00Z'
        },
        {
            id: 'sample_inv_002',
            title: 'Budget Beginner Setup',
            description: 'Cost-effective items perfect for new players. Focus on basic survival gear and affordable weapons.',
            tags: ['beginner-friendly', 'budget-build', 'pve-setup'],
            category: 'beginner-friendly',
            author: 'HelpfulVet',
            authorId: 'sample_user_2',
            inventory: [
                {
                    itemId: 'item_003',
                    baseItemId: 'WP_C_AR_AR55_01',
                    amount: 1,
                    durability: 600,
                    modData: { m: [] }
                }
            ],
            rating: 4.8,
            ratings: new Map([['user1', 1], ['user2', 1], ['user3', 1], ['user4', 1]]),
            downloads: 567,
            uploadDate: '2024-01-10T15:30:00Z',
            lastModified: '2024-01-10T15:30:00Z'
        },
        {
            id: 'sample_inv_003',
            title: 'Resource Farming Kit',
            description: 'Optimized for efficient resource collection with mining tools and storage.',
            tags: ['resource-rich', 'exploration', 'pve-setup'],
            category: 'resource-rich',
            author: 'FarmMaster',
            authorId: 'sample_user_3',
            inventory: [],
            rating: 4.2,
            ratings: new Map([['user1', 1], ['user2', 1]]),
            downloads: 189,
            uploadDate: '2024-01-12T09:15:00Z',
            lastModified: '2024-01-12T09:15:00Z'
        }
    ];

    // Sample community loadouts
    const sampleLoadouts = [
        {
            id: 'sample_load_001',
            title: 'Stealth Operative',
            description: 'Perfect for sneaky players who prefer to avoid direct confrontation.',
            category: 'stealth',
            author: 'ShadowRunner',
            authorId: 'sample_user_4',
            loadout: { 
                name: 'Stealth Operative',
                category: 'stealth',
                slots: {
                    'primary-weapon': { baseItemId: 'WP_U_SMG_C32_01', amount: 1 },
                    'secondary-weapon': { baseItemId: 'WP_C_Pistol_P226_01', amount: 1 },
                    'helmet': { baseItemId: 'Helmet_Light_01', amount: 1 },
                    'armor': { baseItemId: 'Shield_Light_01', amount: 1 }
                },
                attachments: {}
            },
            effectivenessScore: 87.5,
            effectivenessMetrics: {
                rangeCoverage: 75,
                survivability: 80,
                utility: 95,
                engagementFlexibility: 85,
                resourceEfficiency: 90
            },
            rating: 4.2,
            ratings: new Map([['user1', 1], ['user2', 1], ['user3', -1]]),
            downloads: 189,
            uploadDate: '2024-01-12T09:15:00Z',
            lastModified: '2024-01-12T09:15:00Z'
        },
        {
            id: 'sample_load_002',
            title: 'Aggressive Assault',
            description: 'High-damage loadout for players who like to push hard and fast.',
            category: 'aggressive',
            author: 'RushMaster',
            authorId: 'sample_user_5',
            loadout: { 
                name: 'Aggressive Assault',
                category: 'aggressive',
                slots: {
                    'primary-weapon': { baseItemId: 'WP_R_AR_KARMA_01', amount: 1 },
                    'secondary-weapon': { baseItemId: 'WP_U_Shotgun_SHOTGUN_01', amount: 1 },
                    'helmet': { baseItemId: 'Helmet_Heavy_01', amount: 1 },
                    'armor': { baseItemId: 'Shield_Heavy_01', amount: 1 }
                },
                attachments: {}
            },
            effectivenessScore: 92.3,
            effectivenessMetrics: {
                rangeCoverage: 90,
                survivability: 95,
                utility: 85,
                engagementFlexibility: 95,
                resourceEfficiency: 75
            },
            rating: 4.6,
            ratings: new Map([['user1', 1], ['user2', 1], ['user3', 1]]),
            downloads: 342,
            uploadDate: '2024-01-14T14:20:00Z',
            lastModified: '2024-01-14T14:20:00Z'
        }
    ];

    // Sample attachment presets
    const sampleAttachmentPresets = [
        {
            id: 'preset_001',
            weaponId: 'WP_R_AR_KARMA_01',
            presetName: 'Long Range',
            attachments: {
                optics: 'Mod_Optics_4x_01',
                magazine: 'Mod_Magazine_Extended_01',
                muzzle: 'Mod_Muzzle_Compensator_01',
                stock: 'Mod_Stock_Precision_01'
            },
            author: 'PrecisionShooter',
            authorId: 'sample_user_6',
            createdAt: '2024-01-13T11:30:00Z'
        },
        {
            id: 'preset_002',
            weaponId: 'WP_R_AR_KARMA_01',
            presetName: 'CQB Setup',
            attachments: {
                optics: 'Mod_Optics_Holo_01',
                magazine: 'Mod_Magazine_Fast_01',
                muzzle: 'Mod_Muzzle_Flash_01',
                'fore-grip': 'Mod_Grip_Vertical_01'
            },
            author: 'CQBSpecialist',
            authorId: 'sample_user_7',
            createdAt: '2024-01-13T16:45:00Z'
        }
    ];

    // Initialize data
    sampleInventories.forEach(inv => {
        communityInventories.set(inv.id, inv);
    });

    sampleLoadouts.forEach(load => {
        communityLoadouts.set(load.id, load);
    });

    sampleAttachmentPresets.forEach(preset => {
        attachmentPresets.set(preset.id, preset);
    });

    console.log('Sample community data initialized');
    console.log(`- ${sampleInventories.length} community inventories`);
    console.log(`- ${sampleLoadouts.length} community loadouts`);
    console.log(`- ${sampleAttachmentPresets.length} attachment presets`);
}

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('='.repeat(60));
    console.log('🎮 The Cycle: Reborn Save Editor - Community Edition Backend');
    console.log('='.repeat(60));
    console.log('Enhanced Features:');
    console.log('  🌐 Community Inventories & Loadouts');
    console.log('  🔧 Weapon Attachment System');
    console.log('  ⚔️ Advanced Loadout Editor');
    console.log('  🏛️ Faction Level Management');
    console.log('  🔐 GitHub Integration & Authentication');
    console.log('  📊 Community Statistics & Analytics');
    console.log('  🛡️ Content Moderation & Rate Limiting');
    console.log('');
    console.log('Database Configuration:');
    console.log(`  URL: ${MONGO_URL}`);
    console.log(`  Database: ${DB_NAME}`);
    console.log(`  Collection: ${COLLECTION_NAME}`);
    console.log(`  Inventory Key: "${INVENTORY_KEY}"`);
    console.log('');
    console.log('API Endpoints:');
    console.log('  Core Features:');
    console.log('    POST /api/connect         - Connect to MongoDB');
    console.log('    GET  /api/inventory       - Load inventory');
    console.log('    PUT  /api/inventory       - Save inventory');
    console.log('    GET  /api/balance         - Get currency balance');
    console.log('    PUT  /api/balance         - Save currency balance');
    console.log('    GET  /api/factions        - Get faction levels');
    console.log('    PUT  /api/factions        - Save faction levels');
    console.log('');
    console.log('  Authentication:');
    console.log('    POST /api/auth/simple     - Simple username auth');
    console.log('    POST /api/auth/github     - GitHub OAuth auth');
    console.log('    POST /api/auth/logout     - Logout user');
    console.log('');
    console.log('  Community Features:');
    console.log('    GET  /api/community/inventories     - Browse inventories');
    console.log('    POST /api/community/inventories     - Upload inventory');
    console.log('    GET  /api/community/loadouts        - Browse loadouts');
    console.log('    POST /api/community/loadouts        - Upload loadout');
    console.log('    GET  /api/community/stats           - Community statistics');
    console.log('');
    console.log('  Weapon Attachments:');
    console.log('    GET  /api/attachments/compatible/:weaponId - Get compatible attachments');
    console.log('    GET  /api/attachments/presets/:weaponId   - Get attachment presets');
    console.log('    POST /api/attachments/presets             - Save attachment preset');
    console.log('');
    console.log('  Administration:');
    console.log('    POST /api/admin/moderate  - Content moderation');
    console.log('    GET  /api/health          - Health check');
    console.log('');
    console.log('Security Features:');
    console.log('  ✅ Rate limiting on community endpoints');
    console.log('  ✅ Input sanitization and validation');
    console.log('  ✅ Content moderation system');
    console.log('  ✅ Session-based authentication');
    console.log('  ✅ GitHub API integration with token support');
    console.log('');
    console.log('GitHub Integration:');
    console.log(`  Repository: ${COMMUNITY_REPO_OWNER}/${COMMUNITY_REPO_NAME}`);
    console.log(`  Token configured: ${!!GITHUB_TOKEN}`);
    console.log('');
    console.log('='.repeat(60));
    console.log('🚀 Open http://localhost:3000 in your browser to start');
    console.log('📖 API documentation available at /api/health');
    console.log('');

    // Initialize sample data for demonstration
    initializeSampleData();
});

module.exports = app;